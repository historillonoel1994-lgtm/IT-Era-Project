import { GoogleGenAI, Type } from '@google/genai';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import JSZip from 'jszip';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface DocumentChunk {
  chunkId: string;
  pageNumber: number;
  text: string;
  keywords: string[];
  charCount: number;
}

export class DocumentExtractionError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const SUPPORTED_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'xlsx',
  'xls',
  'csv',
  'tsv',
  'txt',
  'md',
  'markdown',
  'rtf',
  'json',
]);

const MAX_EXTRACTION_BUFFER_BYTES = 35 * 1024 * 1024; // 35 MB hard cap
const MAX_PPTX_SLIDES = 500;
const MAX_PPTX_TOTAL_XML_CHARS = 30 * 1024 * 1024; // Zip-bomb safety cap

export function sanitizeFilename(raw?: string): string {
  const base = (raw || 'Uploaded_Document')
    .replace(/[\r\n\0]/g, '')
    .split(/[\\/]/)
    .pop() || 'Uploaded_Document';
  const cleaned = base.replace(/\.\.+/g, '.').trim();
  return (cleaned || 'Uploaded_Document').slice(0, 200);
}

export function isPlaceholderContent(pages?: { text?: string }[]): boolean {
  if (!pages || pages.length === 0) return true;
  if (pages.length === 1) {
    const text = (pages[0].text || '').trim().toLowerCase();
    if (!text) return true;
    if (text.startsWith('[document:') && text.includes('stored path:')) return true;
    if (
      text.includes('could not be completely extracted') ||
      text.includes('no readable text content found') ||
      text.includes('no readable text extracted') ||
      text.includes('no text extracted from') ||
      text.includes('contains no readable rows')
    ) {
      return true;
    }
  }
  return false;
}

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of', 'with',
  'what', 'why', 'how', 'when', 'where', 'who', 'can', 'could', 'would', 'should', 'does',
  'do', 'did', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'this',
  'that', 'these', 'those', 'it', 'its', 'from', 'by', 'as', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'explain', 'define', 'describe', 'tell', 'me', 'please', 'lesson', 'page', 'material',
  'document', 'module', 'uploaded', 'file', 'mean', 'means', 'meaning', 'what\'s', 'give',
  'summarize', 'summary', 'concept', 'topic', 'notes', 'study', 'help', 'understand',
  'ang', 'ng', 'mga', 'sa', 'na', 'at', 'ay', 'ito', 'iyon', 'para', 'kung', 'ano', 'paano',
  'bakit', 'sino', 'kailan', 'saan', 'naman', 'lang', 'din', 'rin', 'po', 'ba', 'ko', 'mo',
]);

export function extractTopKeywords(text: string, count: number = 8): string[] {
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

export function buildDocumentChunks(pages: ExtractedPage[]): DocumentChunk[] {
  return pages.map((p, idx) => ({
    chunkId: `chunk-${idx + 1}`,
    pageNumber: p.pageNumber,
    text: p.text,
    keywords: extractTopKeywords(p.text, 8),
    charCount: p.text.length,
  }));
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function extractOpenXmlParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  const pMatches = xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi) || [];

  for (const pBlock of pMatches) {
    const tMatches = pBlock.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
    if (tMatches.length === 0) continue;
    const line = tMatches
      .map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, '')))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (line.length > 0) {
      paragraphs.push(line);
    }
  }

  if (paragraphs.length > 0) {
    return paragraphs;
  }

  // Fallback for XML nodes outside <a:p>
  const textMatches = xml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
  return textMatches
    .map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, '')).trim())
    .filter((t) => t.length > 0);
}

function stripRtfToPlainText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*\}/g, ' ')
    .replace(/\\par[d]?/g, '\n\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkTextIntoPages(
  rawText: string,
  targetChunkChars: number = 1200
): ExtractedPage[] {
  const normalized = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const pages: ExtractedPage[] = [];
  let currentChunk = '';
  let pageNum = 1;

  for (const p of paragraphs) {
    const trimmedP = p.trim();
    if (currentChunk.length + trimmedP.length > targetChunkChars && currentChunk.length > 0) {
      pages.push({ pageNumber: pageNum++, text: currentChunk.trim() });
      currentChunk = '';
    }
    if (trimmedP.length > targetChunkChars * 1.5) {
      // Split very long single paragraphs on sentence or line boundaries
      const lines = trimmedP.split(/\n|(?<=[.!?])\s+/);
      for (const seg of lines) {
        if (currentChunk.length + seg.length > targetChunkChars && currentChunk.length > 0) {
          pages.push({ pageNumber: pageNum++, text: currentChunk.trim() });
          currentChunk = '';
        }
        currentChunk += (currentChunk ? ' ' : '') + seg.trim();
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedP;
    }
  }

  if (currentChunk.trim().length > 0) {
    pages.push({ pageNumber: pageNum, text: currentChunk.trim() });
  }

  return pages.length > 0
    ? pages
    : [{ pageNumber: 1, text: normalized.trim() || 'No readable text content found.' }];
}

function cleanJsonString(str: string): string {
  return str
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function isOle2CompoundBinary(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  );
}

function isZipArchive(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

async function runGeminiPdfOcrFallback(
  dataBuffer: Buffer,
  geminiApiKey: string,
  preferredModel: string,
  fallbackModel: string
): Promise<ExtractedPage[]> {
  if (!geminiApiKey || dataBuffer.length > 20 * 1024 * 1024) return [];

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const modelsToTry = [preferredModel, fallbackModel].filter(Boolean);

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: dataBuffer.toString('base64'),
              },
            },
            {
              text: 'Extract all readable educational text, headings, definitions, and content from every page of this PDF accurately in JSON format. Preserve page order.',
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    text: { type: Type.STRING },
                  },
                  required: ['pageNumber', 'text'],
                },
              },
            },
            required: ['pages'],
          },
        },
      });

      const parsed = JSON.parse(cleanJsonString(response.text || '{"pages":[]}'));
      const ocrPages: ExtractedPage[] = (parsed.pages || [])
        .filter((p: any) => p && typeof p.text === 'string' && p.text.trim().length > 0)
        .map((p: any, idx: number) => ({
          pageNumber: Number(p.pageNumber) || idx + 1,
          text: p.text.trim(),
        }));

      if (ocrPages.length > 0) {
        return ocrPages;
      }
    } catch (ocrErr: any) {
      console.warn(`Gemini PDF OCR fallback (${model}) failed:`, ocrErr?.message || ocrErr);
    }
  }

  return [];
}

export interface ExtractOptions {
  geminiApiKey?: string;
  preferredModel?: string;
  fallbackModel?: string;
}

export async function extractDocumentPagesFromBuffer(
  dataBuffer: Buffer,
  rawFilename: string,
  options?: ExtractOptions
): Promise<{ finalPages: ExtractedPage[]; detectedType: string; extractionMethod: string }> {
  const safeFilename = sanitizeFilename(rawFilename);

  if (!dataBuffer || dataBuffer.length === 0) {
    throw new DocumentExtractionError(
      400,
      'EMPTY_FILE',
      `The uploaded file "${safeFilename}" is empty (0 bytes). Please select a valid document.`
    );
  }

  if (dataBuffer.length > MAX_EXTRACTION_BUFFER_BYTES) {
    throw new DocumentExtractionError(
      413,
      'FILE_TOO_LARGE',
      `The file "${safeFilename}" exceeds the 35 MB extraction limit. Please compress or split the document before uploading.`
    );
  }

  const ext = (safeFilename.split('.').pop() || '').toLowerCase();
  if (ext && !SUPPORTED_EXTENSIONS.has(ext) && safeFilename.includes('.')) {
    throw new DocumentExtractionError(
      415,
      'UNSUPPORTED_FORMAT',
      `The file format ".${ext}" is not supported for text extraction. Supported formats: PDF, PPTX, DOCX, XLSX/XLS, CSV/TSV, TXT, MD, and RTF.`
    );
  }

  let finalPages: ExtractedPage[] = [];
  let detectedType = ext || 'document';
  let extractionMethod = 'text';

  // 1. PDF Documents (.pdf)
  if (ext === 'pdf') {
    detectedType = 'pdf';
    extractionMethod = 'pdf-parse';
    let pdfErrorMsg = '';
    let parser: any = null;

    try {
      // Dynamic import ensures non-PDF formats (PPTX/DOCX/XLSX/CSV/TXT) never load pdf-parse or native canvas
      const pdfParseModule: any = await import('pdf-parse');
      const PDFParseClass = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;

      if (typeof PDFParseClass === 'function') {
        parser = new PDFParseClass({ data: dataBuffer });
        const textResult = await parser.getText();
        const rawPages = (textResult.pages || []).map((p: any, idx: number) => ({
          pageNumber: p.num || idx + 1,
          text: (p.text || '').trim(),
        }));

        const validPages = rawPages.filter((p: ExtractedPage) => p.text.length > 0);
        if (validPages.length > 0) {
          finalPages = rawPages.map((p: ExtractedPage) => ({
            pageNumber: p.pageNumber,
            text:
              p.text.length > 0
                ? p.text
                : `[Page ${p.pageNumber} contains diagrams or visual illustrations]`,
          }));
        } else if (textResult.text && textResult.text.trim().length > 0) {
          finalPages = chunkTextIntoPages(textResult.text.trim(), 1200);
        }
      }
    } catch (pdfErr: any) {
      pdfErrorMsg = String(pdfErr?.message || pdfErr || '');
      if (/password|encrypted/i.test(pdfErrorMsg)) {
        throw new DocumentExtractionError(
          422,
          'PDF_PASSWORD_PROTECTED',
          `Cannot read "${safeFilename}" because the PDF is password-protected or encrypted. Please remove the password and upload again.`
        );
      }
      console.warn('pdf-parse warning, attempting OCR fallback if configured:', pdfErrorMsg);
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch {
          // Ignore destroy cleanup errors
        }
      }
    }

    // Fallback for scanned / image-based PDFs via Gemini Multimodal OCR (server-side secret only)
    const geminiKey = options?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '';
    if ((finalPages.length === 0 || isPlaceholderContent(finalPages)) && geminiKey) {
      const ocrPages = await runGeminiPdfOcrFallback(
        dataBuffer,
        geminiKey,
        options?.preferredModel || 'gemini-2.5-flash',
        options?.fallbackModel || 'gemini-2.0-flash'
      );
      if (ocrPages.length > 0) {
        finalPages = ocrPages;
        extractionMethod = 'gemini-ocr';
      }
    }

    if (finalPages.length === 0 || isPlaceholderContent(finalPages)) {
      throw new DocumentExtractionError(
        422,
        'PDF_NO_READABLE_TEXT',
        `No readable text could be extracted from "${safeFilename}". The PDF may be corrupted or contain scanned images without selectable text.`
      );
    }
  }
  // 2. Microsoft Word Documents (.docx, .doc)
  else if (ext === 'docx' || ext === 'doc') {
    detectedType = 'docx';
    extractionMethod = 'mammoth';

    if (ext === 'doc' && isOle2CompoundBinary(dataBuffer)) {
      // Attempt basic printable text extraction for legacy binary .doc; otherwise give explicit guidance
      const rawText = dataBuffer
        .toString('utf-8')
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
        .replace(/ {3,}/g, '\n');
      const alphaWords = rawText.match(/[A-Za-z]{4,}/g) || [];
      if (alphaWords.length >= 25) {
        finalPages = chunkTextIntoPages(rawText, 1200);
        extractionMethod = 'doc-text-fallback';
      } else {
        throw new DocumentExtractionError(
          422,
          'LEGACY_DOC_UNSUPPORTED',
          `Legacy binary Word (.doc) file "${safeFilename}" could not be parsed cleanly. Please save or export it as .docx or .pdf and upload again.`
        );
      }
    } else {
      try {
        const docxResult = await mammoth.extractRawText({ buffer: dataBuffer });
        const text = (docxResult.value || '').trim();
        if (!text) {
          throw new DocumentExtractionError(
            422,
            'DOCX_EMPTY',
            `No readable text was found inside Word document "${safeFilename}". If the document contains only images, export it as a PDF or add text content.`
          );
        }
        finalPages = chunkTextIntoPages(text, 1200);
      } catch (docErr: any) {
        if (docErr instanceof DocumentExtractionError) throw docErr;
        throw new DocumentExtractionError(
          422,
          'DOCX_PARSE_FAILED',
          `Could not read Word document "${safeFilename}": ${docErr?.message || 'The file appears corrupted or password-protected.'}`
        );
      }
    }
  }
  // 3. PowerPoint Presentations (.pptx, .ppt)
  else if (ext === 'pptx' || ext === 'ppt') {
    detectedType = 'pptx';
    extractionMethod = 'jszip-pptx';

    if (isOle2CompoundBinary(dataBuffer)) {
      throw new DocumentExtractionError(
        422,
        'LEGACY_PPT_UNSUPPORTED',
        `Legacy binary PowerPoint (.ppt) file "${safeFilename}" is not supported directly. Please open it in PowerPoint or Google Slides, export as .pptx or .pdf, and upload again.`
      );
    }

    if (!isZipArchive(dataBuffer)) {
      throw new DocumentExtractionError(
        422,
        'PPTX_INVALID_ARCHIVE',
        `"${safeFilename}" is not a valid PowerPoint (.pptx) archive. Please verify the file is not corrupted or password-protected.`
      );
    }

    try {
      const zip = await JSZip.loadAsync(dataBuffer);
      const slideFiles = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/i.test(name)
      );

      if (slideFiles.length === 0) {
        throw new DocumentExtractionError(
          422,
          'PPTX_NO_SLIDES',
          `No slides were found inside "${safeFilename}". Please verify this is a valid PowerPoint (.pptx) presentation.`
        );
      }

      if (slideFiles.length > MAX_PPTX_SLIDES) {
        throw new DocumentExtractionError(
          413,
          'PPTX_TOO_MANY_SLIDES',
          `"${safeFilename}" contains ${slideFiles.length} slides, exceeding the maximum of ${MAX_PPTX_SLIDES} slides per upload. Please split the presentation into smaller decks.`
        );
      }

      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        return numA - numB;
      });

      const pages: ExtractedPage[] = [];
      let totalXmlCharsRead = 0;
      let slidesWithReadableText = 0;

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFileName = slideFiles[i];
        const slideXml = await zip.files[slideFileName].async('text');
        totalXmlCharsRead += slideXml.length;
        if (totalXmlCharsRead > MAX_PPTX_TOTAL_XML_CHARS) {
          throw new DocumentExtractionError(
            413,
            'PPTX_DECOMPRESSION_LIMIT',
            `"${safeFilename}" exceeds the safe XML decompression limit. Please simplify or split the presentation.`
          );
        }

        const slideNum = i + 1;
        const slideParagraphs = extractOpenXmlParagraphs(slideXml);

        // Also check matching presenter/speaker notes (match by actual slide XML index or sequential index)
        const actualSlideIndex = slideFileName.match(/slide(\d+)\.xml/i)?.[1] || String(slideNum);
        const noteEntry =
          zip.files[`ppt/notesSlides/notesSlide${actualSlideIndex}.xml`] ||
          zip.files[`ppt/notesSlides/notesSlide${slideNum}.xml`];
        let notesText = '';
        if (noteEntry) {
          const noteXml = await noteEntry.async('text');
          const noteParagraphs = extractOpenXmlParagraphs(noteXml).filter(
            // Filter standalone slide-number footers inside notes
            (line) => !/^\d+$/.test(line.trim())
          );
          notesText = noteParagraphs.join(' ');
        }

        if (slideParagraphs.length > 0 || notesText.length > 0) {
          slidesWithReadableText++;
        }

        const slideContent = [
          `[Slide ${slideNum}]`,
          slideParagraphs.join('\n'),
          notesText ? `\n(Presenter Notes: ${notesText})` : '',
        ]
          .filter(Boolean)
          .join('\n');

        pages.push({
          pageNumber: slideNum,
          text:
            slideParagraphs.length > 0 || notesText.length > 0
              ? slideContent.trim()
              : `[Slide ${slideNum} - Diagrams, charts, or visual slide]`,
        });
      }

      // Extract supplementary SmartArt diagram text if slides were mostly SmartArt diagrams
      if (slidesWithReadableText === 0) {
        const diagramFiles = Object.keys(zip.files).filter((name) =>
          /^ppt\/diagrams\/data\d+\.xml$/i.test(name)
        );
        const diagramTexts: string[] = [];
        for (const df of diagramFiles) {
          const dXml = await zip.files[df].async('text');
          diagramTexts.push(...extractOpenXmlParagraphs(dXml));
        }
        if (diagramTexts.length > 0) {
          finalPages = chunkTextIntoPages(diagramTexts.join('\n\n'), 1200);
          slidesWithReadableText = finalPages.length;
        }
      }

      if (slidesWithReadableText === 0) {
        throw new DocumentExtractionError(
          422,
          'PPTX_IMAGE_ONLY',
          `No selectable text was found in "${safeFilename}". The slides appear to contain only embedded images. Try exporting the deck to PDF or adding slide text/speaker notes.`
        );
      }

      if (finalPages.length === 0) {
        finalPages = pages;
      }
    } catch (pptErr: any) {
      if (pptErr instanceof DocumentExtractionError) throw pptErr;
      throw new DocumentExtractionError(
        422,
        'PPTX_PARSE_FAILED',
        `Could not read PowerPoint presentation "${safeFilename}": ${pptErr?.message || 'The file appears corrupted or unreadable.'}`
      );
    }
  }
  // 4. Spreadsheets & CSV (.xlsx, .xls, .csv, .tsv)
  else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'tsv') {
    detectedType = ext === 'csv' || ext === 'tsv' ? 'csv' : 'xlsx';
    extractionMethod = 'xlsx';

    try {
      const workbook = xlsx.read(dataBuffer, { type: 'buffer' });
      const pages: ExtractedPage[] = [];
      let pageNum = 1;

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const csvText = xlsx.utils.sheet_to_csv(worksheet);
        if (!csvText || !csvText.trim()) continue;

        const rows = csvText.split('\n').filter((r) => r.replace(/,/g, '').trim().length > 0);
        if (rows.length === 0) continue;

        const CHUNK_SIZE = 30;
        for (let r = 0; r < rows.length; r += CHUNK_SIZE) {
          const chunkRows = rows.slice(r, r + CHUNK_SIZE);
          const startRow = r + 1;
          const endRow = Math.min(r + CHUNK_SIZE, rows.length);
          const rowLabel =
            rows.length > CHUNK_SIZE ? ` (Rows ${startRow}-${endRow} of ${rows.length})` : '';
          pages.push({
            pageNumber: pageNum++,
            text: `Spreadsheet Sheet: "${sheetName}"${rowLabel}\n\n${chunkRows.join('\n')}`,
          });
        }
      }

      if (pages.length === 0) {
        throw new DocumentExtractionError(
          422,
          'SPREADSHEET_EMPTY',
          `Spreadsheet "${safeFilename}" contains no readable rows or cell values.`
        );
      }

      finalPages = pages;
    } catch (sheetErr: any) {
      if (sheetErr instanceof DocumentExtractionError) throw sheetErr;
      throw new DocumentExtractionError(
        422,
        'SPREADSHEET_PARSE_FAILED',
        `Could not read spreadsheet "${safeFilename}": ${sheetErr?.message || 'The file may be encrypted or corrupted.'}`
      );
    }
  }
  // 5. Plain text, Markdown, RTF, JSON (.txt, .md, .markdown, .rtf, .json)
  else {
    detectedType = ext || 'txt';
    extractionMethod = 'utf8-text';
    const rawUtf8 = dataBuffer.toString('utf-8');
    const text = ext === 'rtf' ? stripRtfToPlainText(rawUtf8) : rawUtf8.trim();

    if (!text || text.trim().length === 0) {
      throw new DocumentExtractionError(
        422,
        'TEXT_EMPTY',
        `The text file "${safeFilename}" contains no readable content.`
      );
    }

    finalPages = chunkTextIntoPages(text, 1200);
  }

  return { finalPages, detectedType, extractionMethod };
}
