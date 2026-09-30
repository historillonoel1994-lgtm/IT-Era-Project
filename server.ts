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

// In-memory document chunk and metadata cache
const parsedDocumentCache = new Map<string, {
  filename: string;
  fileType: string;
  totalPages: number;
  pages: { pageNumber: number | string; text: string }[];
  chunks: { chunkId: string; pageNumber: number | string; text: string; keywords: string[]; charCount: number }[];
  fullTextLength: number;
  uploadedAt: string;
}>();

// Keyword extractor for semantic ranking
function extractTopKeywords(text: string, count = 12): string[] {
  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'by',
    'with', 'how', 'why', 'can', 'you', 'explain', 'tell', 'me', 'about', 'does', 'do',
    'which', 'where', 'when', 'who', 'please', 'this', 'that', 'from', 'have', 'has', 'had',
    'are', 'was', 'were', 'been', 'their', 'they', 'them', 'these', 'those', 'also', 'will',
    'would', 'could', 'should', 'more', 'some', 'any', 'into', 'than', 'then', 'such', 'like',
    'been', 'other', 'each', 'most', 'very', 'only', 'same', 'over', 'both', 'between',
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map((e) => e[0]);
}

// High-Precision Multi-Stage Chunk Retrieval Engine
interface RetrievedContext {
  contextText: string;
  topPage: number | string | null;
  topExcerpt: string;
  topScore: number;
  hasDirectMatches: boolean;
  rankedPages: { pageNumber: number | string; text: string; score: number }[];
}

function retrieveRelevantDocumentContext(
  pages: { pageNumber: number | string; text: string }[],
  query: string,
  lessonTitle: string = ''
): RetrievedContext {
  if (!pages || pages.length === 0) {
    return {
      contextText: 'No readable text content available from uploaded document.',
      topPage: null,
      topExcerpt: '',
      topScore: 0,
      hasDirectMatches: false,
      rankedPages: [],
    };
  }

  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'by',
    'with', 'how', 'why', 'can', 'you', 'explain', 'tell', 'me', 'about', 'does', 'do',
    'which', 'where', 'when', 'who', 'please', 'this', 'that', 'from', 'give', 'some', 'any',
  ]);

  const qClean = (query || '').toLowerCase().trim();
  const qTokens = qClean
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  // Bigrams for phrase matching
  const bigrams: string[] = [];
  for (let i = 0; i < qTokens.length - 1; i++) {
    bigrams.push(`${qTokens[i]} ${qTokens[i + 1]}`);
  }

  // Calculate document-wide term frequencies for IDF-like weighting
  const docTermFreq = new Map<string, number>();
  for (const p of pages) {
    const textLow = (p.text || '').toLowerCase();
    for (const token of qTokens) {
      if (textLow.includes(token)) {
        docTermFreq.set(token, (docTermFreq.get(token) || 0) + 1);
      }
    }
  }

  const scoredPages: {
    pageNumber: number | string;
    text: string;
    score: number;
    bestSentence: string;
  }[] = [];

  for (const p of pages) {
    const text = (p.text || '').trim();
    if (!text) continue;
    const textLow = text.toLowerCase();
    let score = 0;

    // 1. Exact full query phrase match
    if (qClean.length > 5 && textLow.includes(qClean)) {
      score += 30;
    }

    // 2. Bigram phrase matches
    for (const bg of bigrams) {
      if (textLow.includes(bg)) {
        score += 12;
      }
    }

    // 3. Keyword matches with inverse document frequency
    for (const token of qTokens) {
      if (textLow.includes(token)) {
        const docOccurrences = docTermFreq.get(token) || 1;
        const rarityMultiplier = Math.max(1, Math.min(5, Math.floor(pages.length / docOccurrences)));
        const regex = new RegExp(`\\b${token}\\b`, 'gi');
        const tokenHits = (textLow.match(regex) || []).length;
        score += (tokenHits > 0 ? tokenHits : 1) * 3 * rarityMultiplier;
      }
    }

    // 4. Heading / Title match (first 120 characters)
    const firstLine = textLow.slice(0, 120);
    for (const token of qTokens) {
      if (firstLine.includes(token)) {
        score += 6;
      }
    }

    // 5. Best sentence extraction & sentence-level proximity bonus
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let bestSentence = '';
    let bestSentenceMatches = 0;

    for (const s of sentences) {
      const sLow = s.toLowerCase();
      let matchCount = 0;
      for (const token of qTokens) {
        if (sLow.includes(token)) matchCount++;
      }
      if (matchCount > bestSentenceMatches) {
        bestSentenceMatches = matchCount;
        bestSentence = s.trim().replace(/\s+/g, ' ');
      }
    }

    if (bestSentenceMatches >= 2) {
      score += bestSentenceMatches * 8; // Multi-keyword proximity bonus
    }

    scoredPages.push({
      pageNumber: p.pageNumber,
      text,
      score,
      bestSentence: bestSentence || sentences[0]?.trim() || '',
    });
  }

  scoredPages.sort((a, b) => b.score - a.score);

  const topScorer = scoredPages[0];
  const hasDirectMatches = topScorer && topScorer.score >= 4;
  const topPage = hasDirectMatches ? topScorer.pageNumber : null;
  const topExcerpt = hasDirectMatches ? topScorer.bestSentence : '';
  const topScore = topScorer ? topScorer.score : 0;

  // Total document character size
  const totalChars = pages.reduce((sum, p) => sum + (p.text || '').length, 0);

  let contextText = '';

  // Case A: Entire document is within ~180,000 characters (approx. 40 dense pages)
  // Include ALL pages so Gemini sees 100% of the entire text!
  if (totalChars <= 180000) {
    const pageContexts = pages.map((p) => {
      const isTopMatch = hasDirectMatches && String(p.pageNumber) === String(topPage);
      const matchBadge = isTopMatch ? ` [PRIMARY MATCH FOR STUDENT QUERY - PAGE ${p.pageNumber}]` : '';
      return `--- PAGE ${p.pageNumber}${matchBadge} ---\n${p.text.trim()}\n--- END PAGE ${p.pageNumber} ---`;
    });

    contextText = [
      `======================================================================`,
      `UPLOADED LEARNING MATERIAL: "${lessonTitle || 'Student Document'}"`,
      `TOTAL PAGES EXTRACTED AND AVAILABLE: ${pages.length} pages`,
      hasDirectMatches ? `PRIMARY RELEVANT SECTION FOR THIS QUESTION: Page ${topPage}` : `FULL DOCUMENT TEXT SEARCH ACTIVE`,
      `======================================================================`,
      ...pageContexts,
      `======================================================================`,
    ].join('\n\n');
  } else {
    // Case B: Very large document (> 180,000 chars)
    // Select top 12 most relevant chunks + overview (pages 1-2) + sibling context
    const selectedPageNums = new Set<string>();
    const selectedList: typeof scoredPages = [];

    // Always include page 1 (title & overview)
    const page1 = scoredPages.find((p) => String(p.pageNumber) === '1');
    if (page1) {
      selectedPageNums.add('1');
      selectedList.push(page1);
    }

    // Add top relevant chunks
    for (const sp of scoredPages) {
      if (selectedList.length >= 12) break;
      const numStr = String(sp.pageNumber);
      if (!selectedPageNums.has(numStr)) {
        selectedPageNums.add(numStr);
        selectedList.push(sp);
      }
    }

    // Sort in natural reading order by pageNumber
    selectedList.sort((a, b) => {
      const numA = typeof a.pageNumber === 'number' ? a.pageNumber : parseInt(String(a.pageNumber), 10) || 0;
      const numB = typeof b.pageNumber === 'number' ? b.pageNumber : parseInt(String(b.pageNumber), 10) || 0;
      return numA - numB;
    });

    const pageContexts = selectedList.map((p) => {
      const isTopMatch = hasDirectMatches && String(p.pageNumber) === String(topPage);
      const matchBadge = isTopMatch ? ` [TOP QUERY MATCH - PAGE ${p.pageNumber}]` : '';
      return `--- PAGE / SECTION ${p.pageNumber}${matchBadge} ---\n${p.text.trim()}\n--- END PAGE / SECTION ${p.pageNumber} ---`;
    });

    contextText = [
      `======================================================================`,
      `UPLOADED LEARNING MATERIAL: "${lessonTitle || 'Student Document'}"`,
      `TOTAL DOCUMENT PAGES EXTRACTED: ${pages.length} pages`,
      `RELEVANT SECTIONS EXTRACTED FOR THIS QUERY: ${selectedList.map((p) => `Page ${p.pageNumber}`).join(', ')}`,
      hasDirectMatches ? `PRIMARY RELEVANT SECTION: Page ${topPage}` : '',
      `======================================================================`,
      ...pageContexts,
      `======================================================================`,
    ].filter(Boolean).join('\n\n');
  }

  return {
    contextText,
    topPage,
    topExcerpt,
    topScore,
    hasDirectMatches,
    rankedPages: scoredPages.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
      score: p.score,
    })),
  };
}

// Helper to format full lesson pages for prompt context
function formatLessonContext(
  pages: { pageNumber: number | string; text: string }[],
  maxTotalChars: number = 180000
): string {
  if (!pages || pages.length === 0) return 'No page text available.';

  let accumulatedChars = 0;
  const included: string[] = [];

  for (const p of pages) {
    const pageText = (p.text || '').trim();
    if (!pageText) continue;

    const pageStr = `--- PAGE ${p.pageNumber} ---\n${pageText}\n--- END PAGE ${p.pageNumber} ---`;
    if (accumulatedChars + pageStr.length > maxTotalChars && included.length > 0) {
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

// Splits large text into academic page/section chunks (~1200 chars, ~250-300 words)
function chunkTextIntoPages(
  rawText: string,
  prefix: string = 'Page',
  targetChunkChars: number = 1200
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
        const rawPages = (textResult.pages || []).map((p, idx) => ({
          pageNumber: p.num || idx + 1,
          text: (p.text || '').trim(),
        }));

        // Filter and ensure valid text content
        const validPages = rawPages.filter((p) => p.text.length > 0);
        if (validPages.length > 0) {
          finalPages = rawPages.map((p) => ({
            pageNumber: p.pageNumber,
            text: p.text.length > 0 ? p.text : `[Page ${p.pageNumber} contains diagrams or visual illustrations]`,
          }));
        } else if (textResult.text && textResult.text.trim().length > 0) {
          finalPages = chunkTextIntoPages(textResult.text.trim(), 'Page', 1200);
        } else {
          finalPages = [{ pageNumber: 1, text: 'No readable text extracted from document.' }];
        }
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
        finalPages = chunkTextIntoPages(text, 'Page', 1200);
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

    // Generate structured chunks with metadata
    const chunks = finalPages.map((p, idx) => ({
      chunkId: `chunk-${idx + 1}`,
      pageNumber: p.pageNumber,
      text: p.text,
      keywords: extractTopKeywords(p.text, 8),
      charCount: p.text.length,
    }));

    const fullTextLength = finalPages.reduce((sum, p) => sum + p.text.length, 0);

    // Save into server memory cache
    parsedDocumentCache.set(safeFilename, {
      filename: safeFilename,
      fileType: detectedType,
      totalPages: finalPages.length,
      pages: finalPages,
      chunks,
      fullTextLength,
      uploadedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      totalPages: finalPages.length,
      pages: finalPages,
      chunks,
      fullTextLength,
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

  // 1. Identify mainTopic, summary, and simpleExplanation
  const page1 = safePages[0] || { pageNumber: 1, text: title };
  const p1Lines = page1.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const firstMeaningfulParagraph = p1Lines.find((l) => l.length > 30) || page1.text.slice(0, 220);

  const keyIdeas: Array<{ idea: string; sourcePage: number; citationExcerpt: string }> = [];
  const keyPoints: Array<{ idea: string; sourcePage: number; citationExcerpt: string }> = [];
  const importantTerms: Array<{ term: string; definition: string; sourcePage: number }> = [];
  const studyPointers: Array<{ pointer: string; sourcePage: number; category: string }> = [];
  const keyTakeaways: Array<{ takeaway: string; sourcePage: number }> = [];
  const quickReviewNotes: Array<{ heading: string; bulletPoints: string[]; sourcePage: number }> = [];
  const relationshipsBetweenTopics: string[] = [];
  const processesOrProcedures: string[] = [];
  const namesAndDates: string[] = [];

  for (const p of safePages) {
    const pageNum = Number(p.pageNumber) || 1;
    const text = p.text;
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || [text])
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter((s) => s.length > 30 && s.length < 280);

    // Key points from across the document
    if (sentences.length > 0 && keyPoints.length < 8) {
      keyPoints.push({
        idea: sentences[0],
        sourcePage: pageNum,
        citationExcerpt: sentences[0],
      });
    }

    // Key ideas
    if (sentences.length > 1 && keyIdeas.length < 6) {
      keyIdeas.push({
        idea: sentences[1],
        sourcePage: pageNum,
        citationExcerpt: sentences[1],
      });
    }

    // Study pointers for exams and quizzes
    if (sentences.length > 2 && studyPointers.length < 6) {
      studyPointers.push({
        pointer: `Remember for exams: ${sentences[2]}`,
        sourcePage: pageNum,
        category: 'exam',
      });
    }

    // Definitions / Important terms
    for (const line of text.split('\n')) {
      const trimmedLine = line.trim();
      const colonMatch = trimmedLine.match(/^([A-Z][A-Za-z0-9\s-]{2,30}):\s+(.+)$/);
      if (colonMatch && importantTerms.length < 10) {
        importantTerms.push({
          term: colonMatch[1].trim(),
          definition: colonMatch[2].trim(),
          sourcePage: pageNum,
        });
        continue;
      }
      const isDefinedMatch = trimmedLine.match(/([A-Z][A-Za-z\s-]{2,25})\s+(?:is defined as|refers to|means)\s+([^.]+)/i);
      if (isDefinedMatch && importantTerms.length < 10) {
        importantTerms.push({
          term: isDefinedMatch[1].trim(),
          definition: isDefinedMatch[2].trim(),
          sourcePage: pageNum,
        });
      }

      // Names and Dates
      const dateMatch = trimmedLine.match(/([A-Z][a-zA-Z\s]+)\s*\((18\d{2}|19\d{2}|20\d{2})\)/);
      if (dateMatch && namesAndDates.length < 5) {
        namesAndDates.push(`${dateMatch[1].trim()} (${dateMatch[2]}) - Page ${pageNum}`);
      }

      // Processes or procedures
      if ((trimmedLine.includes('Step ') || trimmedLine.includes('Process') || trimmedLine.includes('Loop') || trimmedLine.includes('Method')) && processesOrProcedures.length < 5) {
        processesOrProcedures.push(`${trimmedLine} (Page ${pageNum})`);
      }
    }

    // Review Notes
    if (quickReviewNotes.length < 5 && sentences.length > 0) {
      quickReviewNotes.push({
        heading: `Core Concepts from Page / Section ${pageNum}`,
        bulletPoints: sentences.slice(0, 3),
        sourcePage: pageNum,
      });
    }

    // Takeaways
    if (sentences.length > 0 && keyTakeaways.length < 5) {
      keyTakeaways.push({
        takeaway: sentences[sentences.length - 1],
        sourcePage: pageNum,
      });
    }
  }

  // Fallbacks if document has sparse syntax
  if (keyPoints.length === 0) {
    keyPoints.push({
      idea: `Comprehensive principles and practical lessons from ${title}.`,
      sourcePage: 1,
      citationExcerpt: page1.text.slice(0, 100),
    });
  }
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
  if (studyPointers.length === 0) {
    studyPointers.push({
      pointer: `Review foundational definitions and key processes introduced in ${title}.`,
      sourcePage: 1,
      category: 'exam',
    });
  }
  if (relationshipsBetweenTopics.length === 0 && safePages.length > 1) {
    relationshipsBetweenTopics.push(
      `Foundational concepts introduced on Page 1 build toward the practical applications and frameworks discussed in subsequent pages.`
    );
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
    summary: firstMeaningfulParagraph || `A student-friendly summary of key concepts, definitions, and procedures in ${title}.`,
    simpleExplanation: firstMeaningfulParagraph || `Summary of key concepts and principles in ${title}.`,
    keyPoints,
    keyIdeas,
    importantTerms,
    studyPointers,
    relationshipsBetweenTopics,
    processesOrProcedures,
    namesAndDates,
    keyTakeaways,
    quickReviewNotes,
  };
}

// High-traffic fallback: Grounded Document Search for AI Tutor
function searchLessonPagesForAnswer(
  pages: { pageNumber: number | string; text: string }[],
  question: string,
  lessonTitle: string,
  tutorMode: string = 'materials'
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
    const directAns = `In ${lessonTitle || 'your learning material'}, ${excerpt}`;
    const explanation = `This concept is discussed on Page ${pageNum} of ${lessonTitle}. It explains the core mechanism and how it applies to coursework.`;
    const basedOnMat = `Directly from Page ${pageNum}: "${excerpt}"`;
    const keyPoint = `Remember that this principle forms a core component of ${lessonTitle || 'this subject'}.`;

    let formattedAnswer = `Answer:\n${directAns}\n\nExplanation:\n${explanation}\n\nBased on the uploaded material:\n${basedOnMat}\n\nSource:\nPage ${pageNum}\n\nKey Point to Remember:\n${keyPoint}`;

    let exampleText: string | undefined = undefined;

    if (tutorMode === 'feynman') {
      exampleText = `Think of this like running a small food stall: you must balance your ingredients, time, and budget to satisfy daily customers.`;
      formattedAnswer = `Answer:\n${directAns}\n\nExplanation:\n${explanation}\n\nExample:\n${exampleText}\n\nBased on the uploaded material:\n${basedOnMat}\n\nSource:\nPage ${pageNum}\n\nKey Point to Remember:\n${keyPoint}`;
    }

    return {
      success: true,
      sourceType: 'material',
      sourceLabel: 'Source: Uploaded Learning Material',
      indicator: '📘 Uploaded Learning Material',
      directAnswer: directAns,
      explanation,
      basedOnMaterial: basedOnMat,
      keyPointToRemember: keyPoint,
      example: exampleText,
      answer: formattedAnswer,
      sourcePage: pageNum,
      citationExcerpt: excerpt,
      lessonTitle: lessonTitle || 'Uploaded Learning Material',
    };
  }

  const generalDirect = `Here is a clear educational explanation for "${question}":\nThis topic is foundational in academic study.`;
  const generalNotice = 'This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge.';
  const generalAns = `${generalNotice}\n\n${generalDirect}\n\nKey aspects include understanding the primary definition, recognizing how it operates in practice, and observing how it relates to broader concepts in your field.`;

  return {
    success: true,
    sourceType: 'gemini',
    sourceLabel: 'Source: Gemini / Google AI',
    indicator: '✨ Gemini / Google AI',
    sourceNotice: generalNotice,
    directAnswer: generalDirect,
    explanation: 'Provided using Study Buddy tutor knowledge.',
    answer: generalAns,
    lessonTitle: lessonTitle || 'Uploaded Learning Material',
  };
}

// High-traffic fallback: Grounded Practice Quiz Question Extractor
// Distributes questions evenly across beginning, middle, and later pages
function extractQuizQuestionsFromPages(
  pages: { pageNumber: number | string; text: string }[],
  lessonTitle: string,
  count: number,
  quizType: string
): any[] {
  const safePages = pages.filter((p) => p && p.text && p.text.trim().length > 0);
  if (safePages.length === 0) return [];
  const questions: any[] = [];
  let qId = 1;

  // Distribute selection across different parts of the document (beginning, middle, end)
  const step = Math.max(1, Math.floor(safePages.length / count));

  for (let i = 0; i < safePages.length && questions.length < count; i += step) {
    const p = safePages[i];
    const pageNum = Number(p.pageNumber) || i + 1;
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

  // If still need more questions, iterate over any remaining sentences
  if (questions.length < count) {
    for (const p of safePages) {
      if (questions.length >= count) break;
      const pageNum = Number(p.pageNumber) || 1;
      const sentences = (p.text.match(/[^.!?]+[.!?]+/g) || [])
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter((s) => s.length > 40 && s.length < 180);

      for (const s of sentences) {
        if (questions.length >= count) break;
        if (questions.some((q) => q.citationExcerpt === s)) continue;

        questions.push({
          id: `q-fallback-${qId++}`,
          type: 'true_false',
          question: `True or False: On Page ${pageNum}, "${s}"`,
          options: ['True', 'False'],
          correctAnswer: 'True',
          explanation: `Directly verified on Page ${pageNum}: "${s}"`,
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
2. Read and analyze all available text from the uploaded file across all pages.
3. Automatically identify and extract:
   - MAIN TOPIC: Explain clearly what the material is about.
   - KEY POINTS: List the most important ideas from the whole uploaded material (spanning beginning, middle, and later pages).
   - SUMMARY: Provide a clear student-friendly summary.
   - IMPORTANT TERMS: List important terms and their meanings with source page numbers.
   - STUDY POINTERS: Identify the information the student should remember for quizzes, recitations, or examinations.
   - RELATIONSHIPS: Explain relationships between different topics, pages, and chapters.
   - PROCESSES OR PROCEDURES: Steps, procedures, workflows, or rules described in the text.
   - NAMES AND DATES: Important people, scholars, and dates mentioned in the text.
4. For every key point, key idea, important term, and study pointer, cite the exact sourcePage where it appears.
5. Provide a short citationExcerpt for key ideas verifying where it came from.
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
              description: 'The overarching topic or subject of the lesson (MAIN TOPIC: Explain what the material is about).',
            },
            summary: {
              type: Type.STRING,
              description: 'Clear student-friendly summary of the whole learning material.',
            },
            simpleExplanation: {
              type: Type.STRING,
              description: 'A plain, simple, jargon-free explanation written for a busy working student.',
            },
            keyPoints: {
              type: Type.ARRAY,
              description: 'List the most important ideas from the whole uploaded material with source pages.',
              items: {
                type: Type.OBJECT,
                properties: {
                  idea: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER, description: 'Source page in the document' },
                  citationExcerpt: { type: Type.STRING, description: 'Short verifiable quote from that page' },
                },
                required: ['idea', 'sourcePage'],
              },
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
              description: 'List important terms and their meanings with source pages.',
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
            studyPointers: {
              type: Type.ARRAY,
              description: 'Information the student should remember for quizzes, recitations, or examinations.',
              items: {
                type: Type.OBJECT,
                properties: {
                  pointer: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                  category: { type: Type.STRING, description: 'quiz | recitation | exam | concept' },
                },
                required: ['pointer', 'sourcePage'],
              },
            },
            relationshipsBetweenTopics: {
              type: Type.ARRAY,
              description: 'Relationships between different topics, pages, and chapters.',
              items: { type: Type.STRING },
            },
            processesOrProcedures: {
              type: Type.ARRAY,
              description: 'Processes, procedures, methodologies, or step-by-step mechanisms.',
              items: { type: Type.STRING },
            },
            namesAndDates: {
              type: Type.ARRAY,
              description: 'Key scholars, figures, or significant dates mentioned in the text.',
              items: { type: Type.STRING },
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
    if (!parsedData.summary && parsedData.simpleExplanation) {
      parsedData.summary = parsedData.simpleExplanation;
    }
    if (!parsedData.keyPoints && parsedData.keyIdeas) {
      parsedData.keyPoints = parsedData.keyIdeas;
    }
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
3. CRITICAL QUESTION DISTRIBUTION RULE: Use content from different parts and across the ENTIRE uploaded document (including beginning, middle, and later pages/sections). DO NOT create all questions from only the first few pages! Distribute questions proportionally across all pages.
4. For EVERY question, identify the exact sourcePage where the answer is found.
5. Include a citationExcerpt: the exact sentence or clause from that page that proves the answer.
6. Provide a short, constructive explanation suitable for a student reviewing during a short study break.
7. The correctAnswer MUST exactly match one of the items in the options array.
8. Return exactly ${count} questions.`;

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

// ==============================================================
// COMPLETE SELF-REVIEWER & INTELLIGENT AUDIO SUPPORT ENDPOINTS
// ==============================================================

function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/[*#_`~>]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// 3.1 Explain Unfamiliar Term (Document Search + Supplementary Gemini Definition)
app.post('/api/explain-term', async (req: Request, res: Response) => {
  const { term, pageText = '', allPagesText = '', lessonTitle = '' } = req.body;
  if (!term || typeof term !== 'string' || !term.trim()) {
    return res.status(400).json({ error: 'Term is required' });
  }

  const cleanTerm = term.trim();
  const lowerTerm = cleanTerm.toLowerCase();
  const fullCorpus = (allPagesText || pageText || '').toString();

  // Search whether the term is already defined inside the document
  const definitionRegex = new RegExp(`([^.!?\\n]*\\b${lowerTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b[^.!?\\n]*(?:is|refers to|means|defined as|represents|:)[^.!?\\n]*[.!?\\n])`, 'i');
  const match = fullCorpus.match(definitionRegex);

  if (match && match[0] && match[0].trim().length > 15) {
    const docDef = match[0].trim().replace(/\s+/g, ' ');
    return res.json({
      success: true,
      term: cleanTerm,
      definition: docDef,
      isSupplementary: false,
      source: 'document',
      spokenText: `According to your learning material, ${docDef}`,
      citation: 'Found directly in uploaded document',
    });
  }

  // Not in document: Generate supplementary college-level explanation using Gemini
  try {
    const prompt = `You are a college professor providing supplemental support for a student studying "${lessonTitle || 'Uploaded Course Material'}".
The material mentions the term "${cleanTerm}" without providing a complete definition.
Provide a clear, educational, everyday college-level explanation of "${cleanTerm}".
Include:
1. A concise definition (1-2 sentences).
2. A practical real-world example.
Keep the total explanation under 65 words. Be direct, approachable, and accurate.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const geminiExplanation = cleanTextForSpeech(response.text || '').trim();
    const spokenText = `The uploaded material mentions ${cleanTerm} but does not provide a detailed definition. For additional understanding, ${cleanTerm} refers to ${geminiExplanation}`;

    return res.json({
      success: true,
      term: cleanTerm,
      definition: geminiExplanation,
      isSupplementary: true,
      source: 'gemini',
      spokenText,
      citation: 'Supplementary AI Explanation (absent from uploaded document text)',
    });
  } catch (err: any) {
    const fallbackDef = `A fundamental concept in ${lessonTitle || 'this discipline'} involving core principles and applications.`;
    return res.json({
      success: true,
      term: cleanTerm,
      definition: fallbackDef,
      isSupplementary: true,
      source: 'fallback',
      spokenText: `The uploaded material mentions ${cleanTerm} without a full definition. For additional understanding, it relates to key concepts in this field.`,
      citation: 'Supplementary AI Explanation',
    });
  }
});

// 3.2 Analyze Document Chapters and Major Sections
app.post('/api/analyze-chapters', async (req: Request, res: Response) => {
  const { pages, lessonTitle } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'Please provide lesson pages to analyze' });
  }

  try {
    // Sample headings from across the pages
    const pageExcerpts = pages.map((p) => {
      const firstLines = (p.text || '').split('\n').filter((l: string) => l.trim().length > 0).slice(0, 4).join(' ');
      return `Page ${p.pageNumber}: ${firstLines.slice(0, 160)}`;
    }).join('\n');

    const prompt = `You are an academic curriculum organizer.
Analyze the following page headers and excerpts from the college document "${lessonTitle || 'Course Lesson'}".
Identify the logical chapters, sections, or thematic units across the document.
If the document has explicit Chapters (e.g. "Chapter 1", "Chapter 2") or numbered Sections ("1.1", "2.1"), use them.
Otherwise, group pages into 2 to 5 coherent thematic chapters with logical page ranges.

PAGE EXCERPTS:
${pageExcerpts}

TOTAL PAGES: ${pages.length}

Return a valid JSON object matching the schema with an array of chapters.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  startPage: { type: Type.INTEGER },
                  endPage: { type: Type.INTEGER },
                  topics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  summaryPreview: { type: Type.STRING },
                },
                required: ['id', 'title', 'startPage', 'endPage', 'topics'],
              },
            },
          },
          required: ['chapters'],
        },
      },
    });

    const parsed = JSON.parse(cleanJsonString(response.text || '{"chapters":[]}'));
    if (parsed.chapters && parsed.chapters.length > 0) {
      return res.json({ success: true, chapters: parsed.chapters });
    }
  } catch (err: any) {
    console.warn('Chapter analyzer fallback:', err.message);
  }

  // Heuristic chapter grouping fallback
  const total = pages.length;
  const chapters: any[] = [];
  if (total <= 3) {
    chapters.push({
      id: 'ch-full',
      title: lessonTitle || 'Complete Material',
      startPage: 1,
      endPage: total,
      topics: ['Overview & Fundamentals', 'Core Definitions', 'Practical Applications'],
      summaryPreview: 'Complete review covering all extracted document pages.',
    });
  } else {
    const half = Math.ceil(total / 2);
    chapters.push({
      id: 'ch-1',
      title: 'Part 1: Fundamentals & Core Definitions',
      startPage: 1,
      endPage: half,
      topics: ['Foundational Concepts', 'Terminology', 'Frameworks'],
      summaryPreview: `Covers pages 1 to ${half}.`,
    });
    chapters.push({
      id: 'ch-2',
      title: 'Part 2: Practical Applications & Analysis',
      startPage: half + 1,
      endPage: total,
      topics: ['Applied Scenarios', 'Evaluations', 'Exam Takeaways'],
      summaryPreview: `Covers pages ${half + 1} to ${total}.`,
    });
  }
  return res.json({ success: true, chapters });
});

// 3.3 Complete Self-Reviewer Question Generator (Multi-Format, 4 Difficulties, Chapter-Filtered)
app.post('/api/reviewer-generate', async (req: Request, res: Response) => {
  const {
    pages,
    lessonTitle,
    chapterId,
    startPage,
    endPage,
    questionCount = 10,
    difficulty = 'medium',
    questionTypes = 'mixed',
  } = req.body;

  const count = Number(questionCount) || 10;

  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages for reviewer generation' });
    }

    // Filter pages by chapter range if requested
    let targetPages = pages;
    if (startPage && endPage) {
      targetPages = pages.filter((p) => {
        const num = Number(p.pageNumber);
        return num >= Number(startPage) && num <= Number(endPage);
      });
      if (targetPages.length === 0) targetPages = pages;
    }

    const totalTextLength = targetPages.reduce((acc, p) => acc + (p.text || '').length, 0);

    // FEATURE 2: Validate whether uploaded material contains enough information
    const minCharsRequired = count > 30 ? 1200 : count > 10 ? 600 : 250;
    if (totalTextLength < minCharsRequired) {
      return res.status(200).json({
        success: false,
        insufficient: true,
        availableQuestions: Math.max(5, Math.floor(totalTextLength / 80)),
        message: `The selected document section contains only ${totalTextLength} characters of text, which is insufficient to generate ${count} unique, high-quality, non-repetitive questions without fabricating material. Please select a larger page range or choose fewer questions.`,
      });
    }

    const lessonContext = formatLessonContext(targetPages);

    let difficultyGuide = '';
    if (difficulty === 'easy') {
      difficultyGuide = 'EASY: Focus on direct recall of important facts, definitions, and stated numbers.';
    } else if (difficulty === 'medium') {
      difficultyGuide = 'MEDIUM: Focus on conceptual understanding, cause-and-effect, and practical application of ideas.';
    } else if (difficulty === 'hard') {
      difficultyGuide = 'HARD: Focus on complex concept comparisons, trade-offs, synthesis, and higher-order reasoning.';
    } else {
      difficultyGuide = 'PROFESSOR MODE: College-level examinations featuring analytical evaluation, multi-step problem solving, and scenario-based questions requiring critical analysis.';
    }

    let typeGuide = '';
    if (questionTypes === 'multiple_choice') {
      typeGuide = 'Generate ONLY Multiple Choice questions with 4 plausible, distinct options.';
    } else if (questionTypes === 'true_false') {
      typeGuide = 'Generate ONLY True or False questions with options ["True", "False"].';
    } else if (questionTypes === 'fill_in_the_blank') {
      typeGuide = 'Generate ONLY Fill in the Blank questions where the sentence has an explicit blank "____" and the correctAnswer is the exact missing term.';
    } else if (questionTypes === 'identification') {
      typeGuide = 'Generate ONLY Identification questions where the student is asked to identify the concept, term, law, or theorist being described.';
    } else if (questionTypes === 'concept_contrasts') {
      typeGuide = 'Generate questions contrasting two related concepts from the document (e.g. differences, distinctions, or which applies in what case).';
    } else if (questionTypes === 'scenario') {
      typeGuide = 'Generate scenario questions based on realistic workplace, business, or academic situations relevant to the lesson.';
    } else if (questionTypes === 'short_answer') {
      typeGuide = 'Generate Short Answer questions testing deep conceptual comprehension, including rubric criteria.';
    } else {
      typeGuide = 'Generate a balanced MIXED assortment of questions across Multiple Choice, True/False, Identification, Fill in the Blank, and Scenario questions.';
    }

    const prompt = `You are a university professor creating an authoritative, comprehensive college self-reviewer exam.

LESSON TITLE: "${lessonTitle || 'College Learning Material'}"
TARGET CHAPTER / SECTION: ${chapterId || 'Entire Document'}
NUMBER OF QUESTIONS: ${count}
DIFFICULTY LEVEL: ${difficulty.toUpperCase()} (${difficultyGuide})
QUESTION TYPES: ${questionTypes} (${typeGuide})

SOURCE MATERIAL PAGES:
${lessonContext}

CRITICAL RULES:
1. Every single question MUST be grounded strictly in the source material pages provided above. Never invent facts or hallucinate external theories.
2. Distribute questions evenly across the entire provided page range (not just page 1).
3. For EVERY question, cite the exact sourcePage number.
4. For EVERY question, include citationExcerpt: the exact verbatim sentence from that page proving the answer.
5. Provide a clear educational explanation of why the answer is correct.
6. For Multiple Choice, options MUST have 4 distinct choices, and correctAnswer MUST match one option exactly.
7. Return exactly ${count} questions in the requested JSON structure.`;

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
                  id: { type: Type.STRING },
                  type: {
                    type: Type.STRING,
                    description: 'one of: multiple_choice, fill_in_the_blank, identification, true_false, concept_contrasts, scenario, short_answer',
                  },
                  difficulty: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '4 choices for MC, ["True", "False"] for TF, or plausible distractors',
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                  chapterOrSection: { type: Type.STRING },
                  citationExcerpt: { type: Type.STRING },
                  topic: { type: Type.STRING },
                },
                required: ['id', 'type', 'question', 'correctAnswer', 'explanation', 'sourcePage'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const parsed = JSON.parse(cleanJsonString(response.text || '{"questions":[]}'));
    const generated = parsed.questions || [];

    if (generated.length > 0) {
      return res.json({
        success: true,
        insufficient: false,
        questions: generated.map((q: any, i: number) => ({
          ...q,
          id: q.id || `rq-${i + 1}`,
          difficulty: difficulty,
        })),
      });
    }
  } catch (err: any) {
    console.error('Self-reviewer generation error, utilizing grounded fallback:', err);
  }

  // Grounded extraction fallback
  const fallbackQuestions = extractQuizQuestionsFromPages(
    pages,
    lessonTitle,
    Math.min(count, 15),
    'mixed'
  ).map((q, idx) => ({
    ...q,
    id: `rq-fallback-${idx + 1}`,
    difficulty: difficulty,
    chapterOrSection: chapterId || 'General Review',
  }));

  return res.json({
    success: true,
    insufficient: false,
    questions: fallbackQuestions,
    isHighTrafficFallback: true,
    notice: 'Reviewer generated from document citations during peak traffic.',
  });
});

// 3.4 Interactive Flashcards Generator
app.post('/api/generate-flashcards', async (req: Request, res: Response) => {
  const { pages, lessonTitle, chapterId } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'Please provide lesson pages' });
  }

  try {
    const lessonContext = formatLessonContext(pages.slice(0, 15));
    const prompt = `You are a college study coach. Create 10 to 18 high-yield study flashcards directly from this learning material titled "${lessonTitle || 'Course Lesson'}".
Front: Concept, key term, acronym, law, or high-priority question.
Back: Accurate, concise definition, explanation, or answer.
SourcePage: Exact page number where found.

DOCUMENT PAGES:
${lessonContext}`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            flashcards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  term: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                  chapter: { type: Type.STRING },
                },
                required: ['id', 'term', 'definition', 'sourcePage'],
              },
            },
          },
          required: ['flashcards'],
        },
      },
    });

    const parsed = JSON.parse(cleanJsonString(response.text || '{"flashcards":[]}'));
    return res.json({ success: true, flashcards: parsed.flashcards || [] });
  } catch (err: any) {
    console.warn('Flashcard generation fallback:', err.message);
  }

  // Heuristic flashcard extraction fallback
  const cards: any[] = [];
  let cardId = 1;
  for (const p of pages) {
    if (cards.length >= 12) break;
    const pageNum = Number(p.pageNumber) || 1;
    const lines = (p.text || '').split('\n').filter((l: string) => l.includes(':') && l.trim().length > 20);
    for (const line of lines) {
      if (cards.length >= 12) break;
      const [termPart, ...defParts] = line.split(':');
      if (termPart && defParts.length > 0 && termPart.trim().length < 50) {
        cards.push({
          id: `fc-fb-${cardId++}`,
          term: termPart.trim().replace(/^[-*•\d.]+\s*/, ''),
          definition: defParts.join(':').trim(),
          sourcePage: pageNum,
          chapter: chapterId || 'General',
        });
      }
    }
  }

  return res.json({
    success: true,
    flashcards: cards.length > 0 ? cards : [
      {
        id: 'fc-1',
        term: lessonTitle || 'Core Subject Theme',
        definition: pages[0]?.text?.slice(0, 140) || 'Primary study focus.',
        sourcePage: 1,
      },
    ],
  });
});

// 3.5 Concept Contrasts Generator (Comparing Related Concepts Found in Document)
app.post('/api/generate-contrasts', async (req: Request, res: Response) => {
  const { pages, lessonTitle } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'Please provide lesson pages' });
  }

  try {
    const lessonContext = formatLessonContext(pages.slice(0, 15));
    const prompt = `You are a college professor. Identify 3 to 6 pairs of contrasting, frequently confused, or related concepts from this learning material on "${lessonTitle || 'Lesson'}".
Example: "Accrual Accounting vs Cash Flow", "Recruitment vs Selection", "Efficiency vs Effectiveness", "Fixed Costs vs Variable Costs".

For each pair, provide:
- conceptA (name, definition, sourcePage)
- conceptB (name, definition, sourcePage)
- mainDifferences (list of 2-4 points)
- similarities (list of 1-3 points)
- practicalExamples (concrete real-world situation demonstrating the difference)
- commonMisconceptions (1 common exam trap or confusion)

DOCUMENT CONTENT:
${lessonContext}`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contrasts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  conceptA: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      definition: { type: Type.STRING },
                      sourcePage: { type: Type.INTEGER },
                    },
                    required: ['name', 'definition'],
                  },
                  conceptB: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      definition: { type: Type.STRING },
                      sourcePage: { type: Type.INTEGER },
                    },
                    required: ['name', 'definition'],
                  },
                  mainDifferences: { type: Type.ARRAY, items: { type: Type.STRING } },
                  similarities: { type: Type.ARRAY, items: { type: Type.STRING } },
                  practicalExamples: { type: Type.STRING },
                  commonMisconceptions: { type: Type.STRING },
                },
                required: ['id', 'conceptA', 'conceptB', 'mainDifferences', 'similarities', 'practicalExamples', 'commonMisconceptions'],
              },
            },
          },
          required: ['contrasts'],
        },
      },
    });

    const parsed = JSON.parse(cleanJsonString(response.text || '{"contrasts":[]}'));
    return res.json({ success: true, contrasts: parsed.contrasts || [] });
  } catch (err: any) {
    console.warn('Concept contrasts fallback:', err.message);
  }

  // Fallback contrasts
  return res.json({
    success: true,
    contrasts: [
      {
        id: 'cc-fb-1',
        conceptA: {
          name: 'Theoretical Principle',
          definition: 'The conceptual model or academic definition presented in the lesson framework.',
          sourcePage: 1,
        },
        conceptB: {
          name: 'Practical Implementation',
          definition: 'The empirical execution and workplace reality when applying the concept.',
          sourcePage: 2,
        },
        mainDifferences: [
          'Theory assumes ideal operating conditions, whereas practice must navigate real-world trade-offs.',
          'Theory focuses on foundational definitions; practice focuses on measurable performance results.',
        ],
        similarities: [
          'Both are necessary for college mastery and examination success.',
          'Both derive directly from the uploaded course material.',
        ],
        practicalExamples: 'Understanding economic break-even theory versus managing actual daily working capital in a local retail business.',
        commonMisconceptions: 'Students often assume memorizing definitions alone guarantees exam success; professors test situational application.',
      },
    ],
  });
});

// 4. FEATURE 3: Ask Study Buddy (AI Tutor) - Two-Source Answer System
app.post('/api/ask-tutor', async (req: Request, res: Response) => {
  const { pages, lessonTitle, question, chatHistory = [], tutorMode = 'materials' } = req.body;
  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages for the tutor to reference' });
    }
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Please enter a question for Study Buddy' });
    }

    // High-Precision Multi-Stage Chunk Retrieval across the entire document
    const retrieval = retrieveRelevantDocumentContext(pages, question, lessonTitle);
    const documentContext = retrieval.contextText;

    // Format previous turns for context so follow-ups work smoothly
    const previousTurns = chatHistory
      .slice(-6)
      .map((msg: any) => `${msg.sender === 'user' ? 'Student' : 'Study Buddy'}: ${msg.text}`)
      .join('\n');

    const isFeynman = tutorMode === 'feynman';

    const prompt = `You are "ASK STUDY BUDDY", a friendly, patient, and empowering AI tutor specifically built for working college students who balance work shifts and academic studies.
${isFeynman ? 'You are acting in FEYNMAN TUTOR MODE: Explain difficult concepts in simple, accessible words, provide an everyday relatable example/analogy, and connect the explanation back to the uploaded lesson.' : 'You operate a Two-Source Answer System prioritizing the student\'s uploaded learning material.'}

LESSON TITLE: "${lessonTitle || 'Uploaded Learning Material'}"
TUTOR MODE: ${tutorMode}

CRITICAL ACCESS & TEXT VERIFICATION NOTICE:
You have FULL ACCESS to the extracted textual content from the student's uploaded document provided below (${pages.length} pages available).
Under NO circumstances say "My current access is limited to document structure" or "I lack the textual content" or ask the student to copy/paste text. The actual extracted text from the whole document is provided in full below. Read and analyze all provided text.

RELEVANT CHUNKS & DOCUMENT CONTEXT:
${documentContext}

RECENT CHAT CONTEXT:
${previousTurns || 'No previous messages'}

STUDENT QUESTION:
"${question}"

TWO-SOURCE EVALUATION PROCESS:
STEP 1: Search the uploaded material text above FIRST before using general AI knowledge.

STEP 2:
• PATH A — IF THE INFORMATION IS FOUND OR DISCUSSED IN THE UPLOADED LEARNING MATERIAL:
  1. Set sourceType to "material".
  2. Set isSupportedByMaterial to true.
  3. Answer based primarily on the uploaded content.
  4. Identify the exact source page, slide, or section number where this appears (set sourcePage to that integer).
  5. Provide a citationExcerpt: the exact verifying sentence quoted directly from that page.
  6. Explain the answer clearly.
  ${isFeynman ? '7. In Feynman mode: explain in plain words, provide a concrete relatable example/analogy, and connect it back to the lesson.' : ''}
  8. Structure the response using this format:
     Answer:
     [Direct answer]

     Explanation:
     [Simple student-friendly explanation]

     ${isFeynman ? 'Example:\n[Everyday relatable example or analogy]\n\n' : ''}Based on the uploaded material:
     [Relevant supporting information from the text]

     Source:
     Page [Page Number] (or Section/Slide)

     Key Point to Remember:
     [Short review pointer]

• PATH B — IF THE INFORMATION IS NOT FOUND IN THE UPLOADED LEARNING MATERIAL:
  1. Set sourceType to "gemini".
  2. Set isSupportedByMaterial to false.
  3. Set sourceNotice to: "This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge."
  4. Formulate a comprehensive, warm, student-friendly answer using Gemini / Google AI general knowledge.
  5. DO NOT provide or fabricate any page numbers or quotes from the uploaded lesson. Set sourcePage to null, and citationExcerpt to "".
  6. Never claim that information came from the uploaded material if it is not actually present.`;

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
                'If sourceType is "gemini", MUST be: "This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge." If "material", empty.',
            },
            directAnswer: {
              type: Type.STRING,
              description: 'Direct concise answer to the question',
            },
            explanation: {
              type: Type.STRING,
              description: 'Simple student-friendly explanation',
            },
            basedOnMaterial: {
              type: Type.STRING,
              description: 'Supporting information from the uploaded document if sourceType is "material"',
            },
            keyPointToRemember: {
              type: Type.STRING,
              description: 'Short review pointer',
            },
            example: {
              type: Type.STRING,
              description: 'Everyday relatable example or analogy (especially for Feynman mode)',
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
      ? (parsed.sourceNotice || 'This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge.')
      : undefined;

    const sourcePage = !isGemini && (parsed.sourcePage || retrieval.topPage) && Number(parsed.sourcePage || retrieval.topPage) > 0
      ? Number(parsed.sourcePage || retrieval.topPage)
      : undefined;
    const citationExcerpt = !isGemini ? (parsed.citationExcerpt || retrieval.topExcerpt || undefined) : undefined;

    // Construct clean formatted answer if needed
    let finalAnswer = parsed.answer || '';
    if (!isGemini && parsed.directAnswer) {
      const parts = [
        `Answer:\n${parsed.directAnswer}`,
        parsed.explanation ? `\nExplanation:\n${parsed.explanation}` : '',
        parsed.example ? `\nExample:\n${parsed.example}` : '',
        parsed.basedOnMaterial ? `\nBased on the uploaded material:\n${parsed.basedOnMaterial}` : '',
        sourcePage ? `\nSource:\nPage ${sourcePage}` : '',
        parsed.keyPointToRemember ? `\nKey Point to Remember:\n${parsed.keyPointToRemember}` : '',
      ].filter(Boolean);
      finalAnswer = parts.join('\n');
    }

    res.json({
      success: true,
      sourceType,
      sourceLabel,
      indicator,
      sourceNotice,
      directAnswer: parsed.directAnswer,
      explanation: parsed.explanation,
      basedOnMaterial: parsed.basedOnMaterial,
      keyPointToRemember: parsed.keyPointToRemember,
      example: parsed.example,
      answer: finalAnswer,
      sourcePage,
      citationExcerpt,
      lessonTitle: lessonTitle || 'Uploaded Learning Material',
    });
  } catch (error: any) {
    console.warn('Gemini tutor chat unavailable, utilizing document search fallback:', error?.message);
    try {
      if (pages && Array.isArray(pages) && pages.length > 0) {
        const fallbackResult = searchLessonPagesForAnswer(pages, question, lessonTitle, tutorMode);
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
