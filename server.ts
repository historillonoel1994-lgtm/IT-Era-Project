import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
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
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

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

// Call Gemini with automatic retry on 503/429 and secondary model fallback
async function generateContentWithRetry(options: {
  contents: any;
  config?: any;
  preferredModel?: string;
}): Promise<any> {
  const modelsToTry = [
    options.preferredModel || PRIMARY_MODEL,
    FALLBACK_MODEL,
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: options.config,
        });

        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err.message || '');
        const isTransient =
          msg.includes('503') ||
          msg.includes('429') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('overloaded');

        if (isTransient && attempt === 0) {
          // Wait 1.2s before quick retry
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        break;
      }
    }
  }

  throw lastError;
}

// Helper to format lesson pages for prompt context
function formatLessonContext(pages: { pageNumber: number | string; text: string }[]): string {
  return pages
    .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}\n--- END PAGE ${p.pageNumber} ---`)
    .join('\n\n');
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
app.post('/api/summarize', async (req: Request, res: Response) => {
  try {
    const { pages, lessonTitle, subject } = req.body;
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
  try {
    const { pages, lessonTitle, questionCount = 5, quizType = 'mixed' } = req.body;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages to generate a quiz' });
    }

    const count = [5, 10, 15].includes(Number(questionCount)) ? Number(questionCount) : 5;
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
  try {
    const { pages, lessonTitle, question, chatHistory = [] } = req.body;
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
    console.error('Error in AI Tutor:', error);
    res.status(500).json({
      error: 'Study Buddy could not answer right now. Please try again.',
      details: error.message,
    });
  }
});

// 4b. FEATURE 3b: Ask Study Buddy (General AI Question)
app.post('/api/ask-general', async (req: Request, res: Response) => {
  try {
    const { question, chatHistory = [] } = req.body;
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
    console.error('Error in General AI Question:', error);
    res.status(500).json({
      error: 'Study Buddy could not answer right now. Please try again.',
      details: error.message,
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
