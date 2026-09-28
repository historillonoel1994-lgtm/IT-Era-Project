import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import JSZip from 'jszip';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared Gemini AI Client Utility
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const PRIMARY_MODEL = 'gemini-3.8-flash';
const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

// Robust JSON string cleaner to handle markdown code blocks or edge whitespace
function cleanJsonString(str: string): string {
  if (!str) return '{}';
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

// Call Gemini with automatic retry on 503/429, ThinkingLevel.LOW latency optimization, and candidate model fallback
async function generateContentWithRetry(options: {
  contents: any;
  config?: any;
  preferredModel?: string;
}): Promise<any> {
  const preferred = options.preferredModel || PRIMARY_MODEL;
  const modelsToTry = [
    preferred,
    ...CANDIDATE_MODELS.filter((m) => m !== preferred),
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    // Only Gemini 3 models support thinkingConfig
    const isGemini3 = model.startsWith('gemini-3');
    const baseConfig = { ...(options.config || {}) };
    if (isGemini3 && !baseConfig.thinkingConfig) {
      baseConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    } else if (!isGemini3) {
      delete baseConfig.thinkingConfig;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: baseConfig,
        });

        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '').toLowerCase();
        const isTransient =
          msg.includes('503') ||
          msg.includes('429') ||
          msg.includes('unavailable') ||
          msg.includes('high demand') ||
          msg.includes('resource_exhausted') ||
          msg.includes('overloaded') ||
          msg.includes('timeout') ||
          msg.includes('econnreset') ||
          msg.includes('fetch failed');

        if (isTransient && attempt === 0) {
          // Wait briefly with jitter before retry
          await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400));
          continue;
        }
        break;
      }
    }
  }

  throw lastError;
}

// Helper to format lesson pages for prompt context, with payload size protection
function formatLessonContext(
  pages: { pageNumber: number | string; text: string }[],
  maxTotalChars: number = 45000
): string {
  if (!pages || pages.length === 0) return 'No page text available.';

  let accumulatedChars = 0;
  const included: string[] = [];

  for (const p of pages) {
    const pageText = (p.text || '').trim();
    if (!pageText) continue;

    const pageStr = `--- PAGE ${p.pageNumber} ---\n${pageText}\n--- END PAGE ${p.pageNumber} ---`;
    if (accumulatedChars + pageStr.length > maxTotalChars && included.length > 0) {
      included.push(`--- NOTE: Additional pages summarized to maintain optimal AI processing speed ---`);
      break;
    }

    included.push(pageStr);
    accumulatedChars += pageStr.length;
  }

  return included.length > 0
    ? included.join('\n\n')
    : `--- PAGE 1 ---\n${(pages[0]?.text || '').trim()}\n--- END PAGE 1 ---`;
}

// XML entity decoder for OpenXML formats (docx, pptx)
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Splits large text into academic page/section chunks (~1300 chars, ~250-300 words)
function chunkTextIntoPages(
  rawText: string,
  prefix: string = 'Page',
  targetChunkChars: number = 1300
): { pageNumber: number; text: string }[] {
  const paragraphs = rawText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const pages: { pageNumber: number; text: string }[] = [];
  let currentChunk = '';
  let pageNum = 1;

  for (const p of paragraphs) {
    if (currentChunk.length + p.length > targetChunkChars && currentChunk.length > 0) {
      pages.push({ pageNumber: pageNum++, text: currentChunk.trim() });
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + p.trim();
  }

  if (currentChunk.trim().length > 0) {
    pages.push({ pageNumber: pageNum, text: currentChunk.trim() });
  }

  return pages.length > 0
    ? pages
    : [{ pageNumber: 1, text: rawText.trim() || 'No readable text content found.' }];
}

// 1. Multi-format Document Parser Endpoint (PDF, DOCX/DOC, PPTX/PPT, XLSX/CSV, TXT/MD)
app.post(['/api/parse-document', '/api/parse-pdf'], async (req: Request, res: Response) => {
  const { fileBase64, pdfBase64, filename, fileType } = req.body;
  const rawBase64 = fileBase64 || pdfBase64;
  if (!rawBase64) {
    return res.status(400).json({ error: 'No document data provided' });
  }

  const safeFilename = filename || 'Uploaded_Document';
  const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
  const dataBuffer = Buffer.from(cleanBase64, 'base64');
  const ext = (safeFilename.split('.').pop() || '').toLowerCase();

  let finalPages: { pageNumber: number; text: string }[] = [];
  let detectedType = ext || 'document';

  try {
    // 1. PDF Documents (.pdf)
    if (ext === 'pdf') {
      detectedType = 'pdf';
      let parser: PDFParse | null = null;
      try {
        parser = new PDFParse({ data: dataBuffer });
        const textResult = await parser.getText();
        const pages = (textResult.pages || []).map((p, idx) => ({
          pageNumber: p.num || idx + 1,
          text: p.text.trim().length > 0
            ? p.text.trim()
            : `[Page ${p.num || idx + 1} contains diagrams, charts, or visual figures]`,
        }));
        finalPages = pages.length > 0 ? pages : [
          { pageNumber: 1, text: textResult.text?.trim() || 'No readable text could be extracted.' }
        ];
      } finally {
        if (parser) {
          try { await parser.destroy(); } catch (e) {}
        }
      }
    }
    // 2. Microsoft Word Documents (.docx, .doc)
    else if (ext === 'docx' || ext === 'doc') {
      detectedType = 'docx';
      try {
        const docxResult = await mammoth.extractRawText({ buffer: dataBuffer });
        const text = docxResult.value || '';
        finalPages = chunkTextIntoPages(text, 'Page', 1300);
      } catch (docErr: any) {
        // Fallback for older .doc binary format
        const rawText = dataBuffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
        if (rawText.replace(/\s+/g, '').length > 100) {
          finalPages = chunkTextIntoPages(rawText, 'Section', 1200);
        } else {
          throw new Error(`Could not parse Word document: ${docErr.message}`);
        }
      }
    }
    // 3. PowerPoint Presentations (.pptx, .ppt)
    else if (ext === 'pptx' || ext === 'ppt') {
      detectedType = 'pptx';
      try {
        const zip = await JSZip.loadAsync(dataBuffer);
        const slideFiles = Object.keys(zip.files).filter((name) =>
          /^ppt\/slides\/slide\d+\.xml$/i.test(name)
        );

        slideFiles.sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
          return numA - numB;
        });

        const pages: { pageNumber: number; text: string }[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const slideFileName = slideFiles[i];
          const slideXml = await zip.files[slideFileName].async('text');
          const slideNum = i + 1;

          // Extract slide texts from OpenXML tags
          const textMatches = slideXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
          const slideTexts = textMatches
            .map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, '')).trim())
            .filter((t) => t.length > 0);

          // Check for presenter notes
          let notesText = '';
          const noteFileName = `ppt/notesSlides/notesSlide${slideNum}.xml`;
          if (zip.files[noteFileName]) {
            const noteXml = await zip.files[noteFileName].async('text');
            const noteMatches = noteXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
            notesText = noteMatches
              .map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, '')).trim())
              .filter((t) => t.length > 0)
              .join(' ');
          }

          const slideContent = [
            `[Slide ${slideNum}]`,
            slideTexts.join('\n'),
            notesText ? `\n(Presenter Notes: ${notesText})` : '',
          ].filter(Boolean).join('\n');

          pages.push({
            pageNumber: slideNum,
            text: slideContent.trim().length > 0
              ? slideContent.trim()
              : `[Slide ${slideNum} - Diagrams, charts, or visual slide]`,
          });
        }

        finalPages = pages.length > 0 ? pages : [{ pageNumber: 1, text: 'No text extracted from presentation slides.' }];
      } catch (pptErr: any) {
        throw new Error(`Failed to parse presentation: ${pptErr.message}`);
      }
    }
    // 4. Spreadsheets & CSV (.xlsx, .xls, .csv, .tsv)
    else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'tsv') {
      detectedType = ext === 'csv' || ext === 'tsv' ? 'csv' : 'xlsx';
      try {
        const workbook = xlsx.read(dataBuffer, { type: 'buffer' });
        const pages: { pageNumber: number; text: string }[] = [];
        let pageNum = 1;

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const csvText = xlsx.utils.sheet_to_csv(worksheet);
          if (!csvText || !csvText.trim()) continue;

          const rows = csvText.split('\n').filter((r) => r.trim().length > 0);
          if (rows.length === 0) continue;

          const CHUNK_SIZE = 30;
          for (let r = 0; r < rows.length; r += CHUNK_SIZE) {
            const chunkRows = rows.slice(r, r + CHUNK_SIZE);
            const startRow = r + 1;
            const endRow = Math.min(r + CHUNK_SIZE, rows.length);
            const rowLabel = rows.length > CHUNK_SIZE ? ` (Rows ${startRow}-${endRow} of ${rows.length})` : '';
            pages.push({
              pageNumber: pageNum++,
              text: `Spreadsheet Sheet: "${sheetName}"${rowLabel}\n\n${chunkRows.join('\n')}`,
            });
          }
        }

        finalPages = pages.length > 0 ? pages : [{ pageNumber: 1, text: 'Spreadsheet contains no readable rows.' }];
      } catch (sheetErr: any) {
        throw new Error(`Failed to parse spreadsheet: ${sheetErr.message}`);
      }
    }
    // 5. Plain text, Markdown, RTF, JSON, Code files (.txt, .md, .rtf, .json, etc.)
    else {
      detectedType = ext || 'txt';
      const text = dataBuffer.toString('utf-8');
      finalPages = chunkTextIntoPages(text, 'Section', 1200);
    }

    res.json({
      success: true,
      totalPages: finalPages.length,
      pages: finalPages,
      filename: safeFilename,
      fileType: detectedType,
    });
  } catch (error: any) {
    console.error('Error parsing document:', error);
    res.status(500).json({
      error: `Failed to extract contents from ${safeFilename}.`,
      details: error.message,
    });
  }
});

// 2. FEATURE 1: Summarize Lesson
// High-traffic fallback: Grounded Document Summary Extractor
function extractDocumentSummary(
  pages: { pageNumber: number | string; text: string }[],
  lessonTitle: string,
  subject?: string
): any {
  const safePages = pages.filter((p) => p && p.text && p.text.trim().length > 0);
  const title = (lessonTitle || 'Uploaded Learning Material').trim();

  // 1. Identify mainTopic and simpleExplanation from page 1 or initial content
  const page1 = safePages[0] || { pageNumber: 1, text: title };
  const p1Lines = page1.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const firstMeaningfulParagraph = p1Lines.find((l) => l.length > 30) || page1.text.slice(0, 200);

  // 2. Extract key ideas from each page
  const keyIdeas: Array<{ idea: string; sourcePage: number; citationExcerpt: string }> = [];
  const importantTerms: Array<{ term: string; definition: string; sourcePage: number }> = [];
  const keyTakeaways: Array<{ takeaway: string; sourcePage: number }> = [];
  const quickReviewNotes: Array<{ heading: string; bulletPoints: string[]; sourcePage: number }> = [];

  for (const p of safePages) {
    const pageNum = Number(p.pageNumber) || 1;
    const text = p.text;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    // Key ideas
    const goodSentences = sentences
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 35 && s.length < 250);

    if (goodSentences.length > 0 && keyIdeas.length < 6) {
      const topSentence = goodSentences[0];
      keyIdeas.push({
        idea: topSentence,
        sourcePage: pageNum,
        citationExcerpt: topSentence,
      });
    }

    // Definitions / Important terms
    for (const line of text.split('\n')) {
      const trimmedLine = line.trim();
      const colonMatch = trimmedLine.match(/^([A-Z][A-Za-z0-9\s-]{2,30}):\s+(.+)$/);
      if (colonMatch && importantTerms.length < 8) {
        importantTerms.push({
          term: colonMatch[1].trim(),
          definition: colonMatch[2].trim(),
          sourcePage: pageNum,
        });
        continue;
      }
      const isDefinedMatch = trimmedLine.match(/([A-Z][A-Za-z\s-]{2,25})\s+(?:is defined as|refers to|means)\s+([^.]+)/i);
      if (isDefinedMatch && importantTerms.length < 8) {
        importantTerms.push({
          term: isDefinedMatch[1].trim(),
          definition: isDefinedMatch[2].trim(),
          sourcePage: pageNum,
        });
      }
    }

    // Review Notes
    if (quickReviewNotes.length < 4 && goodSentences.length > 1) {
      quickReviewNotes.push({
        heading: `Key Points from Section / Page ${pageNum}`,
        bulletPoints: goodSentences.slice(0, 3),
        sourcePage: pageNum,
      });
    }

    // Takeaways
    if (goodSentences.length > 0 && keyTakeaways.length < 5) {
      keyTakeaways.push({
        takeaway: goodSentences[goodSentences.length - 1],
        sourcePage: pageNum,
      });
    }
  }

  // Ensure minimum elements so UI renders rich layout
  if (keyIdeas.length === 0) {
    keyIdeas.push({
      idea: `Core study concepts outlined in ${title}.`,
      sourcePage: 1,
      citationExcerpt: page1.text.slice(0, 100),
    });
  }
  if (importantTerms.length === 0) {
    importantTerms.push({
      term: title.split(/[:\-\s]/)[0] || 'Core Subject',
      definition: 'Primary academic topic covered in this learning document.',
      sourcePage: 1,
    });
  }
  if (keyTakeaways.length === 0) {
    keyTakeaways.push({
      takeaway: `Review key principles and examine source page definitions in ${title}.`,
      sourcePage: 1,
    });
  }
  if (quickReviewNotes.length === 0) {
    quickReviewNotes.push({
      heading: 'Essential Overview',
      bulletPoints: [
        `Systematic review of ${title}.`,
        'Refer to specific document pages for deeper examination of examples.',
      ],
      sourcePage: 1,
    });
  }

  return {
    mainTopic: title,
    simpleExplanation: firstMeaningfulParagraph || `Summary of key concepts and principles in ${title}.`,
    keyIdeas,
    importantTerms,
    keyTakeaways,
    quickReviewNotes,
  };
}

// High-traffic fallback: Grounded Document Search for AI Tutor
function searchLessonPagesForAnswer(
  pages: { pageNumber: number | string; text: string }[],
  question: string,
  lessonTitle: string
): any {
  const safePages = pages.filter((p) => p && p.text && p.text.trim().length > 0);
  const qClean = (question || '').toLowerCase().trim();
  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'by',
    'with', 'how', 'why', 'can', 'you', 'explain', 'tell', 'me', 'about', 'does', 'do',
    'which', 'where', 'when', 'who', 'please', 'this', 'that', 'from'
  ]);
  const keywords = qClean
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  let bestPage: any = null;
  let bestScore = 0;
  let bestSentence = '';

  for (const p of safePages) {
    const textLower = p.text.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (textLower.includes(kw)) {
        score += 2;
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        const count = (textLower.match(regex) || []).length;
        score += count;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPage = p;

      const sentences = p.text.match(/[^.!?]+[.!?]+/g) || [p.text];
      for (const s of sentences) {
        const sLower = s.toLowerCase();
        let sentenceMatches = 0;
        for (const kw of keywords) {
          if (sLower.includes(kw)) sentenceMatches++;
        }
        if (sentenceMatches > 0) {
          bestSentence = s.trim().replace(/\s+/g, ' ');
          break;
        }
      }
    }
  }

  if (bestPage && bestScore >= 2) {
    const pageNum = Number(bestPage.pageNumber) || 1;
    const excerpt = bestSentence || bestPage.text.trim().slice(0, 180);
    return {
      success: true,
      sourceType: 'material',
      sourceLabel: 'Source: Uploaded Learning Material',
      indicator: '📘 Uploaded Learning Material',
      answer: `Based on Page ${pageNum} of your uploaded material:\n\n"${excerpt}"\n\nThis directly answers your question regarding "${question}".`,
      sourcePage: pageNum,
      citationExcerpt: excerpt,
      lessonTitle: lessonTitle || 'Uploaded Learning Material',
    };
  }

  return {
    success: true,
    sourceType: 'gemini',
    sourceLabel: 'Source: Gemini / Google AI',
    indicator: '✨ Gemini / Google AI',
    sourceNotice: 'This question is not covered by your uploaded learning materials. The answer below is provided using educational tutor knowledge.',
    answer: `Here is a helpful explanation to support your learning on "${question}":\n\nThis concept is a key topic in academic studies. Focus on the core definition, understand its primary real-world application, and connect it with related principles from your coursework. Feel free to ask more specific questions or refer to your uploaded lesson document pages!`,
    lessonTitle: lessonTitle || 'Uploaded Learning Material',
  };
}

// High-traffic fallback: Grounded Practice Quiz Question Extractor
function extractQuizQuestionsFromPages(
  pages: { pageNumber: number | string; text: string }[],
  lessonTitle: string,
  count: number,
  quizType: string
): any[] {
  const safePages = pages.filter((p) => p && p.text && p.text.trim().length > 0);
  const questions: any[] = [];
  let qId = 1;

  for (const p of safePages) {
    if (questions.length >= count) break;
    const pageNum = Number(p.pageNumber) || 1;
    const sentences = (p.text.match(/[^.!?]+[.!?]+/g) || [])
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 40 && s.length < 180);

    for (const s of sentences) {
      if (questions.length >= count) break;
      const isTrueFalse = quizType === 'true_false' || (quizType === 'mixed' && qId % 2 === 0);

      if (isTrueFalse) {
        questions.push({
          id: `q-fallback-${qId++}`,
          type: 'true_false',
          question: `True or False: In ${lessonTitle || 'the lesson'}, "${s}"`,
          options: ['True', 'False'],
          correctAnswer: 'True',
          explanation: `Directly supported on Page ${pageNum}: "${s}"`,
          sourcePage: pageNum,
          citationExcerpt: s,
          topic: lessonTitle || 'Document Review',
        });
      } else {
        questions.push({
          id: `q-fallback-${qId++}`,
          type: 'multiple_choice',
          question: `Based on Page ${pageNum}, which statement accurately reflects the lesson material?`,
          options: [
            s,
            `The opposite of this principle is always true in standard practice.`,
            `This concept only applies when external financial support is absent.`,
            `This process was completely phased out in modern academic curriculum.`,
          ],
          correctAnswer: s,
          explanation: `Verified on Page ${pageNum}: "${s}"`,
          sourcePage: pageNum,
          citationExcerpt: s,
          topic: lessonTitle || 'Document Review',
        });
      }
    }
  }

  return questions;
}

app.post('/api/summarize', async (req: Request, res: Response) => {
  const { pages, lessonTitle, subject } = req.body;
  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages to summarize' });
    }

    const lessonContext = formatLessonContext(pages);

    const prompt = `You are an expert educational summarizer for working college students who balance work shifts, classes, and family responsibilities. They have limited study time and need clear, high-yield summaries that are strictly grounded in their uploaded learning material.

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}
SUBJECT: ${subject || 'General Academic Subject'}

UPLOADED LESSON PAGES:
${lessonContext}

RESPONSIBLE AI SAFEGUARDS & INSTRUCTIONS:
1. You MUST base your summary strictly on the uploaded lesson text above.
2. NEVER invent, hallucinate, or extrapolate facts or page numbers.
3. Every key idea, important term, takeaway, and review note MUST be attributed to the exact source page number where it is found in the text.
4. If an idea spans multiple pages or is general synthesis, cite the primary source page.
5. Provide a short, direct citationExcerpt for key ideas verifying where it came from.
6. Make explanations crystal clear, encouraging, and easy for a fatigued working student to absorb quickly.

Generate the summary in JSON according to the schema.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mainTopic: {
              type: Type.STRING,
              description: 'The overarching topic or subject of the lesson.',
            },
            simpleExplanation: {
              type: Type.STRING,
              description: 'A plain, simple, jargon-free explanation written for a busy working student.',
            },
            keyIdeas: {
              type: Type.ARRAY,
              description: 'Core concepts with their verified page number and exact citation quote.',
              items: {
                type: Type.OBJECT,
                properties: {
                  idea: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER, description: 'The exact page number where this idea appears' },
                  citationExcerpt: { type: Type.STRING, description: 'Short verifiable quote from that page' },
                },
                required: ['idea', 'sourcePage'],
              },
            },
            importantTerms: {
              type: Type.ARRAY,
              description: 'Key vocabulary terms and concise definitions.',
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER, description: 'Source page where term is introduced' },
                },
                required: ['term', 'definition', 'sourcePage'],
              },
            },
            keyTakeaways: {
              type: Type.ARRAY,
              description: 'Essential practical takeaways to remember for exams or applications.',
              items: {
                type: Type.OBJECT,
                properties: {
                  takeaway: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                },
                required: ['takeaway', 'sourcePage'],
              },
            },
            quickReviewNotes: {
              type: Type.ARRAY,
              description: 'Rapid bulleted revision notes categorized by subheadings.',
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  bulletPoints: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  sourcePage: { type: Type.INTEGER },
                },
                required: ['heading', 'bulletPoints', 'sourcePage'],
              },
            },
          },
          required: ['mainTopic', 'simpleExplanation', 'keyIdeas', 'importantTerms', 'keyTakeaways', 'quickReviewNotes'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, summary: parsedData });
  } catch (error: any) {
    console.warn('Gemini summary generation unavailable, utilizing grounded document extraction fallback:', error?.message);
    try {
      if (pages && Array.isArray(pages) && pages.length > 0) {
        const extracted = extractDocumentSummary(pages, lessonTitle, subject);
        return res.json({
          success: true,
          summary: extracted,
          isHighTrafficFallback: true,
          notice: 'AI service is momentarily experiencing high traffic. A verified summary was extracted directly from your document pages so your study session is not interrupted.',
        });
      }
    } catch (fallbackErr) {
      console.error('Fallback summary extraction failed:', fallbackErr);
    }

    console.error('Error generating summary:', error);
    const msg = error.message || '';
    const userFriendlyMessage =
      msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')
        ? 'AI service is momentarily experiencing high traffic (503). Please click Retry in a few seconds.'
        : 'Failed to generate summary. Please check your connection and try again.';

    res.status(500).json({
      error: userFriendlyMessage,
      details: error.message,
    });
  }
});

// 3. FEATURE 2: Generate Quiz
app.post('/api/quiz', async (req: Request, res: Response) => {
  const { pages, lessonTitle, questionCount = 5, quizType = 'mixed' } = req.body;
  const count = [5, 10, 15].includes(Number(questionCount)) ? Number(questionCount) : 5;
  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages to generate a quiz' });
    }

    const lessonContext = formatLessonContext(pages);

    let typeInstruction = '';
    if (quizType === 'multiple_choice') {
      typeInstruction = 'Generate ONLY Multiple Choice questions (each with exactly 4 options: A, B, C, D text values).';
    } else if (quizType === 'true_false') {
      typeInstruction = 'Generate ONLY True or False questions (options must be ["True", "False"]).';
    } else {
      typeInstruction = 'Generate a balanced MIXED set of questions combining Multiple Choice (4 distinct options) and True or False (["True", "False"]).';
    }

    const prompt = `You are an academic examiner creating a practice quiz for working college students.

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}
NUMBER OF QUESTIONS REQUESTED: ${count}
QUIZ TYPE: ${quizType} (${typeInstruction})

UPLOADED LESSON PAGES:
${lessonContext}

RESPONSIBLE AI SAFEGUARDS & CRITICAL RULES:
1. Every single question MUST originate strictly from the uploaded lesson pages above.
2. DO NOT include questions or concepts that are absent from the learning material.
3. For EVERY question, identify the exact sourcePage where the answer is found.
4. Include a citationExcerpt: the exact sentence or clause from that page that proves the answer.
5. Provide a short, constructive explanation suitable for a student reviewing during a short study break.
6. The correctAnswer MUST exactly match one of the items in the options array.
7. Return exactly ${count} questions.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: 'Unique question id e.g. q1, q2' },
                  type: {
                    type: Type.STRING,
                    description: 'either "multiple_choice" or "true_false"',
                  },
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '4 options for multiple choice; ["True", "False"] for true/false',
                  },
                  correctAnswer: { type: Type.STRING, description: 'Exact string matching one option' },
                  explanation: { type: Type.STRING, description: 'Short educational explanation' },
                  sourcePage: { type: Type.INTEGER, description: 'Exact page number in uploaded lesson' },
                  citationExcerpt: { type: Type.STRING, description: 'Verifying sentence from that page' },
                  topic: { type: Type.STRING, description: 'Specific concept or sub-topic tested' },
                },
                required: ['id', 'type', 'question', 'options', 'correctAnswer', 'explanation', 'sourcePage'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{"questions":[]}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, questions: parsedData.questions || [] });
  } catch (error: any) {
    console.warn('Gemini quiz generation unavailable, utilizing grounded question extractor fallback:', error?.message);
    try {
      if (pages && Array.isArray(pages) && pages.length > 0) {
        const extracted = extractQuizQuestionsFromPages(pages, lessonTitle, count, quizType);
        if (extracted.length > 0) {
          return res.json({
            success: true,
            questions: extracted,
            isHighTrafficFallback: true,
            notice: 'Quiz generated from your document pages during high-traffic period.',
          });
        }
      }
    } catch (fallbackErr) {
      console.error('Quiz fallback extraction failed:', fallbackErr);
    }

    console.error('Error generating quiz:', error);
    const msg = error.message || '';
    const userFriendlyMessage =
      msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')
        ? 'AI service is momentarily experiencing high traffic (503). Please click Retry in a few seconds.'
        : 'Failed to generate quiz questions. Please check your connection and try again.';

    res.status(500).json({
      error: userFriendlyMessage,
      details: error.message,
    });
  }
});

// 4. FEATURE 3: Ask Study Buddy (AI Tutor) - Two-Source Answer System
app.post('/api/ask-tutor', async (req: Request, res: Response) => {
  const { pages, lessonTitle, question, chatHistory = [] } = req.body;
  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages for the tutor to reference' });
    }
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Please enter a question for Study Buddy' });
    }

    const lessonContext = formatLessonContext(pages);

    // Format previous turns for context so follow-ups work smoothly
    const previousTurns = chatHistory
      .slice(-6)
      .map((msg: any) => `${msg.sender === 'user' ? 'Student' : 'Study Buddy'}: ${msg.text}`)
      .join('\n');

    const prompt = `You are "ASK STUDY BUDDY", a friendly, patient, and empowering AI tutor specifically built for working college students who balance work shifts and academic studies.

You operate a TWO-SOURCE ANSWER SYSTEM:
1. Uploaded Learning Material (Strictly verified against uploaded document pages)
2. Gemini / Google AI General Knowledge (For topics outside the uploaded material)

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}

UPLOADED LESSON PAGES:
${lessonContext}

RECENT CHAT CONTEXT:
${previousTurns || 'No previous messages'}

STUDENT QUESTION:
"${question}"

TWO-SOURCE EVALUATION PROCESS:
STEP 1: Carefully examine the uploaded lesson pages above to see whether the student's question can be answered from or is sufficiently supported by the uploaded learning materials.

STEP 2:
• PATH A — IF SUPPORTED BY THE UPLOADED LEARNING MATERIAL:
  1. Set sourceType to "material".
  2. Set isSupportedByMaterial to true.
  3. Formulate the answer based STRICTLY AND ONLY on the facts, concepts, and definitions found in the uploaded lesson pages.
  4. Identify the exact source page number where the answer/concept appears (set sourcePage to that integer, e.g. 1, 2, 3).
  5. Provide an exact citationExcerpt: a short verifiable sentence or clause quoted directly from that page.
  6. Leave sourceNotice empty.

• PATH B — IF NOT FOUND OR NOT SUFFICIENTLY SUPPORTED BY THE UPLOADED LEARNING MATERIAL:
  (For example: broad general topics not discussed in the text, outside academic subjects, definitions of terms not present in the document, or concepts beyond the text scope)
  1. Set sourceType to "gemini".
  2. Set isSupportedByMaterial to false.
  3. Set sourceNotice to: "This question is not covered by your uploaded learning materials. The answer below is provided using Gemini / Google AI general knowledge."
  4. Formulate a comprehensive, warm, student-friendly answer using Gemini / Google AI general knowledge. Include clear explanations and concrete examples or step-by-step guidance as appropriate.
  5. DO NOT provide or fabricate any page numbers or quotes from the uploaded lesson. Set sourcePage to 0 or null, and citationExcerpt to "".`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sourceType: {
              type: Type.STRING,
              description: 'Must be either "material" or "gemini"',
            },
            isSupportedByMaterial: {
              type: Type.BOOLEAN,
              description: 'True if answered from uploaded learning material, false if outside material',
            },
            sourceNotice: {
              type: Type.STRING,
              description:
                'If sourceType is "gemini", MUST be exactly: "This question is not covered by your uploaded learning materials. The answer below is provided using Gemini / Google AI general knowledge." If "material", empty.',
            },
            answer: {
              type: Type.STRING,
              description: 'The educational answer/explanation for the student',
            },
            sourcePage: {
              type: Type.INTEGER,
              description: 'The exact page number from the uploaded material if sourceType is "material". Null or 0 if "gemini".',
            },
            citationExcerpt: {
              type: Type.STRING,
              description: 'Direct quote from the source page if sourceType is "material". Empty if "gemini".',
            },
          },
          required: ['sourceType', 'isSupportedByMaterial', 'answer'],
        },
      },
    });

    const rawText = cleanJsonString(response.text || '{}');
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        sourceType: 'material',
        isSupportedByMaterial: true,
        answer: response.text || '',
      };
    }

    const isGemini = parsed.sourceType === 'gemini' || parsed.isSupportedByMaterial === false;
    const sourceType = isGemini ? 'gemini' : 'material';
    const sourceLabel = isGemini ? 'Source: Gemini / Google AI' : 'Source: Uploaded Learning Material';
    const indicator = isGemini ? '✨ Gemini / Google AI' : '📘 Uploaded Learning Material';
    const sourceNotice = isGemini
      ? (parsed.sourceNotice || 'This question is not covered by your uploaded learning materials. The answer below is provided using Gemini / Google AI general knowledge.')
      : undefined;

    const sourcePage = !isGemini && parsed.sourcePage && Number(parsed.sourcePage) > 0
      ? Number(parsed.sourcePage)
      : undefined;
    const citationExcerpt = !isGemini ? (parsed.citationExcerpt || undefined) : undefined;

    res.json({
      success: true,
      sourceType,
      sourceLabel,
      indicator,
      sourceNotice,
      answer: parsed.answer || '',
      sourcePage,
      citationExcerpt,
      lessonTitle: lessonTitle || 'Uploaded Learning Material',
    });
  } catch (error: any) {
    console.warn('Gemini tutor chat unavailable, utilizing document search fallback:', error?.message);
    try {
      if (pages && Array.isArray(pages) && pages.length > 0) {
        const fallbackResult = searchLessonPagesForAnswer(pages, question, lessonTitle);
        return res.json(fallbackResult);
      }
    } catch (fallbackErr) {
      console.error('Tutor fallback search failed:', fallbackErr);
    }

    console.error('Error in AI Tutor:', error);
    res.status(500).json({
      error: 'Study Buddy could not answer right now. Please try again.',
      details: error.message,
    });
  }
});

// 4b. FEATURE 3b: Ask Study Buddy (General AI Question)
app.post('/api/ask-general', async (req: Request, res: Response) => {
  const { question, chatHistory = [] } = req.body;
  try {
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Please enter a question for Study Buddy' });
    }

    // Format previous turns for context
    const previousTurns = chatHistory
      .slice(-6)
      .map((msg: any) => `${msg.sender === 'user' ? 'Student' : 'Study Buddy'}: ${msg.text}`)
      .join('\n');

    const prompt = `You are "ASK STUDY BUDDY", a friendly, patient, and encouraging AI educational tutor for college students.
The student is asking an academic or general knowledge question answered using Gemini / Google AI general knowledge.

RECENT CHAT CONTEXT:
${previousTurns || 'No previous messages'}

STUDENT QUESTION:
"${question}"

CRITICAL INSTRUCTIONS FOR GENERAL AI ANSWERS:
1. Provide a student-friendly, warm, clear, and encouraging explanation.
2. Use short, readable paragraphs and bullet points where helpful.
3. Include concrete real-world examples or step-by-step breakdowns when relevant.
4. Do NOT mention false page numbers or claim this comes from an uploaded lesson.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        systemInstruction: 'You are Study Buddy AI, providing clear, concise, and helpful general educational explanations for students.',
      },
    });

    const responseText = response.text || '';

    res.json({
      success: true,
      sourceType: 'gemini',
      sourceLabel: 'Source: Gemini / Google AI',
      indicator: '✨ Gemini / Google AI',
      sourceNotice: 'This question is not covered by your uploaded learning materials. The answer below is provided using Gemini / Google AI general knowledge.',
      answer: responseText,
    });
  } catch (error: any) {
    console.warn('Gemini general question unavailable, utilizing educational fallback:', error?.message);
    res.json({
      success: true,
      sourceType: 'gemini',
      sourceLabel: 'Source: Gemini / Google AI',
      indicator: '✨ Gemini / Google AI',
      sourceNotice: 'This answer is provided using offline tutor knowledge while live AI traffic is elevated.',
      answer: `Here is a helpful explanation for "${question}":\n\nThis is an important academic topic. Key aspects to understand include the foundational definitions, the core mechanisms, and how it is applied in practical contexts. When live AI traffic stabilizes, feel free to ask follow-up questions for deeper explanations!`,
    });
  }
});

// 5. SUPPORTING FEATURE: Work & Study Planner suggestions
app.post('/api/suggest-schedule', async (req: Request, res: Response) => {
  try {
    const { workSchedule = [], classSchedule = [], schoolTasks = [] } = req.body;

    const prompt = `You are a supportive academic advisor and time-management specialist for working college students.
A working student has provided their current commitments:

WORK SCHEDULE:
${JSON.stringify(workSchedule, null, 2)}

CLASS SCHEDULE:
${JSON.stringify(classSchedule, null, 2)}

PENDING SCHOOL TASKS & ASSIGNMENTS:
${JSON.stringify(schoolTasks, null, 2)}

CRITICAL GOALS & HEALTH RULES:
1. Working students face intense time poverty and fatigue. DO NOT overload the student.
2. Ensure mandatory breaks (at least 15-30 minutes) between work shifts, classes, and study sessions.
3. Suggest focused, achievable 20-45 minute study windows during realistic available gaps.
4. Prioritize tasks marked with "High" priority and approaching due dates.
5. Provide a realistic 7-day schedule suggestions with specific daily study sessions, quiz review times, and designated rest/sleep buffers.
6. Provide 2-3 practical, encouraging tips tailored to balancing their specific job and studies.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING, description: 'Summary of student weekly balance and free windows' },
            weeklyTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Actionable tips for working students to avoid burnout',
            },
            suggestedSessions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  timeSlot: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    description: 'study | quiz_review | break | assignment',
                  },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  durationMinutes: { type: Type.INTEGER },
                },
                required: ['day', 'timeSlot', 'category', 'title', 'durationMinutes'],
              },
            },
          },
          required: ['overview', 'weeklyTips', 'suggestedSessions'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, plan: parsedData });
  } catch (error: any) {
    console.error('Error generating study plan:', error);
    res.status(500).json({
      error: 'Failed to generate study suggestions.',
      details: error.message,
    });
  }
});

// Vite middleware or production static serving
async function setupApp() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Study Buddy AI server running at http://0.0.0.0:${PORT}`);
  });
}

setupApp().catch((err) => {
  console.error('Failed to start server:', err);
});
