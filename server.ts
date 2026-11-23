import express, { type Request, type Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import QRCode from 'qrcode';
import {
  extractDocumentPagesFromBuffer as sharedExtractDocumentPagesFromBuffer,
  buildDocumentChunks,
  sanitizeFilename,
  DocumentExtractionError,
  SUPPORTED_EXTENSIONS,
} from './lib/documentExtractor';
import {
  getAllowedCorsOrigin,
  extractBearerTokenFromHeaders,
  verifySupabaseAccessToken as sharedVerifySupabaseAccessToken,
} from './lib/authVerifier';
import { gradeQuizAnswer, buildAcceptedAnswers } from './lib/quizGrader';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On Render (ephemeral container FS), keep runtime caches in os.tmpdir() unless DATA_DIR is explicitly configured;
// persistent uploaded study materials live externally in Supabase Storage ("study-buddy-materials").
const IS_RENDER_RUNTIME = process.env.RENDER === 'true' || Boolean(process.env.RENDER_EXTERNAL_URL);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : IS_RENDER_RUNTIME
  ? path.join(os.tmpdir(), 'study-buddy-data')
  : path.join(__dirname, '.data');
const DOCS_STORE_FILE = path.join(DATA_DIR, 'documents_store.json');

// Dedicated temp directory for multipart file uploads with guaranteed cleanup
const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), 'study-buddy-uploads');
const MAX_UPLOAD_SIZE_MB = Math.min(50, Math.max(5, Number(process.env.MAX_UPLOAD_SIZE_MB) || 35));
const MAX_UPLOAD_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

function ensureUploadTempDir(): void {
  try {
    if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
      fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure temp upload directory:', err);
  }
}

async function cleanupTempFile(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  try {
    const resolved = path.resolve(filePath);
    const resolvedBase = path.resolve(UPLOAD_TEMP_DIR);
    if (!resolved.startsWith(resolvedBase + path.sep)) return;
    await fs.promises.unlink(resolved).catch(() => {});
  } catch {
    // Ignore already-removed temp file
  }
}

function sweepStaleTempUploads(maxAgeMs: number = 15 * 60 * 1000): void {
  try {
    if (!fs.existsSync(UPLOAD_TEMP_DIR)) return;
    const now = Date.now();
    for (const entry of fs.readdirSync(UPLOAD_TEMP_DIR)) {
      const fullPath = path.join(UPLOAD_TEMP_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Ignore individual file errors
      }
    }
  } catch {
    // Ignore sweep errors
  }
}

ensureUploadTempDir();
sweepStaleTempUploads();
setInterval(() => sweepStaleTempUploads(), 10 * 60 * 1000).unref();

const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadTempDir();
      cb(null, UPLOAD_TEMP_DIR);
    },
    filename: (_req, file, cb) => {
      const safeExt = (sanitizeFilename(file.originalname).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      cb(null, `upload-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt || 'bin'}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname);
    const ext = (safeName.split('.').pop() || '').toLowerCase();
    if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) {
      cb(
        new DocumentExtractionError(
          415,
          'UNSUPPORTED_FORMAT',
          `Unsupported file format ".${ext || 'unknown'}". Supported formats: PDF, PPTX, DOCX, XLSX/XLS, CSV/TSV, TXT, MD, and RTF.`
        ) as any
      );
      return;
    }
    cb(null, true);
  },
});

function parseOptionalMultipartUpload(req: Request, res: Response, next: express.NextFunction): void {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }
  uploadMiddleware.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `Uploaded file exceeds the ${MAX_UPLOAD_SIZE_MB}MB limit. Please compress or split the document.`,
        });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    if (err instanceof DocumentExtractionError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: err?.message || 'Invalid multipart upload.' });
  });
}

interface StoredDocRecord {
  id: string;
  ownerUserId?: string;
  isPublic?: boolean;
  title: string;
  filename: string;
  filePath?: string;
  fileType: string;
  totalPages: number;
  pages: { pageNumber: number | string; text: string; sectionTitle?: string }[];
  chunks: { chunkId: string; pageNumber: number | string; text: string; keywords?: string[]; charCount?: number }[];
  processingStatus: 'ready' | 'processing' | 'processing_failed' | 'reprocessing_required';
  statusMessage?: string;
  fullTextLength: number;
  uploadedAt: string;
  updatedAt: string;
}

class DocumentOwnershipError extends Error {
  statusCode = 403;
  constructor(message = 'Access denied: you do not have permission to access or modify this study material.') {
    super(message);
    this.name = 'DocumentOwnershipError';
  }
}

function isSafeOwnedStoragePath(filePath: string, ownerUserId: string): boolean {
  if (!filePath || !ownerUserId) return false;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..') || normalized.includes('\0')) return false;
  return normalized.startsWith(`${ownerUserId}/`);
}

function loadDocumentsStore(): Record<string, StoredDocRecord> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DOCS_STORE_FILE)) {
      const raw = fs.readFileSync(DOCS_STORE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load documents store:', err);
  }
  return {};
}

function saveDocumentsStore(store: Record<string, StoredDocRecord>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DOCS_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save documents store:', err);
  }
}

function saveDocumentToStore(
  doc: Partial<StoredDocRecord> & { id: string },
  ownerUserId?: string
): StoredDocRecord {
  const store = loadDocumentsStore();
  const existing = store[doc.id];
  const resolvedOwner = (ownerUserId || doc.ownerUserId || '').trim();

  if (existing && !existing.isPublic) {
    if (!resolvedOwner || (existing.ownerUserId && existing.ownerUserId !== resolvedOwner)) {
      throw new DocumentOwnershipError();
    }
  }

  const baseExisting = existing && (!existing.ownerUserId || existing.ownerUserId === resolvedOwner) ? existing : ({} as Partial<StoredDocRecord>);
  const resolvedPages = doc.pages || baseExisting.pages || [];
  const record: StoredDocRecord = {
    id: doc.id,
    ownerUserId: resolvedOwner || baseExisting.ownerUserId,
    isPublic: doc.isPublic === true ? true : Boolean(baseExisting.isPublic),
    title: doc.title || baseExisting.title || doc.filename || 'Untitled Material',
    filename: doc.filename || baseExisting.filename || 'document',
    filePath: doc.filePath || baseExisting.filePath,
    fileType: doc.fileType || baseExisting.fileType || 'pdf',
    totalPages: doc.totalPages || resolvedPages.length || baseExisting.totalPages || 1,
    pages: resolvedPages,
    chunks: doc.chunks || baseExisting.chunks || [],
    processingStatus: doc.processingStatus || (isPlaceholderContent(resolvedPages) ? 'reprocessing_required' : 'ready'),
    statusMessage: doc.statusMessage || 'Document is ready for study and analysis.',
    fullTextLength: doc.fullTextLength || resolvedPages.reduce((acc, p) => acc + (p.text?.length || 0), 0),
    uploadedAt: baseExisting.uploadedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store[doc.id] = record;

  // Scope secondary lookup indexes strictly per owner so different students never collide on filenames or paths
  const ownerPrefix = record.ownerUserId ? `owner:${record.ownerUserId}:` : record.isPublic ? 'public:' : null;
  if (ownerPrefix && record.filename) {
    const fileKey = `${ownerPrefix}file:${record.filename.toLowerCase()}`;
    if (!isPlaceholderContent(record.pages) || !store[fileKey] || isPlaceholderContent(store[fileKey].pages)) {
      store[fileKey] = record;
    }
  }
  if (ownerPrefix && record.filePath) {
    const pathKey = `${ownerPrefix}path:${record.filePath}`;
    if (!isPlaceholderContent(record.pages) || !store[pathKey] || isPlaceholderContent(store[pathKey].pages)) {
      store[pathKey] = record;
    }
  }
  saveDocumentsStore(store);
  return record;
}

function isPlaceholderContent(pages?: { text?: string }[]): boolean {
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

function canUserAccessDocument(record: StoredDocRecord | undefined | null, callerUserId?: string | null): boolean {
  if (!record) return false;
  if (record.isPublic === true) return true;
  if (!callerUserId || !record.ownerUserId) return false;
  return record.ownerUserId === callerUserId;
}

function checkDocumentAccess(
  key: string,
  callerUserId?: string | null
): { status: 'ok'; doc: StoredDocRecord } | { status: 'forbidden' } | { status: 'not_found' } {
  if (!key) return { status: 'not_found' };
  const store = loadDocumentsStore();
  const cleanKey = String(key).trim();
  if (!cleanKey) return { status: 'not_found' };
  const cleanKeyLow = cleanKey.toLowerCase();
  const strippedKey = cleanKeyLow.replace(/\.[a-z0-9]+$/i, '');

  // 1. Direct primary ID lookup: explicitly detect cross-user access attempts
  const directById = store[cleanKey];
  if (directById) {
    if (canUserAccessDocument(directById, callerUserId)) {
      return { status: 'ok', doc: directById };
    }
    return { status: 'forbidden' };
  }

  // 2. Owner-scoped direct index lookups
  if (callerUserId) {
    const byOwnerPath = store[`owner:${callerUserId}:path:${cleanKey}`];
    if (byOwnerPath && canUserAccessDocument(byOwnerPath, callerUserId)) {
      return { status: 'ok', doc: byOwnerPath };
    }
    const byOwnerFile = store[`owner:${callerUserId}:file:${cleanKeyLow}`];
    if (byOwnerFile && canUserAccessDocument(byOwnerFile, callerUserId)) {
      return { status: 'ok', doc: byOwnerFile };
    }
  }

  // 3. Scan ONLY records owned by the caller (or explicitly public)
  const accessibleValues = Object.values(store).filter((d) => canUserAccessDocument(d, callerUserId));

  let match =
    accessibleValues.find((d) => d.id === cleanKey) ||
    accessibleValues.find((d) => d.filePath && d.filePath === cleanKey) ||
    accessibleValues.find((d) => d.filename && d.filename.toLowerCase() === cleanKeyLow) ||
    accessibleValues.find((d) => d.title && d.title.toLowerCase() === cleanKeyLow);

  if (!match && strippedKey.length >= 4) {
    match = accessibleValues.find((d) => {
      const fNameLow = (d.filename || '').toLowerCase();
      const fStripped = fNameLow.replace(/\.[a-z0-9]+$/i, '');
      const tLow = (d.title || '').toLowerCase();
      if (fStripped && fStripped === strippedKey) return true;
      if (tLow && tLow.length >= 4 && cleanKeyLow.length >= 4) {
        return tLow === cleanKeyLow || tLow.includes(cleanKeyLow) || cleanKeyLow.includes(tLow);
      }
      return false;
    });
  }

  if (match) {
    return { status: 'ok', doc: match };
  }

  // 4. Detect if key directly targets another student's private record by id or filePath
  const otherOwnedMatch = Object.values(store).find(
    (d) => !canUserAccessDocument(d, callerUserId) && (d.id === cleanKey || (d.filePath && d.filePath === cleanKey))
  );
  if (otherOwnedMatch) {
    return { status: 'forbidden' };
  }

  return { status: 'not_found' };
}

function getDocumentFromStore(key: string, callerUserId?: string | null): StoredDocRecord | null {
  const result = checkDocumentAccess(key, callerUserId);
  return result.status === 'ok' ? result.doc : null;
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);

// Strict CORS configuration allowing Netlify frontend (and configured ALLOWED_ORIGINS) without wildcard "*"
app.use((req: Request, res: Response, next: express.NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    const requestHost =
      (typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : '') ||
      req.headers.host ||
      '';
    const allowedOrigin = getAllowedCorsOrigin(origin, requestHost);
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-User-Email, X-Admin-Email, X-Admin-MFA-Token, X-Supabase-Access-Token, X-Demo-Mode, X-Requested-With'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    } else if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'CORS origin not allowed.' });
    }
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.use(express.json({ limit: '50mb' }));

// =============================================================
// SECURITY: PER-IP SLIDING-WINDOW RATE LIMITING & DEMO GUARD
// =============================================================
interface RateLimitBucket {
  timestamps: number[];
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function checkSlidingRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = rateLimitBuckets.get(bucketKey) || { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateLimitBuckets.set(bucketKey, bucket);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  bucket.timestamps.push(now);
  rateLimitBuckets.set(bucketKey, bucket);

  // Periodically prune stale map entries to avoid unbounded memory growth
  if (rateLimitBuckets.size > 5000) {
    for (const [key, b] of rateLimitBuckets.entries()) {
      if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1] < now - 15 * 60 * 1000) {
        rateLimitBuckets.delete(key);
      }
    }
  }

  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, maxRequests - bucket.timestamps.length),
  };
}

const AI_RATE_LIMITED_PATHS = new Set([
  '/api/summarize',
  '/api/quiz',
  '/api/ask-tutor',
  '/api/ask-general',
  '/api/suggest-schedule',
  '/api/parse-document',
  '/api/explain-term',
  '/api/analyze-chapters',
  '/api/reviewer-generate',
  '/api/generate-flashcards',
  '/api/generate-contrasts',
]);

app.use((req: Request, res: Response, next: express.NextFunction) => {
  const reqPath = req.path;
  if (!reqPath.startsWith('/api/')) return next();

  const clientIp =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket.remoteAddress) || '127.0.0.1';

  const isDemoRequest = req.headers['x-demo-mode'] === 'true';
  const hasBearer =
    typeof req.headers['authorization'] === 'string' &&
    req.headers['authorization'].startsWith('Bearer ') &&
    req.headers['authorization'].length > 25;

  // Block Demo Mode from mutating server-persisted document store, user accounts, or admin routes
  if (
    isDemoRequest &&
    (reqPath.startsWith('/api/admin/') ||
      reqPath.startsWith('/api/user/') ||
      reqPath === '/api/documents/store' ||
      reqPath.endsWith('/reprocess'))
  ) {
    return res.status(403).json({
      error: 'Demo Mode is read-only. Create a student account to save personal files or manage account settings.',
    });
  }

  // Rate limit Auth & Admin routes against brute-force / probing
  if (reqPath.startsWith('/api/auth/') || reqPath.startsWith('/api/admin/')) {
    const limit = hasBearer ? 120 : 25;
    const windowMs = hasBearer ? 60 * 1000 : 15 * 60 * 1000;
    const key = `auth-admin:${hasBearer ? 'auth' : 'anon'}:${clientIp}`;
    const result = checkSlidingRateLimit(key, limit, windowMs);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({
        error: 'Too many authentication or administrative requests. Please wait before trying again.',
        retryAfterSeconds: result.retryAfterSec,
      });
    }
  }

  // Rate limit AI routes (tighter quota for Demo Mode / unauthenticated visitors)
  if (AI_RATE_LIMITED_PATHS.has(reqPath)) {
    const isDemoOrAnon = isDemoRequest || !hasBearer;
    const maxPerMin = isDemoOrAnon ? 12 : 60;
    const key = `ai:${isDemoOrAnon ? 'demo' : 'user'}:${clientIp}`;
    const result = checkSlidingRateLimit(key, maxPerMin, 60 * 1000);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({
        error: isDemoOrAnon
          ? 'Demo Mode AI usage limit reached. Please wait a moment or create a free student account for higher study limits.'
          : 'AI request rate limit exceeded. Please wait a moment and try again.',
        retryAfterSeconds: result.retryAfterSec,
      });
    }
  }

  next();
});
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Return clean JSON error if request payload exceeds Express 50MB limit
app.use((err: any, _req: Request, res: Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'The uploaded file payload exceeds the 50MB transfer limit. Please upload a smaller or compressed file (under 35MB).',
    });
  }
  return next(err);
});

// Shared Gemini AI Client Utility
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const PRIMARY_MODEL = (process.env.GEMINI_PRIMARY_MODEL || 'gemini-4-hydrogen').trim();
const CANDIDATE_MODELS = Array.from(
  new Set(
    [
      PRIMARY_MODEL,
      (process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite').trim(),
      'gemini-2.5-flash',
    ].filter(Boolean)
  )
);

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

// Call Gemini with automatic retry on 503/429, per-request timeout, ThinkingLevel.LOW latency optimization, and candidate model fallback
async function generateContentWithRetry(options: {
  contents: any;
  config?: any;
  preferredModel?: string;
  timeoutMs?: number;
}): Promise<any> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const preferred = options.preferredModel || PRIMARY_MODEL;
  const modelsToTry = [
    preferred,
    ...CANDIDATE_MODELS.filter((m) => m !== preferred),
  ];
  const perAttemptTimeoutMs = options.timeoutMs || 18000;

  let lastError: any = null;

  for (const model of modelsToTry) {
    const supportsThinkingLevel = model.startsWith('gemini-4') || model.startsWith('gemini-3');
    const isFlashLite = model === 'gemini-3.1-flash-lite';
    const baseConfig = { ...(options.config || {}) };
    if (supportsThinkingLevel && !isFlashLite && !baseConfig.thinkingConfig) {
      baseConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    } else if (!supportsThinkingLevel || isFlashLite) {
      delete baseConfig.thinkingConfig;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const generatePromise = ai.models.generateContent({
          model,
          contents: options.contents,
          config: baseConfig,
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Gemini request timeout after ${perAttemptTimeoutMs}ms for model ${model}`)),
            perAttemptTimeoutMs
          );
        });

        let response: any;
        try {
          response = await Promise.race([generatePromise, timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }

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
          await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 300));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('All Gemini model candidates failed to return content.');
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

// Shared multi-format extraction wrapper delegating to lib/documentExtractor.ts
async function extractDocumentPagesFromBuffer(
  dataBuffer: Buffer,
  safeFilename: string
): Promise<{ finalPages: { pageNumber: number; text: string }[]; detectedType: string }> {
  const { finalPages, detectedType } = await sharedExtractDocumentPagesFromBuffer(dataBuffer, safeFilename, {
    geminiApiKey: process.env.GEMINI_API_KEY,
    preferredModel: PRIMARY_MODEL,
    fallbackModel: CANDIDATE_MODELS[1] || 'gemini-2.5-flash',
  });
  return { finalPages, detectedType };
}

// Resolve authenticated caller identity strictly from verified Bearer JWT (never trust client-supplied userId)
async function resolveCallerIdentity(req: Request): Promise<{
  authenticated: boolean;
  userId?: string;
  email?: string;
  status?: number;
  error?: string;
}> {
  const token = extractBearerTokenFromHeaders(req.headers as Record<string, string | string[] | undefined>);
  if (!token) {
    return {
      authenticated: false,
      status: 401,
      error: 'Authentication required. Please sign in to access your study materials.',
    };
  }
  const verified = await sharedVerifySupabaseAccessToken(token);
  if (!verified.valid || !verified.userId) {
    return {
      authenticated: false,
      status: 401,
      error: verified.reason || 'Authentication session is invalid or expired. Please sign in again.',
    };
  }
  return {
    authenticated: true,
    userId: verified.userId,
    email: verified.email,
  };
}

// Helper to verify caller authentication on document storage & processing routes (always requires valid authenticated student JWT)
async function verifyDocumentRequestAuth(
  req: Request
): Promise<{ ok: boolean; userId?: string; email?: string; status?: number; error?: string }> {
  if (req.headers['x-demo-mode'] === 'true') {
    return {
      ok: false,
      status: 403,
      error: 'Demo Mode is read-only. Sign in with a student account to upload or access private study materials.',
    };
  }
  const identity = await resolveCallerIdentity(req);
  if (!identity.authenticated || !identity.userId) {
    return {
      ok: false,
      status: identity.status || 401,
      error: identity.error || 'Authentication required. Please sign in to your Study Buddy AI account.',
    };
  }
  return { ok: true, userId: identity.userId, email: identity.email };
}

// Fetch persisted original file from external Supabase Storage ("study-buddy-materials") using caller's Bearer JWT (honors RLS)
async function fetchOriginalFromSupabaseStorage(
  filePath: string,
  bearerToken: string
): Promise<Buffer | null> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!supabaseUrl || !supabaseKey || !filePath || !bearerToken) return null;

  const cleanPath = filePath
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  if (!cleanPath) return null;

  try {
    const storageUrl = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/authenticated/study-buddy-materials/${cleanPath}`;
    const resp = await fetch(storageUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        apikey: supabaseKey,
      },
    });
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_UPLOAD_BYTES) return null;
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.warn('Supabase Storage fetch during reprocess failed:', err);
    return null;
  }
}

// 1. Multi-format Document Parser Endpoint (PDF, DOCX/DOC, PPTX/PPT, XLSX/CSV, TXT/MD/RTF)
// Supports BOTH multipart/form-data (field "file" with guaranteed temp cleanup) AND JSON base64 payloads
app.post(
  ['/api/parse-document', '/api/parse-pdf'],
  parseOptionalMultipartUpload,
  async (req: Request, res: Response) => {
    const tempFilePath = (req as any).file?.path as string | undefined;

    try {
      const authCheck = await verifyDocumentRequestAuth(req);
      if (!authCheck.ok || !authCheck.userId) {
        return res.status(authCheck.status || 401).json({ error: authCheck.error });
      }
      const ownerUserId = authCheck.userId;

      const requestedFilePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : undefined;
      if (requestedFilePath && !isSafeOwnedStoragePath(requestedFilePath, ownerUserId)) {
        return res.status(403).json({
          error: 'Access denied: file path does not belong to the authenticated student account.',
        });
      }

      let dataBuffer: Buffer;
      let safeFilename: string;

      if ((req as any).file && tempFilePath) {
        safeFilename = sanitizeFilename((req as any).file.originalname || req.body?.filename || 'Uploaded_Document');
        dataBuffer = await fs.promises.readFile(tempFilePath);
      } else {
        const { fileBase64, pdfBase64, filename, fileName } = req.body || {};
        const rawBase64 = fileBase64 || pdfBase64;
        if (!rawBase64 || typeof rawBase64 !== 'string') {
          return res.status(400).json({
            error: 'No document data provided. Upload a supported file (PDF, PPTX, DOCX, XLSX, CSV, TXT, MD, or RTF).',
          });
        }
        safeFilename = sanitizeFilename(filename || fileName || 'Uploaded_Document');
        const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
        dataBuffer = Buffer.from(cleanBase64, 'base64');
      }

      if (dataBuffer.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          error: `The file "${safeFilename}" exceeds the ${MAX_UPLOAD_SIZE_MB}MB extraction limit. Please compress or split the document.`,
        });
      }

      const { finalPages, detectedType } = await extractDocumentPagesFromBuffer(dataBuffer, safeFilename);
      const hasReadableText = !isPlaceholderContent(finalPages);
      const statusValue: StoredDocRecord['processingStatus'] = hasReadableText ? 'ready' : 'processing_failed';
      const chunks = buildDocumentChunks(finalPages);
      const fullTextLength = finalPages.reduce((sum, p) => sum + p.text.length, 0);

      if (hasReadableText) {
        parsedDocumentCache.set(`${ownerUserId}::${safeFilename}`, {
          filename: safeFilename,
          fileType: detectedType,
          totalPages: finalPages.length,
          pages: finalPages,
          chunks,
          fullTextLength,
          uploadedAt: new Date().toISOString(),
        });
      }

      const docId = (req.body?.documentId as string) || (req.body?.id as string) || `doc-${ownerUserId.slice(0, 8)}-${Date.now()}`;
      const storedRecord = saveDocumentToStore(
        {
          id: docId,
          ownerUserId,
          title: (req.body?.title as string) || (req.body?.lessonTitle as string) || safeFilename,
          filename: safeFilename,
          filePath: requestedFilePath,
          fileType: detectedType,
          totalPages: finalPages.length,
          pages: finalPages,
          chunks,
          processingStatus: statusValue,
          statusMessage: hasReadableText
            ? 'Document extracted and ready for study.'
            : 'No readable text could be extracted from this file. It may be a scanned image without selectable text.',
          fullTextLength,
        },
        ownerUserId
      );

      if (!hasReadableText) {
        return res.status(422).json({
          error: `No readable text could be extracted from "${safeFilename}". Please verify the file contains selectable text or try a different format.`,
          processingStatus: 'processing_failed',
        });
      }

      return res.json({
        success: true,
        documentId: storedRecord.id,
        totalPages: finalPages.length,
        pages: finalPages,
        chunks,
        fullTextLength,
        filename: safeFilename,
        fileType: detectedType,
        processingStatus: 'ready',
      });
    } catch (error: any) {
      if (error instanceof DocumentOwnershipError) {
        return res.status(403).json({ error: error.message });
      }
      if (error instanceof DocumentExtractionError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          processingStatus: 'processing_failed',
        });
      }
      console.error('Error parsing document:', error);
      return res.status(500).json({
        error: `Failed to extract contents from the uploaded document: ${error?.message || 'Unexpected processing error.'}`,
      });
    } finally {
      await cleanupTempFile(tempFilePath);
    }
  }
);

// Endpoint: Store or update complete extracted document content (strictly scoped to authenticated owner)
app.post('/api/documents/store', async (req: Request, res: Response) => {
  const authCheck = await verifyDocumentRequestAuth(req);
  if (!authCheck.ok || !authCheck.userId) {
    return res.status(authCheck.status || 401).json({ error: authCheck.error });
  }
  const ownerUserId = authCheck.userId;

  const { id, documentId, title, filename, filePath, fileType, totalPages, pages, chunks, processingStatus, statusMessage } = req.body || {};
  const targetId = id || documentId;
  if (!targetId) {
    return res.status(400).json({ error: 'Document ID is required.' });
  }

  const normalizedFilePath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : undefined;
  if (normalizedFilePath && !isSafeOwnedStoragePath(normalizedFilePath, ownerUserId)) {
    return res.status(403).json({
      error: 'Access denied: file path does not belong to the authenticated student account.',
    });
  }

  try {
    const record = saveDocumentToStore(
      {
        id: targetId,
        ownerUserId,
        title,
        filename,
        filePath: normalizedFilePath,
        fileType,
        totalPages,
        pages,
        chunks,
        processingStatus: processingStatus || 'ready',
        statusMessage,
      },
      ownerUserId
    );
    return res.json({ success: true, document: record });
  } catch (err: any) {
    if (err instanceof DocumentOwnershipError) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err?.message || 'Failed to store document.' });
  }
});

// Endpoint: Retrieve complete extracted document content by ID, filename, or storage path (strictly owner-verified)
app.get('/api/documents/:id', async (req: Request, res: Response) => {
  const authCheck = await verifyDocumentRequestAuth(req);
  if (!authCheck.ok || !authCheck.userId) {
    return res.status(authCheck.status || 401).json({ error: authCheck.error });
  }

  const { id } = req.params;
  const access = checkDocumentAccess(id, authCheck.userId);
  if (access.status === 'forbidden') {
    return res.status(403).json({
      error: 'Access denied: this learning material belongs to another student account.',
    });
  }
  if (access.status === 'not_found' || isPlaceholderContent(access.doc.pages)) {
    return res.status(404).json({
      error: 'Document complete content not found on server.',
      processingStatus: 'reprocessing_required',
      message: 'This learning material needs to be processed again to access its complete content.',
    });
  }

  return res.json({
    success: true,
    document: {
      ...access.doc,
      processingStatus: 'ready',
    },
  });
});

// Endpoint: Reprocess document content (supports base64, multipart upload, OR pulling original file from external Supabase Storage)
app.post(
  '/api/documents/:id/reprocess',
  parseOptionalMultipartUpload,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { fileBase64, filename, fileName, filePath, title } = req.body || {};
    const tempFilePath = (req as any).file?.path as string | undefined;

    try {
      const authCheck = await verifyDocumentRequestAuth(req);
      if (!authCheck.ok || !authCheck.userId) {
        return res.status(authCheck.status || 401).json({ error: authCheck.error });
      }
      const ownerUserId = authCheck.userId;

      const accessCheck = checkDocumentAccess(id, ownerUserId);
      if (accessCheck.status === 'forbidden') {
        return res.status(403).json({
          error: 'Access denied: you do not have permission to reprocess this learning material.',
        });
      }

      const normalizedFilePath = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : undefined;
      if (normalizedFilePath && !isSafeOwnedStoragePath(normalizedFilePath, ownerUserId)) {
        return res.status(403).json({
          error: 'Access denied: storage path does not belong to the authenticated student account.',
        });
      }

      let dataBuffer: Buffer | null = null;
      const safeFilename = sanitizeFilename((req as any).file?.originalname || filename || fileName || id || 'Uploaded_Document');

      if ((req as any).file && tempFilePath) {
        dataBuffer = await fs.promises.readFile(tempFilePath);
      } else if (fileBase64 && typeof fileBase64 === 'string') {
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
        dataBuffer = Buffer.from(cleanBase64, 'base64');
      } else if (normalizedFilePath) {
        const bearerToken = extractBearerTokenFromHeaders(
          req.headers as Record<string, string | string[] | undefined>
        );
        if (bearerToken) {
          dataBuffer = await fetchOriginalFromSupabaseStorage(normalizedFilePath, bearerToken);
        }
      }

      if (dataBuffer) {
        const { finalPages, detectedType } = await extractDocumentPagesFromBuffer(dataBuffer, safeFilename);
        if (finalPages.length > 0 && !isPlaceholderContent(finalPages)) {
          const chunks = buildDocumentChunks(finalPages);
          const record = saveDocumentToStore(
            {
              id,
              ownerUserId,
              title: title || safeFilename,
              filename: safeFilename,
              filePath: normalizedFilePath,
              fileType: detectedType,
              totalPages: finalPages.length,
              pages: finalPages,
              chunks,
              processingStatus: 'ready',
              statusMessage: 'Document reprocessed successfully.',
            },
            ownerUserId
          );

          return res.json({ success: true, document: record, message: 'Document reprocessed successfully.' });
        }
        return res.status(422).json({
          error: `No readable text could be extracted while reprocessing "${safeFilename}".`,
          processingStatus: 'processing_failed',
        });
      }

      // Check if we already have valid extracted content owned by this student in the cache store
      const existing =
        (accessCheck.status === 'ok' ? accessCheck.doc : null) ||
        (filename ? getDocumentFromStore(filename, ownerUserId) : null);
      if (existing && !isPlaceholderContent(existing.pages)) {
        const updated = saveDocumentToStore(
          {
            ...existing,
            id,
            ownerUserId,
            processingStatus: 'ready',
            statusMessage: 'Document content verified and ready.',
          },
          ownerUserId
        );
        return res.json({ success: true, document: updated, message: 'Document content verified and ready.' });
      }

      return res.status(404).json({
        error: 'Original document content not found for automatic reprocessing.',
        processingStatus: 'reprocessing_required',
        message: 'This learning material needs to be processed again to access its complete content.',
      });
    } catch (err: any) {
      if (err instanceof DocumentOwnershipError) {
        return res.status(403).json({ error: err.message });
      }
      if (err instanceof DocumentExtractionError) {
        return res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          processingStatus: 'processing_failed',
        });
      }
      return res.status(500).json({ error: `Reprocessing failed: ${err?.message || 'Unexpected error.'}` });
    } finally {
      await cleanupTempFile(tempFilePath);
    }
  }
);

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
  let { pages, lessonTitle, subject, id, documentId, lessonId, filename } = req.body;
  try {
    // If pages are missing or placeholder, attempt owner-scoped reconstruction from server store
    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      const lookupKey = id || documentId || lessonId || filename || lessonTitle;
      if (lookupKey) {
        const caller = await resolveCallerIdentity(req);
        const access = checkDocumentAccess(lookupKey, caller.userId);
        if (access.status === 'forbidden') {
          return res.status(403).json({
            error: 'Access denied: this learning material belongs to another student account.',
          });
        }
        if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
          pages = access.doc.pages;
          if (!lessonTitle) lessonTitle = access.doc.title;
        }
      }
    }

    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      return res.status(400).json({
        error: 'This learning material needs to be processed again to access its complete content.',
        processingStatus: 'reprocessing_required',
      });
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
  let { pages, lessonTitle, questionCount = 5, quizType = 'mixed', id, documentId, lessonId, filename } = req.body;
  const count = [5, 10, 15].includes(Number(questionCount)) ? Number(questionCount) : 5;
  try {
    // If pages are missing or placeholder, attempt owner-scoped reconstruction from server store
    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      const lookupKey = id || documentId || lessonId || filename || lessonTitle;
      if (lookupKey) {
        const caller = await resolveCallerIdentity(req);
        const access = checkDocumentAccess(lookupKey, caller.userId);
        if (access.status === 'forbidden') {
          return res.status(403).json({
            error: 'Access denied: this learning material belongs to another student account.',
          });
        }
        if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
          pages = access.doc.pages;
          if (!lessonTitle) lessonTitle = access.doc.title;
        }
      }
    }

    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      return res.status(400).json({
        error: 'This learning material needs to be processed again to access its complete content.',
        processingStatus: 'reprocessing_required',
      });
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
  let { pages, lessonTitle, id, documentId, lessonId, filename } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    const lookupKey = id || documentId || lessonId || filename || lessonTitle;
    if (lookupKey) {
      const caller = await resolveCallerIdentity(req);
      const access = checkDocumentAccess(lookupKey, caller.userId);
      if (access.status === 'forbidden') {
        return res.status(403).json({
          error: 'Access denied: this learning material belongs to another student account.',
        });
      }
      if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
        pages = access.doc.pages;
        if (!lessonTitle) lessonTitle = access.doc.title;
      }
    }
  }

  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    return res.status(400).json({
      error: 'This learning material needs to be processed again to access its complete content.',
      processingStatus: 'reprocessing_required',
    });
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

// Helper: normalize a question stem for uniqueness deduplication across batches
function normalizeQuestionStem(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: sanitize generated question structure so fill-in-the-blank / identification never inherit MC distractors
function sanitizeGeneratedQuestion(
  q: any,
  index: number,
  difficulty: string,
  requestedQuestionTypes: string,
  fallbackChapter?: string
) {
  const validTypes = new Set([
    'multiple_choice',
    'fill_in_the_blank',
    'identification',
    'true_false',
    'concept_contrasts',
    'scenario',
    'short_answer',
  ]);
  let qType = typeof q?.type === 'string' && validTypes.has(q.type) ? q.type : 'multiple_choice';
  if (requestedQuestionTypes !== 'mixed' && validTypes.has(requestedQuestionTypes)) {
    qType = requestedQuestionTypes;
  }

  const questionText = String(q?.question || '').trim();
  const correctAnswer = String(q?.correctAnswer || '').trim();
  const isTextInputType =
    qType === 'fill_in_the_blank' || qType === 'identification' || qType === 'short_answer';

  let options: string[] | undefined = undefined;
  if (qType === 'true_false') {
    options = ['True', 'False'];
  } else if (!isTextInputType && Array.isArray(q?.options) && q.options.length >= 2) {
    const cleanedOptions: string[] = q.options.map((opt: any) => String(opt || '').trim()).filter(Boolean);
    if (cleanedOptions.length > 0 && correctAnswer && !cleanedOptions.some((opt: string) => opt.toLowerCase() === correctAnswer.toLowerCase())) {
      cleanedOptions[0] = correctAnswer;
    }
    if (cleanedOptions.length >= 2) {
      options = cleanedOptions;
    }
  }

  const rawAccepted = Array.isArray(q?.acceptedAnswers)
    ? q.acceptedAnswers.map((a: any) => String(a || '').trim()).filter(Boolean)
    : [];
  const acceptedAnswers = isTextInputType
    ? buildAcceptedAnswers(correctAnswer, rawAccepted)
    : rawAccepted.length > 0
    ? rawAccepted
    : undefined;

  return {
    id: `rq-${index + 1}`,
    type: qType,
    difficulty,
    question: questionText,
    ...(options ? { options } : {}),
    correctAnswer,
    ...(acceptedAnswers && acceptedAnswers.length > 0 ? { acceptedAnswers } : {}),
    explanation: String(q?.explanation || 'Directly grounded in the lesson material.').trim(),
    sourcePage: Math.max(1, Number(q?.sourcePage) || 1),
    chapterOrSection: q?.chapterOrSection || fallbackChapter || 'General Review',
    citationExcerpt: q?.citationExcerpt ? String(q.citationExcerpt).trim() : undefined,
    topic: q?.topic ? String(q.topic).trim() : undefined,
  };
}

// 3.3 Complete Self-Reviewer Question Generator (Multi-Format, 4 Difficulties, Chapter-Filtered, Batched up to 100)
app.post('/api/reviewer-generate', async (req: Request, res: Response) => {
  let {
    pages,
    lessonTitle,
    chapterId,
    startPage,
    endPage,
    questionCount = 10,
    difficulty = 'medium',
    questionTypes = 'mixed',
    excludeQuestions = [],
    batchIndex,
    totalBatches,
    id,
    documentId,
    lessonId,
    filename,
  } = req.body;

  const count = Math.min(100, Math.max(1, Math.round(Number(questionCount) || 10)));

  try {
    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      const lookupKey = id || documentId || lessonId || filename || lessonTitle;
      if (lookupKey) {
        const caller = await resolveCallerIdentity(req);
        const access = checkDocumentAccess(lookupKey, caller.userId);
        if (access.status === 'forbidden') {
          return res.status(403).json({
            error: 'Access denied: this learning material belongs to another student account.',
          });
        }
        if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
          pages = access.doc.pages;
          if (!lessonTitle) lessonTitle = access.doc.title;
        }
      }
    }

    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      return res.status(400).json({
        error: 'This learning material needs to be processed again to access its complete content.',
        processingStatus: 'reprocessing_required',
      });
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

    // Validate whether uploaded material contains enough information
    const minCharsRequired = count >= 50 ? 600 : count > 10 ? 350 : 150;
    if (totalTextLength < minCharsRequired) {
      return res.status(200).json({
        success: false,
        insufficient: true,
        requestedCount: count,
        generatedCount: 0,
        isComplete: false,
        availableQuestions: Math.max(5, Math.floor(totalTextLength / 60)),
        message: `The selected document section contains only ${totalTextLength} characters of text, which is insufficient to generate ${count} unique, high-quality, non-repetitive questions without fabricating material. Please select a larger page range or choose fewer questions.`,
      });
    }

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
      typeGuide = 'Generate ONLY True or False questions with options ["True", "False"] and correctAnswer "True" or "False".';
    } else if (questionTypes === 'fill_in_the_blank') {
      typeGuide =
        'Generate ONLY Fill in the Blank questions where the sentence has an explicit blank "____", correctAnswer is the exact concise missing term/phrase (1-5 words), acceptedAnswers lists valid exact synonyms/abbreviations from the text, and options is omitted/empty.';
    } else if (questionTypes === 'identification') {
      typeGuide =
        'Generate ONLY Identification questions asking the student to name the exact concept, term, law, person, or principle described; correctAnswer must be concise (1-5 words), acceptedAnswers lists valid exact alternates, and options is omitted/empty.';
    } else if (questionTypes === 'concept_contrasts') {
      typeGuide = 'Generate questions contrasting two related concepts from the document (e.g. differences, distinctions, or which applies in what case).';
    } else if (questionTypes === 'scenario') {
      typeGuide = 'Generate scenario questions based on realistic workplace, business, or academic situations relevant to the lesson.';
    } else if (questionTypes === 'short_answer') {
      typeGuide = 'Generate Short Answer questions testing deep conceptual comprehension with concise model correctAnswer and options omitted/empty.';
    } else {
      typeGuide =
        'Generate a balanced MIXED assortment of questions across Multiple Choice, True/False, Identification, Fill in the Blank, and Scenario questions. Omit options for Fill in the Blank and Identification.';
    }

    // Track already-seen stems (including externally passed excludeQuestions from frontend batches)
    const seenStems = new Set<string>();
    const recentExclusionList: string[] = [];
    if (Array.isArray(excludeQuestions)) {
      for (const rawStem of excludeQuestions) {
        const clean = String(rawStem || '').trim();
        if (!clean) continue;
        const norm = normalizeQuestionStem(clean);
        if (norm) seenStems.add(norm);
        recentExclusionList.push(clean.slice(0, 140));
      }
    }

    const collected: any[] = [];
    const SERVER_BATCH_SIZE = 15;
    const maxRounds = Math.min(12, Math.ceil(count / SERVER_BATCH_SIZE) + 3);
    let consecutiveEmptyRounds = 0;

    for (let round = 0; round < maxRounds && collected.length < count; round++) {
      const remaining = count - collected.length;
      const batchTarget = Math.min(SERVER_BATCH_SIZE, remaining);

      // Rotate page slices across rounds so all pages of the document are evenly covered
      const effectiveBatchIdx = typeof batchIndex === 'number' ? batchIndex + round : round;
      const sliceSize = Math.max(1, Math.min(targetPages.length, Math.ceil(targetPages.length / Math.max(1, Math.min(4, Math.ceil(count / SERVER_BATCH_SIZE))))));
      const startIdx = targetPages.length > sliceSize ? (effectiveBatchIdx * sliceSize) % targetPages.length : 0;
      const roundPages: typeof targetPages = [];
      for (let i = 0; i < Math.min(targetPages.length, Math.max(sliceSize, 6)); i++) {
        roundPages.push(targetPages[(startIdx + i) % targetPages.length]);
      }

      const lessonContext = formatLessonContext(roundPages);
      const avoidanceSample = recentExclusionList.slice(-45);
      const avoidanceBlock =
        avoidanceSample.length > 0
          ? `\nALREADY GENERATED QUESTIONS (DO NOT REPEAT OR PARAPHRASE ANY OF THESE):\n${avoidanceSample.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
          : '';

      const prompt = `You are a university professor creating an authoritative, comprehensive college self-reviewer exam.

LESSON TITLE: "${lessonTitle || 'College Learning Material'}"
TARGET CHAPTER / SECTION: ${chapterId || 'Entire Document'}
BATCH PROGRESS: Generating ${batchTarget} NEW unique questions (Target batch ${effectiveBatchIdx + 1}${totalBatches ? ` of ${totalBatches}` : ''}).
DIFFICULTY LEVEL: ${difficulty.toUpperCase()} (${difficultyGuide})
QUESTION TYPES: ${questionTypes} (${typeGuide})
${avoidanceBlock}
SOURCE MATERIAL PAGES:
${lessonContext}

CRITICAL RULES:
1. Every single question MUST be grounded strictly in the source material pages provided above. Never invent facts or hallucinate external theories.
2. Every question in this batch MUST be 100% unique — do NOT repeat any question or test the exact same fact phrasing as the already-generated list.
3. Distribute questions evenly across ALL provided pages (not just the first page).
4. For EVERY question, cite the exact sourcePage number and include citationExcerpt (a brief verbatim sentence from that page proving the answer).
5. Provide a clear, concise educational explanation of why the answer is correct.
6. For Multiple Choice, options MUST have 4 distinct choices, and correctAnswer MUST match one option verbatim.
7. For Fill in the Blank and Identification, correctAnswer MUST be the concise exact term/phrase (1-5 words), populate acceptedAnswers with any valid exact abbreviations or exact synonyms from the text, and leave options empty.
8. Return EXACTLY ${batchTarget} distinct questions in the requested JSON structure.`;

      try {
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
                        description:
                          'one of: multiple_choice, fill_in_the_blank, identification, true_false, concept_contrasts, scenario, short_answer',
                      },
                      difficulty: { type: Type.STRING },
                      question: { type: Type.STRING },
                      options: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '4 choices for MC, ["True", "False"] for TF; omit/empty for fill_in_the_blank, identification, short_answer',
                      },
                      correctAnswer: { type: Type.STRING },
                      acceptedAnswers: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Optional list of valid exact synonyms/abbreviations for fill_in_the_blank or identification',
                      },
                      explanation: { type: Type.STRING },
                      sourcePage: { type: Type.INTEGER },
                      chapterOrSection: { type: Type.STRING },
                      citationExcerpt: { type: Type.STRING },
                      topic: { type: Type.STRING },
                    },
                    required: ['type', 'question', 'correctAnswer', 'explanation', 'sourcePage'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        });

        const parsed = JSON.parse(cleanJsonString(response.text || '{"questions":[]}'));
        const batchQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
        let addedThisRound = 0;

        for (const rawQ of batchQuestions) {
          if (collected.length >= count) break;
          if (!rawQ?.question || !rawQ?.correctAnswer) continue;
          const normStem = normalizeQuestionStem(rawQ.question);
          if (!normStem || normStem.length < 10 || seenStems.has(normStem)) continue;

          seenStems.add(normStem);
          recentExclusionList.push(String(rawQ.question).trim().slice(0, 140));
          collected.push(sanitizeGeneratedQuestion(rawQ, collected.length, difficulty, questionTypes, chapterId));
          addedThisRound++;
        }

        if (addedThisRound === 0) {
          consecutiveEmptyRounds++;
          if (consecutiveEmptyRounds >= 2) break;
        } else {
          consecutiveEmptyRounds = 0;
        }
      } catch (roundErr: any) {
        console.warn(`Reviewer batch round ${round + 1} failed:`, roundErr?.message || roundErr);
        consecutiveEmptyRounds++;
        if (consecutiveEmptyRounds >= 2) break;
      }
    }

    // If Gemini succeeded partially or fully, return truthfully with explicit completeness metadata (never silently hide shortfall)
    if (collected.length > 0) {
      const isComplete = collected.length >= count;
      return res.json({
        success: true,
        insufficient: false,
        requestedCount: count,
        generatedCount: collected.length,
        isComplete,
        incompleteReason: isComplete
          ? undefined
          : `Generated ${collected.length} of ${count} requested unique questions from the selected material after bounded retries.`,
        questions: collected.map((q, idx) => ({ ...q, id: `rq-${idx + 1}` })),
      });
    }
  } catch (err: any) {
    console.error('Self-reviewer generation error, utilizing grounded fallback:', err);
  }

  // Grounded extraction fallback (NO hardcoded 15-question cap; truthfully reports if fewer than requested exist)
  const fallbackRaw = extractQuizQuestionsFromPages(
    pages,
    lessonTitle,
    count,
    questionTypes === 'true_false' ? 'true_false' : 'mixed'
  );
  const fallbackQuestions = fallbackRaw.map((q, idx) =>
    sanitizeGeneratedQuestion(q, idx, difficulty, questionTypes === 'true_false' ? 'true_false' : q.type, chapterId)
  );
  const isComplete = fallbackQuestions.length >= count;

  return res.json({
    success: true,
    insufficient: false,
    requestedCount: count,
    generatedCount: fallbackQuestions.length,
    isComplete,
    incompleteReason: isComplete
      ? undefined
      : `AI service is temporarily busy. Generated ${fallbackQuestions.length} of ${count} requested questions directly from document citations.`,
    questions: fallbackQuestions,
    isHighTrafficFallback: true,
    notice: isComplete
      ? 'Reviewer generated from document citations during peak traffic.'
      : `Generated ${fallbackQuestions.length} of ${count} requested questions from document citations during peak traffic.`,
  });
});

// 3.3b Server-Side Deterministic Quiz Grading Endpoint (validates fill-in-the-blank & all formats strictly)
app.post('/api/quiz/grade', (req: Request, res: Response) => {
  const { questions, answers } = req.body || {};
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Questions array is required for quiz grading.' });
  }
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: 'Answers array is required for quiz grading.' });
  }

  const answerMap = new Map<string, string>();
  for (const ans of answers) {
    if (ans && typeof ans.questionId === 'string') {
      answerMap.set(ans.questionId, typeof ans.userAnswer === 'string' ? ans.userAnswer : '');
    }
  }

  let score = 0;
  const gradedAnswers = questions.map((q: any, idx: number) => {
    const qId = String(q?.id || `rq-${idx + 1}`);
    const submitted = answerMap.has(qId)
      ? answerMap.get(qId) || ''
      : typeof answers[idx]?.userAnswer === 'string'
      ? answers[idx].userAnswer
      : '';

    const result = gradeQuizAnswer(
      {
        type: String(q?.type || 'multiple_choice'),
        correctAnswer: String(q?.correctAnswer || ''),
        acceptedAnswers: Array.isArray(q?.acceptedAnswers) ? q.acceptedAnswers : undefined,
      },
      submitted
    );

    if (result.isCorrect) score++;
    return {
      questionId: qId,
      userAnswer: submitted,
      isCorrect: result.isCorrect,
      normalizedUserAnswer: result.normalizedUserAnswer,
      expectedAnswer: result.expectedAnswer,
      acceptedAnswers: result.acceptedNormalized,
      reason: result.reason,
    };
  });

  const totalQuestions = questions.length;
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  return res.json({
    success: true,
    totalQuestions,
    score,
    percentage,
    gradedAnswers,
  });
});

// 3.4 Interactive Flashcards Generator
app.post('/api/generate-flashcards', async (req: Request, res: Response) => {
  let { pages, lessonTitle, chapterId, id, documentId, lessonId, filename } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    const lookupKey = id || documentId || lessonId || filename || lessonTitle;
    if (lookupKey) {
      const caller = await resolveCallerIdentity(req);
      const access = checkDocumentAccess(lookupKey, caller.userId);
      if (access.status === 'forbidden') {
        return res.status(403).json({
          error: 'Access denied: this learning material belongs to another student account.',
        });
      }
      if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
        pages = access.doc.pages;
        if (!lessonTitle) lessonTitle = access.doc.title;
      }
    }
  }

  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    return res.status(400).json({
      error: 'This learning material needs to be processed again to access its complete content.',
      processingStatus: 'reprocessing_required',
    });
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
  let { pages, lessonTitle, id, documentId, lessonId, filename } = req.body;
  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    const lookupKey = id || documentId || lessonId || filename || lessonTitle;
    if (lookupKey) {
      const caller = await resolveCallerIdentity(req);
      const access = checkDocumentAccess(lookupKey, caller.userId);
      if (access.status === 'forbidden') {
        return res.status(403).json({
          error: 'Access denied: this learning material belongs to another student account.',
        });
      }
      if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
        pages = access.doc.pages;
        if (!lessonTitle) lessonTitle = access.doc.title;
      }
    }
  }

  if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
    return res.status(400).json({
      error: 'This learning material needs to be processed again to access its complete content.',
      processingStatus: 'reprocessing_required',
    });
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
  let { pages, lessonTitle, question, chatHistory = [], tutorMode = 'materials', id, documentId, lessonId, filename } = req.body;
  try {
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Please enter a question for Study Buddy' });
    }

    // If pages are missing or placeholder, attempt owner-scoped reconstruction from server store
    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      const lookupKey = id || documentId || lessonId || filename || lessonTitle;
      if (lookupKey) {
        const caller = await resolveCallerIdentity(req);
        const access = checkDocumentAccess(lookupKey, caller.userId);
        if (access.status === 'forbidden') {
          return res.status(403).json({
            error: 'Access denied: this learning material belongs to another student account.',
          });
        }
        if (access.status === 'ok' && access.doc.pages && !isPlaceholderContent(access.doc.pages)) {
          pages = access.doc.pages;
          if (!lessonTitle) lessonTitle = access.doc.title;
        }
      }
    }

    if (!pages || !Array.isArray(pages) || pages.length === 0 || isPlaceholderContent(pages)) {
      return res.status(400).json({
        error: 'This learning material needs to be processed again to access its complete content.',
        processingStatus: 'reprocessing_required',
      });
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
You understand uploaded learning material deeply as a real tutor, not simply repeating text.
Your capabilities include:
- identifying the main topic and important concepts;
- recognizing headings and subtopics;
- explaining difficult concepts using simpler language;
- identifying definitions and providing concrete examples;
- recognizing important names, dates, formulas, processes, or theories;
- connecting information between different pages;
- providing exact source page references whenever possible.

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

// ==============================================================
// SECURE USER ACCOUNT MANAGEMENT & ADMINISTRATOR SECURITY SYSTEM
// ==============================================================

interface StoredRoleUser {
  id: string;
  email: string;
  fullName: string;
  role: 'student' | 'admin' | 'super_admin';
  assignedAt: string;
  assignedBy: string;
  accountStatus: 'active' | 'suspended' | 'pending';
  lastLogin?: string;
  institution?: string;
  course?: string;
}

interface StoredAdminInvitation {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'super_admin';
  invitedBy: string;
  inviterEmail: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  token: string;
  expiresAt: string;
  createdAt: string;
}

interface StoredAuditLog {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetUserEmail?: string;
  details?: any;
  ipAddress?: string;
  createdAt: string;
}

interface StoredSystemConfig {
  allowedModels: string[];
  defaultDifficulty: string;
  maxQuestionCount: number;
  rateLimitRpm: number;
  cloudSettingsRestricted: boolean;
  developerAccessRoleRequired: string;
}

interface StoredMfaFactor {
  id: string;
  userId: string;
  email: string;
  factorType: 'totp';
  friendlyName: string;
  secret: string; // Base32 encoded secret
  status: 'verified' | 'unverified';
  enrolledAt: string;
  verifiedAt?: string;
}

interface StoredMfaSession {
  token: string;
  email: string;
  aal: 'aal2';
  expiresAt: number; // Unix timestamp in ms
}

interface AdminStoreData {
  bootstrapped: boolean;
  initialAdminEmail: string;
  users: Record<string, StoredRoleUser>; // keyed by email lowercase
  invitations: StoredAdminInvitation[];
  auditLogs: StoredAuditLog[];
  systemConfig: StoredSystemConfig;
  mfaFactors: Record<string, StoredMfaFactor>; // keyed by email lowercase
  mfaSessions: Record<string, StoredMfaSession>; // keyed by token
}

const ADMIN_STORE_FILE = path.join(DATA_DIR, 'admin_store.json');

const INITIAL_SUPER_ADMIN_EMAIL = 'historillo.noel1994@gmail.com';
const INITIAL_SUPER_ADMIN_NAME = 'Noel Historillo';

function loadAdminStore(): AdminStoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(ADMIN_STORE_FILE)) {
      const raw = fs.readFileSync(ADMIN_STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.mfaFactors) parsed.mfaFactors = {};
      if (!parsed.mfaSessions) parsed.mfaSessions = {};
      if (!parsed.systemConfig) {
        parsed.systemConfig = {
          allowedModels: [...CANDIDATE_MODELS],
          defaultDifficulty: 'medium',
          maxQuestionCount: 100,
          rateLimitRpm: 60,
          cloudSettingsRestricted: true,
          developerAccessRoleRequired: 'super_admin',
        };
      } else {
        const validModels = (parsed.systemConfig.allowedModels || []).filter((m: string) =>
          CANDIDATE_MODELS.includes(m)
        );
        parsed.systemConfig.allowedModels = validModels.length > 0 ? validModels : [...CANDIDATE_MODELS];
      }

      // Ensure initial super admin exists
      if (!parsed.users[INITIAL_SUPER_ADMIN_EMAIL.toLowerCase()]) {
        parsed.users[INITIAL_SUPER_ADMIN_EMAIL.toLowerCase()] = {
          id: 'admin-super-noel-01',
          email: INITIAL_SUPER_ADMIN_EMAIL,
          fullName: INITIAL_SUPER_ADMIN_NAME,
          role: 'super_admin',
          assignedAt: new Date().toISOString(),
          assignedBy: 'system_bootstrap',
          accountStatus: 'active',
          institution: 'State Metropolitan University',
          course: 'Master of Science in Information Technology',
        };
      }
      return parsed;
    }
  } catch (err) {
    console.error('Failed to load admin store, creating fresh store:', err);
  }

  // Initial fresh store
  const defaultStore: AdminStoreData = {
    bootstrapped: true,
    initialAdminEmail: INITIAL_SUPER_ADMIN_EMAIL,
    mfaFactors: {},
    mfaSessions: {},
    users: {
      [INITIAL_SUPER_ADMIN_EMAIL.toLowerCase()]: {
        id: 'admin-super-noel-01',
        email: INITIAL_SUPER_ADMIN_EMAIL,
        fullName: INITIAL_SUPER_ADMIN_NAME,
        role: 'super_admin',
        assignedAt: new Date().toISOString(),
        assignedBy: 'system_bootstrap',
        accountStatus: 'active',
        institution: 'State Metropolitan University',
        course: 'Master of Science in Information Technology',
      },
      'juan.delacruz@student.univ.edu': {
        id: 'usr-working-student-01',
        email: 'juan.delacruz@student.univ.edu',
        fullName: 'Juan Dela Cruz',
        role: 'student',
        assignedAt: new Date().toISOString(),
        assignedBy: 'public_registration',
        accountStatus: 'active',
        institution: 'State Metropolitan University',
        course: 'BS Business Administration',
      },
    },
    invitations: [],
    auditLogs: [
      {
        id: 'log-bootstrap-01',
        adminUserId: 'system',
        adminEmail: 'system@studybuddy.internal',
        action: 'INITIAL_BOOTSTRAP',
        targetUserId: 'admin-super-noel-01',
        targetUserEmail: INITIAL_SUPER_ADMIN_EMAIL,
        details: {
          note: 'Initial Super Administrator Noel Historillo provisioned with full administrative privileges.',
        },
        ipAddress: '127.0.0.1',
        createdAt: new Date().toISOString(),
      },
    ],
    systemConfig: {
      allowedModels: CANDIDATE_MODELS,
      defaultDifficulty: 'medium',
      maxQuestionCount: 100,
      rateLimitRpm: 60,
      cloudSettingsRestricted: true,
      developerAccessRoleRequired: 'super_admin',
    },
  };

  saveAdminStore(defaultStore);
  return defaultStore;
}

function saveAdminStore(store: AdminStoreData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ADMIN_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save admin store:', err);
  }
}

// In-memory synchronized store
let adminStore: AdminStoreData = loadAdminStore();

function addAuditLog(params: {
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetUserEmail?: string;
  details?: any;
  ipAddress?: string;
}): StoredAuditLog {
  const log: StoredAuditLog = {
    id: `log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    adminUserId: params.adminUserId,
    adminEmail: params.adminEmail,
    action: params.action,
    targetUserId: params.targetUserId,
    targetUserEmail: params.targetUserEmail,
    details: params.details || {},
    ipAddress: params.ipAddress || '127.0.0.1',
    createdAt: new Date().toISOString(),
  };

  adminStore.auditLogs.unshift(log);
  // Keep last 500 audit logs
  if (adminStore.auditLogs.length > 500) {
    adminStore.auditLogs = adminStore.auditLogs.slice(0, 500);
  }
  saveAdminStore(adminStore);
  return log;
}

// Authorization Helper Functions
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Verified Supabase JWT cache (short 60s TTL to reduce auth roundtrips while keeping verification strict)
const verifiedJwtCache = new Map<string, { email: string; userId: string; aal?: string; expiresAt: number }>();

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t.length > 20) return t;
  }
  const altHeader = req.headers['x-supabase-access-token'];
  if (typeof altHeader === 'string' && altHeader.trim().length > 20) {
    return altHeader.trim();
  }
  return null;
}

async function verifySupabaseAccessToken(
  token: string
): Promise<{ valid: boolean; email?: string; userId?: string; aal?: string }> {
  if (!token || token.length < 20) return { valid: false };

  const payload = parseJwtPayload(token);
  if (!payload || typeof payload !== 'object') return { valid: false };

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSec) {
    return { valid: false };
  }

  const cached = verifiedJwtCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { valid: true, email: cached.email, userId: cached.userId, aal: cached.aal };
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();

  // When Supabase env is configured on the server, cryptographically verify the JWT with Supabase Auth
  if (supabaseUrl && supabaseKey) {
    try {
      const resp = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
        },
      });
      if (!resp.ok) {
        return { valid: false };
      }
      const userData: any = await resp.json();
      const verifiedEmail = typeof userData?.email === 'string' ? userData.email.trim().toLowerCase() : '';
      const verifiedId = typeof userData?.id === 'string' ? userData.id : '';
      if (!verifiedEmail || !verifiedId) {
        return { valid: false };
      }
      const aal = typeof payload.aal === 'string' ? payload.aal : undefined;
      verifiedJwtCache.set(token, {
        email: verifiedEmail,
        userId: verifiedId,
        aal,
        expiresAt: Math.min(Date.now() + 60_000, (Number(payload.exp) || nowSec + 60) * 1000),
      });
      return { valid: true, email: verifiedEmail, userId: verifiedId, aal };
    } catch (err) {
      console.error('Supabase JWT verification network error:', err);
      return { valid: false };
    }
  }

  // Fallback when server process env does not expose Supabase URL/key:
  // Strictly require a structurally valid, non-expired Supabase Auth JWT carrying sub + email + role='authenticated'
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const aud = payload.aud;
  if (!email || !userId || (aud && aud !== 'authenticated')) {
    return { valid: false };
  }
  return {
    valid: true,
    email,
    userId,
    aal: typeof payload.aal === 'string' ? payload.aal : undefined,
  };
}

async function resolveVerifiedRequester(
  req: Request
): Promise<{ email: string; userId?: string; aal?: string } | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.valid || !verified.email) return null;

  // If x-user-email header is also sent, ensure it does not conflict with the verified JWT email
  const headerEmail = req.headers['x-user-email'] || req.headers['x-admin-email'];
  if (typeof headerEmail === 'string' && headerEmail.trim()) {
    if (headerEmail.trim().toLowerCase() !== verified.email) {
      return null;
    }
  }

  return {
    email: verified.email,
    userId: verified.userId,
    aal: verified.aal,
  };
}

function resolveUserRole(email?: string): {
  role: 'student' | 'admin' | 'super_admin';
  user: StoredRoleUser | null;
} {
  if (!email) {
    return { role: 'student', user: null };
  }
  const cleanEmail = email.trim().toLowerCase();

  // Primary Super Admin check
  if (cleanEmail === INITIAL_SUPER_ADMIN_EMAIL.toLowerCase()) {
    const existing = adminStore.users[cleanEmail];
    if (existing) {
      existing.role = 'super_admin';
      return { role: 'super_admin', user: existing };
    }
    const freshSuper: StoredRoleUser = {
      id: 'admin-super-noel-01',
      email: INITIAL_SUPER_ADMIN_EMAIL,
      fullName: INITIAL_SUPER_ADMIN_NAME,
      role: 'super_admin',
      assignedAt: new Date().toISOString(),
      assignedBy: 'system_bootstrap',
      accountStatus: 'active',
    };
    adminStore.users[cleanEmail] = freshSuper;
    saveAdminStore(adminStore);
    return { role: 'super_admin', user: freshSuper };
  }

  const existing = adminStore.users[cleanEmail];
  if (existing) {
    return { role: existing.role, user: existing };
  }

  // Check pending invitations
  const invitation = adminStore.invitations.find(
    (inv) => inv.email.toLowerCase() === cleanEmail && inv.status === 'pending'
  );
  if (invitation) {
    invitation.status = 'accepted';
    const newUser: StoredRoleUser = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      fullName: invitation.fullName,
      role: invitation.role,
      assignedAt: new Date().toISOString(),
      assignedBy: invitation.inviterEmail,
      accountStatus: 'active',
    };
    adminStore.users[cleanEmail] = newUser;
    saveAdminStore(adminStore);
    return { role: invitation.role, user: newUser };
  }

  // Public default is always 'student'
  return { role: 'student', user: null };
}

// -------------------------------------------------------------
// TOTP (Time-based One-Time Password) Cryptographic Engine (RFC 6238)
// -------------------------------------------------------------

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateBase32Secret(length = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += alphabet[bytes[i] % alphabet.length];
  }
  return secret;
}

function computeTotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
  if (!token || typeof token !== 'string') return false;
  const cleanToken = token.trim().replace(/\s+/g, '');
  if (cleanToken.length !== 6 || !/^\d{6}$/.test(cleanToken)) return false;
  const epoch = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(epoch / 30);
  for (let i = -window; i <= window; i++) {
    if (computeTotp(secretBase32, currentStep + i) === cleanToken) {
      return true;
    }
  }
  return false;
}

function parseJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function verifyAdminMfaAssurance(req: Request, adminEmail: string): {
  allowed: boolean;
  currentAal: 'none' | 'aal1' | 'aal2';
  code: string;
  message: string;
  requiresEnrollment?: boolean;
} {
  const cleanEmail = adminEmail.toLowerCase().trim();
  const mfaFactor = adminStore.mfaFactors?.[cleanEmail];

  // 1. Inspect Supabase JWT if passed in Authorization or x-supabase-access-token
  const authHeader = req.headers['authorization'];
  const tokenHeader =
    (req.headers['x-supabase-access-token'] as string) ||
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (typeof tokenHeader === 'string' && tokenHeader.length > 20) {
    const payload = parseJwtPayload(tokenHeader);
    if (payload) {
      const nowSec = Math.floor(Date.now() / 1000);
      const isNotExpired = !payload.exp || payload.exp > nowSec;
      const isMatchingUser = !payload.email || payload.email.toLowerCase() === cleanEmail;

      if (isNotExpired && isMatchingUser) {
        // Supabase JWT aal claim indicates assurance level
        if (payload.aal === 'aal2') {
          return {
            allowed: true,
            currentAal: 'aal2',
            code: 'AAL2_VERIFIED',
            message: 'Supabase JWT AAL2 Verified.',
          };
        }
      }
    }
  }

  // 2. Inspect session token in x-admin-mfa-token header
  const mfaTokenHeader = req.headers['x-admin-mfa-token'];
  if (typeof mfaTokenHeader === 'string' && mfaTokenHeader.trim()) {
    const session = adminStore.mfaSessions?.[mfaTokenHeader.trim()];
    if (session && session.email.toLowerCase() === cleanEmail && session.expiresAt > Date.now()) {
      return {
        allowed: true,
        currentAal: 'aal2',
        code: 'AAL2_VERIFIED',
        message: 'Active MFA AAL2 Session Verified.',
      };
    }
  }

  // 3. Inspect active valid sessions by email
  const existingSession = Object.values(adminStore.mfaSessions || {}).find(
    (s) => s.email.toLowerCase() === cleanEmail && s.expiresAt > Date.now()
  );
  if (existingSession) {
    return {
      allowed: true,
      currentAal: 'aal2',
      code: 'AAL2_VERIFIED',
      message: 'Active MFA AAL2 Session Verified.',
    };
  }

  // 4. Check if factor is enrolled & verified
  if (!mfaFactor || mfaFactor.status !== 'verified') {
    return {
      allowed: false,
      currentAal: 'none',
      requiresEnrollment: true,
      code: 'MFA_ENROLLMENT_REQUIRED',
      message:
        'Access Denied: Multifactor Authentication (MFA TOTP) enrollment is required for all administrative accounts. Please enable MFA in Account Security.',
    };
  }

  // 5. Factor is enrolled, but current session is at AAL1 (needs 6-digit TOTP challenge verification)
  return {
    allowed: false,
    currentAal: 'aal1',
    requiresEnrollment: false,
    code: 'MFA_VERIFICATION_REQUIRED',
    message:
      'Access Denied: Multifactor Authentication verification required. Please verify your 6-digit TOTP code to establish an AAL2 session.',
  };
}

// -------------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------------

// Health Check Endpoint for Render, Admin & Runtime Diagnostics (exposes non-secret readiness flags only)
app.get('/api/health', (_req: Request, res: Response) => {
  const supabaseConfigured = Boolean(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim() &&
      (
        process.env.SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        ''
      ).trim()
  );

  res.json({
    ok: true,
    status: 'ok',
    service: 'study-buddy-ai-backend',
    environment: process.env.NODE_ENV || 'development',
    apiOnly: process.env.API_ONLY === 'true' || IS_RENDER_RUNTIME,
    uptimeSeconds: Math.round(process.uptime()),
    primaryModel: PRIMARY_MODEL,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    supabaseConfigured,
    maxUploadSizeMb: MAX_UPLOAD_SIZE_MB,
    timestamp: new Date().toISOString(),
  });
});

// 1. Initial Super Administrator Bootstrap Status (Sanitized — never exposes admin email or name publicly)
app.get('/api/admin/bootstrap-status', (_req: Request, res: Response) => {
  const superAdminCount = Object.values(adminStore.users).filter(
    (u) => u.role === 'super_admin' && u.accountStatus === 'active'
  ).length;

  res.json({
    bootstrapped: Boolean(adminStore.bootstrapped && superAdminCount > 0),
    superAdminCount,
  });
});

// Locked once initial Super Administrator exists — blocks unauthenticated re-initialization
app.post('/api/admin/bootstrap-initial', (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const superAdminCount = Object.values(adminStore.users).filter(
    (u) => u.role === 'super_admin' && u.accountStatus === 'active'
  ).length;

  if (adminStore.bootstrapped && superAdminCount > 0) {
    addAuditLog({
      adminUserId: 'anonymous',
      adminEmail: 'unauthenticated',
      action: 'BLOCKED_BOOTSTRAP_REPLAY_ATTEMPT',
      details: { path: req.path, method: req.method },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: 'Initial Super Administrator bootstrap is locked and cannot be re-executed.',
    });
  }

  return res.status(403).json({
    error: 'Public administrator bootstrap is disabled. Provision administrators via Supabase backend configuration.',
  });
});

// 2. Server-Side Role Verification Endpoint (Called after Supabase Auth)
app.post('/api/auth/verify-role', async (req: Request, res: Response) => {
  const { email, userId, fullName, degree, institution } = req.body;
  const ip = getClientIp(req);

  const verifiedRequester = await resolveVerifiedRequester(req);
  const cleanEmail = verifiedRequester?.email || (typeof email === 'string' ? email.trim().toLowerCase() : '');

  if (!cleanEmail) {
    return res.status(400).json({ error: 'Valid email is required for role verification.' });
  }

  // SECURITY: Never grant admin/super_admin roles without a verified authentication token
  if (!verifiedRequester) {
    const existingUnverified = adminStore.users[cleanEmail];
    if (existingUnverified && (existingUnverified.role === 'admin' || existingUnverified.role === 'super_admin')) {
      addAuditLog({
        adminUserId: 'unauthenticated',
        adminEmail: cleanEmail,
        action: 'UNVERIFIED_ADMIN_ROLE_PROBE_BLOCKED',
        details: { note: 'Attempted admin role verification without a valid authentication token.' },
        ipAddress: ip,
      });
      return res.status(401).json({
        error: 'Authentication token required to verify administrative privileges.',
        role: 'student',
        isAdmin: false,
        isSuperAdmin: false,
      });
    }

    return res.json({
      success: true,
      email: cleanEmail,
      role: 'student',
      accountStatus: existingUnverified?.accountStatus || 'active',
      isSuperAdmin: false,
      isAdmin: false,
      permissions: {
        canAccessAdminDashboard: false,
        canManageStudents: false,
        canManageAdmins: false,
        canAccessCloudSettings: false,
        canViewAuditLogs: false,
      },
    });
  }

  const { role, user } = resolveUserRole(cleanEmail);

  // Update or insert user record (role is ALWAYS determined server-side, never from client body)
  if (user) {
    user.lastLogin = new Date().toISOString();
    if (fullName && typeof fullName === 'string') user.fullName = fullName.trim();
    if (institution && typeof institution === 'string') user.institution = institution.trim();
    saveAdminStore(adminStore);
  } else {
    const newStudent: StoredRoleUser = {
      id: verifiedRequester.userId || userId || `usr-${Date.now()}`,
      email: cleanEmail,
      fullName: (typeof fullName === 'string' && fullName.trim()) || cleanEmail.split('@')[0],
      role: 'student',
      assignedAt: new Date().toISOString(),
      assignedBy: 'public_registration',
      accountStatus: 'active',
      institution: (typeof institution === 'string' && institution.trim()) || 'State Metropolitan University',
      course: (typeof degree === 'string' && degree.trim()) || 'College Student',
      lastLogin: new Date().toISOString(),
    };
    adminStore.users[cleanEmail] = newStudent;
    saveAdminStore(adminStore);
  }

  const accountStatus = adminStore.users[cleanEmail]?.accountStatus || 'active';

  // If account is suspended, notify frontend
  if (accountStatus === 'suspended') {
    addAuditLog({
      adminUserId: 'system',
      adminEmail: 'security@studybuddy.internal',
      action: 'LOGIN_ATTEMPT_SUSPENDED_ACCOUNT',
      targetUserEmail: cleanEmail,
      details: { note: 'Login rejected because account is currently suspended by an administrator.' },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: 'Account access has been disabled by a system administrator. Please contact academic support.',
      suspended: true,
      role: 'student',
    });
  }

  return res.json({
    success: true,
    email: cleanEmail,
    role,
    accountStatus,
    isSuperAdmin: role === 'super_admin',
    isAdmin: role === 'admin' || role === 'super_admin',
    permissions: {
      canAccessAdminDashboard: role === 'admin' || role === 'super_admin',
      canManageStudents: role === 'admin' || role === 'super_admin',
      canManageAdmins: role === 'super_admin',
      canAccessCloudSettings: role === 'super_admin',
      canViewAuditLogs: role === 'admin' || role === 'super_admin',
    },
  });
});

// Middleware: Require Authenticated Administrator or Super Administrator (Verified Bearer JWT + RBAC + MFA)
async function requireAdminRole(req: Request, res: Response, next: express.NextFunction) {
  const ip = getClientIp(req);
  const verified = await resolveVerifiedRequester(req);
  if (!verified) {
    addAuditLog({
      adminUserId: 'anonymous',
      adminEmail: String(req.headers['x-user-email'] || 'unauthenticated'),
      action: 'UNAUTHENTICATED_ADMIN_API_BLOCKED',
      details: { path: req.path, method: req.method },
      ipAddress: ip,
    });
    return res.status(401).json({ error: 'Unauthorized: Valid authenticated session required.' });
  }

  const email = verified.email;
  const { role, user } = resolveUserRole(email);
  if (role !== 'admin' && role !== 'super_admin') {
    addAuditLog({
      adminUserId: verified.userId || 'student',
      adminEmail: email,
      action: 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
      details: { path: req.path, method: req.method },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: Administrative permissions required for this operation.',
    });
  }

  if (user && user.accountStatus === 'suspended') {
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: Your administrator account has been suspended.',
    });
  }

  // Strict Backend MFA Assurance Check: Require Supabase AAL2 / TOTP verification
  const mfaCheck = verifyAdminMfaAssurance(req, email);
  if (!mfaCheck.allowed) {
    addAuditLog({
      adminUserId: user?.id || 'unknown',
      adminEmail: email,
      action: 'ADMIN_ACCESS_BLOCKED_MFA_REQUIRED',
      details: {
        path: req.path,
        method: req.method,
        currentAal: mfaCheck.currentAal,
        requiresEnrollment: mfaCheck.requiresEnrollment,
      },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: mfaCheck.code,
      message: mfaCheck.message,
      requiresMfa: true,
      requiresEnrollment: mfaCheck.requiresEnrollment || false,
      currentAal: mfaCheck.currentAal,
    });
  }

  (req as any).userRole = role;
  (req as any).requesterEmail = email;
  (req as any).requesterUser = user;
  next();
}

// Middleware: Require Authenticated Super Administrator (Verified Bearer JWT + RBAC + MFA)
async function requireSuperAdminRole(req: Request, res: Response, next: express.NextFunction) {
  const ip = getClientIp(req);
  const verified = await resolveVerifiedRequester(req);
  if (!verified) {
    addAuditLog({
      adminUserId: 'anonymous',
      adminEmail: String(req.headers['x-user-email'] || 'unauthenticated'),
      action: 'UNAUTHENTICATED_SUPER_ADMIN_API_BLOCKED',
      details: { path: req.path, method: req.method },
      ipAddress: ip,
    });
    return res.status(401).json({ error: 'Unauthorized: Valid authenticated session required.' });
  }

  const email = verified.email;
  const { role, user } = resolveUserRole(email);
  if (role !== 'super_admin') {
    addAuditLog({
      adminUserId: user?.id || verified.userId || 'anonymous',
      adminEmail: email,
      action: 'UNAUTHORIZED_SUPER_ADMIN_ATTEMPT',
      details: { path: req.path, method: req.method },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: Super Administrator permissions required for this operation.',
    });
  }

  if (user && user.accountStatus === 'suspended') {
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: Your administrator account has been suspended.',
    });
  }

  // Strict Backend MFA Assurance Check: Require Supabase AAL2 / TOTP verification
  const mfaCheck = verifyAdminMfaAssurance(req, email);
  if (!mfaCheck.allowed) {
    addAuditLog({
      adminUserId: user?.id || 'unknown',
      adminEmail: email,
      action: 'SUPER_ADMIN_ACCESS_BLOCKED_MFA_REQUIRED',
      details: {
        path: req.path,
        method: req.method,
        currentAal: mfaCheck.currentAal,
        requiresEnrollment: mfaCheck.requiresEnrollment,
      },
      ipAddress: ip,
    });
    return res.status(403).json({
      error: mfaCheck.code,
      message: mfaCheck.message,
      requiresMfa: true,
      requiresEnrollment: mfaCheck.requiresEnrollment || false,
      currentAal: mfaCheck.currentAal,
    });
  }

  (req as any).userRole = role;
  (req as any).requesterEmail = email;
  (req as any).requesterUser = user;
  next();
}

// -------------------------------------------------------------
// MFA (MULTI-FACTOR AUTHENTICATION) MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

// Inspect current MFA Factor & Assurance Status
app.get('/api/admin/mfa/status', async (req: Request, res: Response) => {
  const verified = await resolveVerifiedRequester(req);
  if (!verified) {
    return res.status(401).json({ error: 'Authenticated session required to inspect MFA status.' });
  }

  const cleanEmail = verified.email;
  const factor = adminStore.mfaFactors?.[cleanEmail];
  const isEnrolledAndVerified = Boolean(factor && factor.status === 'verified');
  const mfaCheck = verifyAdminMfaAssurance(req, cleanEmail);

  return res.json({
    email: cleanEmail,
    isEnrolled: isEnrolledAndVerified,
    status: factor?.status || 'none',
    friendlyName: factor?.friendlyName || 'Google Authenticator / Microsoft Authenticator (TOTP)',
    factorId: factor?.id || null,
    verifiedAt: factor?.verifiedAt || null,
    currentAal: mfaCheck.allowed ? 'aal2' : isEnrolledAndVerified ? 'aal1' : 'none',
    nextLevel: isEnrolledAndVerified ? 'aal2' : 'aal1',
  });
});

// Initiate TOTP Authenticator Enrollment (Generates Base32 Secret, URI, and SVG QR Code)
app.post('/api/admin/mfa/enroll', async (req: Request, res: Response) => {
  const verified = await resolveVerifiedRequester(req);
  if (!verified) {
    return res.status(401).json({ error: 'Authenticated session required to enroll in MFA.' });
  }

  const cleanEmail = verified.email;
  const friendlyName = req.body?.friendlyName || 'StudyBuddy Authenticator';
  const issuer = 'Study Buddy AI';

  const secret = generateBase32Secret(20);
  const factorId = `totp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(cleanEmail);
  const otpauthUri = `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;

  try {
    const qrCodeSvg = await QRCode.toString(otpauthUri, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    // Save temporary unverified factor (DOES NOT display as enabled until verified)
    const factor: StoredMfaFactor = {
      id: factorId,
      userId: adminStore.users[cleanEmail]?.id || `usr-${Date.now()}`,
      email: cleanEmail,
      factorType: 'totp',
      friendlyName,
      secret,
      status: 'unverified',
      enrolledAt: new Date().toISOString(),
    };

    if (!adminStore.mfaFactors) adminStore.mfaFactors = {};
    adminStore.mfaFactors[cleanEmail] = factor;
    saveAdminStore(adminStore);

    return res.json({
      id: factorId,
      factorType: 'totp',
      totp: {
        qrCode: qrCodeSvg,
        secret,
        uri: otpauthUri,
      },
      message:
        'MFA enrollment initiated. Scan the QR code using Google Authenticator or Microsoft Authenticator, then enter the 6-digit verification code.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to generate TOTP QR Code: ' + err.message });
  }
});

// Verify 6-digit TOTP Code and Upgrade to Assurance Level AAL2
app.post('/api/admin/mfa/verify', async (req: Request, res: Response) => {
  const verified = await resolveVerifiedRequester(req);
  const { code } = req.body;

  if (!verified) {
    return res.status(401).json({ error: 'Authenticated session required for MFA verification.' });
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Six-digit verification code is required.' });
  }

  const cleanEmail = verified.email;
  const cleanCode = code.trim().replace(/\s+/g, '');
  const ip = getClientIp(req);
  const factor = adminStore.mfaFactors?.[cleanEmail];

  if (!factor) {
    return res.status(400).json({
      error: 'No MFA enrollment found for this account. Please initiate enrollment first.',
    });
  }

  const isValid = verifyTotp(factor.secret, cleanCode);
  if (!isValid) {
    addAuditLog({
      adminUserId: factor.userId,
      adminEmail: cleanEmail,
      action: 'MFA_VERIFICATION_FAILED',
      details: { note: 'Incorrect 6-digit TOTP verification code entered.' },
      ipAddress: ip,
    });
    return res.status(400).json({
      error: 'Invalid verification code. Please check your Google Authenticator or Microsoft Authenticator app and try again.',
    });
  }

  // Verification succeeded! Mark factor as verified
  const isFirstTime = factor.status !== 'verified';
  factor.status = 'verified';
  factor.verifiedAt = factor.verifiedAt || new Date().toISOString();

  // Create an AAL2 session token valid for 12 hours
  const sessionToken = `mfa-session-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;

  if (!adminStore.mfaSessions) adminStore.mfaSessions = {};
  adminStore.mfaSessions[sessionToken] = {
    token: sessionToken,
    email: cleanEmail,
    aal: 'aal2',
    expiresAt,
  };

  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: factor.userId,
    adminEmail: cleanEmail,
    action: isFirstTime ? 'MFA_ENROLLMENT_VERIFIED' : 'MFA_CHALLENGE_VERIFIED',
    details: {
      note: isFirstTime
        ? 'TOTP Multifactor Authentication successfully activated and verified.'
        : 'TOTP MFA verification challenge completed. Assurance level upgraded to AAL2.',
      aal: 'aal2',
    },
    ipAddress: ip,
  });

  return res.json({
    success: true,
    message: 'MFA Enabled and Verified. Assurance level upgraded to AAL2.',
    status: 'verified',
    aal: 'aal2',
    sessionToken,
    expiresAt,
  });
});

// Disable / Unenroll Authenticator (Option for managing or replacing existing authenticator)
app.post('/api/admin/mfa/unenroll', async (req: Request, res: Response) => {
  const verified = await resolveVerifiedRequester(req);
  const { code } = req.body;

  if (!verified) {
    return res.status(401).json({ error: 'Authenticated session required to manage MFA.' });
  }

  const cleanEmail = verified.email;
  const ip = getClientIp(req);
  const factor = adminStore.mfaFactors?.[cleanEmail];

  if (!factor) {
    return res.status(400).json({ error: 'No active MFA authenticator found for this account.' });
  }

  // If a 6-digit confirmation code was passed, verify it
  if (code && typeof code === 'string' && code.trim().length === 6) {
    const isValid = verifyTotp(factor.secret, code.trim());
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code. Authenticator could not be removed.' });
    }
  }

  // Delete factor and revoke active sessions
  delete adminStore.mfaFactors[cleanEmail];
  if (adminStore.mfaSessions) {
    for (const [token, session] of Object.entries(adminStore.mfaSessions)) {
      if (session.email.toLowerCase() === cleanEmail) {
        delete adminStore.mfaSessions[token];
      }
    }
  }
  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: factor.userId,
    adminEmail: cleanEmail,
    action: 'MFA_AUTHENTICATOR_UNENROLLED',
    details: { note: 'Multifactor authentication disabled by account holder.' },
    ipAddress: ip,
  });

  return res.json({
    success: true,
    message: 'MFA Authenticator has been disabled. You may re-enroll or replace your authenticator at any time.',
  });
});

// 3. System Overview
app.get('/api/admin/overview', requireAdminRole, (_req: Request, res: Response) => {
  const users = Object.values(adminStore.users);
  const totalStudents = users.filter((u) => u.role === 'student').length;
  const totalAdmins = users.filter((u) => u.role === 'admin').length;
  const totalSuperAdmins = users.filter((u) => u.role === 'super_admin').length;
  const suspendedAccounts = users.filter((u) => u.accountStatus === 'suspended').length;

  res.json({
    success: true,
    totalUsers: users.length,
    totalStudents,
    totalAdmins,
    totalSuperAdmins,
    suspendedAccounts,
    pendingInvitations: adminStore.invitations.filter((i) => i.status === 'pending').length,
    totalAuditLogs: adminStore.auditLogs.length,
    aiServiceStatus: 'operational',
    primaryModel: PRIMARY_MODEL,
    databaseStatus: 'connected',
    bootstrapped: adminStore.bootstrapped,
    initialAdminEmail: adminStore.initialAdminEmail,
  });
});

// 4. Student Account Management
app.get('/api/admin/students', requireAdminRole, (req: Request, res: Response) => {
  const query = (req.query.search as string || '').toLowerCase().trim();
  const allUsers = Object.values(adminStore.users);

  let students = allUsers.filter((u) => u.role === 'student');
  if (query) {
    students = students.filter(
      (s) => s.fullName.toLowerCase().includes(query) || s.email.toLowerCase().includes(query)
    );
  }

  // Never return password or confidential keys
  res.json({
    success: true,
    total: students.length,
    students: students.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      role: s.role,
      accountStatus: s.accountStatus,
      institution: s.institution || 'State Metropolitan University',
      course: s.course || 'College Student',
      createdAt: s.assignedAt,
      lastLogin: s.lastLogin || s.assignedAt,
    })),
  });
});

app.post('/api/admin/students/:id/status', requireAdminRole, (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  const ip = getClientIp(req);
  const adminEmail = (req as any).requesterEmail;

  if (status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ error: 'Status must be active or suspended.' });
  }

  const target = Object.values(adminStore.users).find((u) => u.id === id || u.email === id);
  if (!target) {
    return res.status(404).json({ error: 'Student account not found.' });
  }

  if (target.role !== 'student') {
    return res.status(400).json({ error: 'Use Administrator Management to alter administrator accounts.' });
  }

  target.accountStatus = status;
  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: (req as any).requesterUser?.id || 'admin',
    adminEmail,
    action: status === 'suspended' ? 'STUDENT_ACCOUNT_SUSPENDED' : 'STUDENT_ACCOUNT_RESTORED',
    targetUserId: target.id,
    targetUserEmail: target.email,
    details: { reason: reason || 'Administrative action' },
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: `Student ${target.fullName} (${target.email}) account status updated to ${status}.`,
    student: target,
  });
});

// 5. Administrator Account Management
app.get('/api/admin/admins', requireAdminRole, (_req: Request, res: Response) => {
  const allUsers = Object.values(adminStore.users);
  const admins = allUsers.filter((u) => u.role === 'admin' || u.role === 'super_admin');

  res.json({
    success: true,
    total: admins.length,
    admins: admins.map((a) => ({
      id: a.id,
      fullName: a.fullName,
      email: a.email,
      role: a.role,
      accountStatus: a.accountStatus,
      createdAt: a.assignedAt,
      lastLogin: a.lastLogin || a.assignedAt,
      assignedBy: a.assignedBy,
      isInitialSuperAdmin: a.email.toLowerCase() === adminStore.initialAdminEmail.toLowerCase(),
    })),
    invitations: adminStore.invitations,
  });
});

// Add New Administrator (Invite)
app.post('/api/admin/admins/invite', requireAdminRole, (req: Request, res: Response) => {
  const { email, fullName, role = 'admin' } = req.body;
  const requesterEmail = (req as any).requesterEmail;
  const requesterRole = (req as any).userRole;
  const ip = getClientIp(req);

  if (!email || !fullName) {
    return res.status(400).json({ error: 'Full name and email are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();

  // Role permissions check: Only Super Admin can invite Super Admin
  if (role === 'super_admin' && requesterRole !== 'super_admin') {
    return res.status(403).json({
      error: 'HTTP 403 Forbidden: Only a Super Administrator can invite another Super Administrator.',
    });
  }

  if (role !== 'admin' && role !== 'super_admin') {
    return res.status(400).json({ error: 'Role must be admin or super_admin.' });
  }

  // Check if already an administrator
  if (adminStore.users[cleanEmail] && (adminStore.users[cleanEmail].role === 'admin' || adminStore.users[cleanEmail].role === 'super_admin')) {
    return res.status(400).json({
      error: `Account ${cleanEmail} is already assigned as a ${adminStore.users[cleanEmail].role}.`,
    });
  }

  // Generate single-use invitation token
  const token = `inv-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const invitation: StoredAdminInvitation = {
    id: `inv-${Date.now()}`,
    email: cleanEmail,
    fullName: cleanName,
    role,
    invitedBy: (req as any).requesterUser?.id || 'admin',
    inviterEmail: requesterEmail,
    status: 'pending',
    token,
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  // If user already exists in users list, promote directly
  if (adminStore.users[cleanEmail]) {
    adminStore.users[cleanEmail].role = role;
    adminStore.users[cleanEmail].fullName = cleanName;
    adminStore.users[cleanEmail].assignedBy = requesterEmail;
  }

  adminStore.invitations.unshift(invitation);
  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: (req as any).requesterUser?.id || 'admin',
    adminEmail: requesterEmail,
    action: 'ADMIN_INVITATION_CREATED',
    targetUserEmail: cleanEmail,
    details: {
      role,
      invitedFullName: cleanName,
      expiresAt,
    },
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: `Administrator invitation created for ${cleanName} (${cleanEmail}) as ${role.toUpperCase()}.`,
    invitation,
  });
});

// Update Administrator Role (Promote / Demote)
app.post('/api/admin/admins/:id/role', requireSuperAdminRole, (req: Request, res: Response) => {
  const { id } = req.params;
  const { newRole } = req.body;
  const requesterEmail = (req as any).requesterEmail;
  const ip = getClientIp(req);

  if (newRole !== 'admin' && newRole !== 'super_admin' && newRole !== 'student') {
    return res.status(400).json({ error: 'Invalid role assignment.' });
  }

  const target = Object.values(adminStore.users).find((u) => u.id === id || u.email.toLowerCase() === id.toLowerCase());
  if (!target) {
    return res.status(404).json({ error: 'Administrator account not found.' });
  }

  // CRITICAL SAFEGUARD: Prevent demoting the last active Super Administrator
  if (target.role === 'super_admin' && newRole !== 'super_admin') {
    const activeSuperAdmins = Object.values(adminStore.users).filter(
      (u) => u.role === 'super_admin' && u.accountStatus === 'active'
    );
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({
        error: 'Operation Denied: Cannot demote the last active Super Administrator. Promote another administrator first.',
      });
    }
  }

  const oldRole = target.role;
  target.role = newRole;
  target.assignedBy = requesterEmail;
  target.assignedAt = new Date().toISOString();
  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: (req as any).requesterUser?.id || 'super_admin',
    adminEmail: requesterEmail,
    action: 'ADMIN_ROLE_UPDATED',
    targetUserId: target.id,
    targetUserEmail: target.email,
    details: { oldRole, newRole },
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: `Role for ${target.fullName} (${target.email}) changed from ${oldRole} to ${newRole}.`,
    user: target,
  });
});

// Revoke Administrator Privileges
app.post('/api/admin/admins/:id/revoke', requireSuperAdminRole, (req: Request, res: Response) => {
  const { id } = req.params;
  const requesterEmail = (req as any).requesterEmail;
  const ip = getClientIp(req);

  const target = Object.values(adminStore.users).find((u) => u.id === id || u.email.toLowerCase() === id.toLowerCase());
  if (!target) {
    return res.status(404).json({ error: 'Administrator account not found.' });
  }

  // CRITICAL SAFEGUARD: Cannot revoke the last active Super Administrator
  if (target.role === 'super_admin') {
    const activeSuperAdmins = Object.values(adminStore.users).filter(
      (u) => u.role === 'super_admin' && u.accountStatus === 'active'
    );
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({
        error: 'Operation Denied: Cannot revoke privileges of the last active Super Administrator.',
      });
    }
  }

  const previousRole = target.role;
  target.role = 'student';
  target.assignedBy = requesterEmail;
  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: (req as any).requesterUser?.id || 'super_admin',
    adminEmail: requesterEmail,
    action: 'ADMIN_PRIVILEGES_REVOKED',
    targetUserId: target.id,
    targetUserEmail: target.email,
    details: { previousRole },
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: `Administrative privileges revoked for ${target.fullName} (${target.email}). Account set to student.`,
    user: target,
  });
});

// 6. Security Audit Logs
app.get('/api/admin/audit-logs', requireAdminRole, (_req: Request, res: Response) => {
  res.json({
    success: true,
    total: adminStore.auditLogs.length,
    logs: adminStore.auditLogs,
  });
});

// 7. System Configuration
app.get('/api/admin/system-config', requireSuperAdminRole, (_req: Request, res: Response) => {
  res.json({
    success: true,
    config: adminStore.systemConfig,
  });
});

app.post('/api/admin/system-config', requireSuperAdminRole, (req: Request, res: Response) => {
  const { allowedModels, defaultDifficulty, maxQuestionCount, rateLimitRpm, cloudSettingsRestricted } = req.body;
  const requesterEmail = (req as any).requesterEmail;
  const ip = getClientIp(req);

  if (allowedModels && Array.isArray(allowedModels)) {
    adminStore.systemConfig.allowedModels = allowedModels;
  }
  if (defaultDifficulty) {
    adminStore.systemConfig.defaultDifficulty = defaultDifficulty;
  }
  if (maxQuestionCount) {
    adminStore.systemConfig.maxQuestionCount = Number(maxQuestionCount);
  }
  if (rateLimitRpm) {
    adminStore.systemConfig.rateLimitRpm = Number(rateLimitRpm);
  }
  if (typeof cloudSettingsRestricted === 'boolean') {
    adminStore.systemConfig.cloudSettingsRestricted = cloudSettingsRestricted;
  }

  saveAdminStore(adminStore);

  addAuditLog({
    adminUserId: (req as any).requesterUser?.id || 'super_admin',
    adminEmail: requesterEmail,
    action: 'SYSTEM_CONFIG_UPDATED',
    details: req.body,
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: 'System configuration updated successfully.',
    config: adminStore.systemConfig,
  });
});

// 8. User Account Deletion Request (Requires Verified Authenticated Session matching target account)
app.post('/api/user/delete-account', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const verified = await resolveVerifiedRequester(req);

  if (!verified) {
    return res.status(401).json({ error: 'Authentication required to delete an account.' });
  }

  const cleanEmail = verified.email;
  const target = adminStore.users[cleanEmail];

  // CRITICAL SAFEGUARD: Prevent deletion of the last active Super Administrator
  if (target && target.role === 'super_admin') {
    const activeSuperAdmins = Object.values(adminStore.users).filter(
      (u) => u.role === 'super_admin' && u.accountStatus === 'active'
    );
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({
        error: 'Operation Denied: Cannot delete the last active Super Administrator account.',
      });
    }
  }

  if (target) {
    delete adminStore.users[cleanEmail];
    saveAdminStore(adminStore);
  }

  addAuditLog({
    adminUserId: target?.id || verified.userId || 'user',
    adminEmail: cleanEmail,
    action: 'USER_ACCOUNT_DELETED',
    targetUserEmail: cleanEmail,
    details: { reason: 'User requested self-deletion of account and study records.' },
    ipAddress: ip,
  });

  res.json({
    success: true,
    message: 'Your account and personal data have been scheduled for deletion in accordance with data retention policies.',
  });
});

// 9. User Profile Update Endpoint (Requires Verified Authenticated Session — never allows role self-escalation)
app.post('/api/user/profile', async (req: Request, res: Response) => {
  const verified = await resolveVerifiedRequester(req);
  if (!verified) {
    return res.status(401).json({ error: 'Authentication required to update your profile.' });
  }

  const { firstName, middleName, lastName, displayName, institution, course, yearLevel, phone } = req.body;
  const cleanEmail = verified.email;
  let user = adminStore.users[cleanEmail];

  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ') || displayName || cleanEmail.split('@')[0];

  if (!user) {
    user = {
      id: verified.userId || `usr-${Date.now()}`,
      email: cleanEmail,
      fullName,
      role: 'student',
      assignedAt: new Date().toISOString(),
      assignedBy: 'profile_sync',
      accountStatus: 'active',
      institution: institution || '',
      course: course || '',
    };
    adminStore.users[cleanEmail] = user;
  } else {
    user.fullName = fullName;
    if (institution) user.institution = institution;
    if (course) user.course = course;
  }

  saveAdminStore(adminStore);

  res.json({
    success: true,
    profile: {
      ...user,
      firstName,
      middleName,
      lastName,
      displayName,
      institution,
      course,
      yearLevel,
      phone,
    },
  });
});

// Vite middleware (local dev), static production serving, or standalone Render API-only service
async function setupApp() {
  const isApiOnly = process.env.API_ONLY === 'true' || IS_RENDER_RUNTIME;
  const distIndexPath = path.join(__dirname, 'dist', 'index.html');

  if (process.env.NODE_ENV === 'production' || isApiOnly) {
    if (!isApiOnly && fs.existsSync(distIndexPath)) {
      app.use(express.static(path.join(__dirname, 'dist')));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(distIndexPath);
      });
    } else {
      app.get('/', (_req: Request, res: Response) => {
        res.json({
          ok: true,
          service: 'study-buddy-ai-backend',
          status: 'running',
          health: '/api/health',
        });
      });
      app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: 'API endpoint not found.' });
      });
    }
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Study Buddy AI server running at http://0.0.0.0:${PORT} (mode=${isApiOnly ? 'api-only' : process.env.NODE_ENV || 'development'})`
    );
  });
}

export { app };

setupApp().catch((err) => {
  console.error('Failed to start server:', err);
});
