import {
  LessonDocument,
  LessonSummary,
  QuizQuestion,
  StudentProgress,
  DocumentChunk,
  DocumentChapter,
  ReviewerQuestion,
  ReviewerDifficulty,
  FlashcardItem,
  ConceptContrastItem,
} from '../types';
import { checkIsConfigured, supabase } from '../lib/supabase';
import { apiUrl } from '../lib/apiBase';

// Lightweight read-only getter synced by App.tsx to avoid circular imports with storage.ts
let apiDemoModeFlag = false;
export function setApiDemoMode(active: boolean): void {
  apiDemoModeFlag = active;
}

async function buildApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiDemoModeFlag) {
    headers['x-demo-mode'] = 'true';
    return headers;
  }

  if (checkIsConfigured()) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        headers['Authorization'] = `Bearer ${data.session.access_token}`;
      }
    } catch {
      // Proceed without auth header
    }
  }

  return headers;
}

export interface SummarizeParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  subject?: string;
  lessonId?: string;
  documentId?: string;
  filename?: string;
}

export interface QuizParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  questionCount: 5 | 10 | 15;
  quizType: 'multiple_choice' | 'true_false' | 'mixed';
  lessonId?: string;
  documentId?: string;
  filename?: string;
}

export interface AskTutorParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  question: string;
  chatHistory?: { sender: 'user' | 'tutor'; text: string }[];
  tutorMode?: 'materials' | 'feynman' | 'general';
  lessonId?: string;
  documentId?: string;
  filename?: string;
}

export interface StudyPlanParams {
  workSchedule: any[];
  classSchedule: any[];
  schoolTasks: any[];
}

export async function summarizeLesson(params: SummarizeParams): Promise<LessonSummary> {
  const response = await fetch(apiUrl('/api/summarize'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to summarize lesson (${response.status})`);
  }

  const data = await response.json();
  return {
    ...data.summary,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateQuiz(params: QuizParams): Promise<QuizQuestion[]> {
  const response = await fetch(apiUrl('/api/quiz'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to generate quiz (${response.status})`);
  }

  const data = await response.json();
  return data.questions || [];
}

export interface AskTutorResult {
  success: boolean;
  sourceType: 'material' | 'gemini';
  sourceLabel: string;
  indicator: string;
  sourceNotice?: string;
  answer: string;
  sourcePage?: number | string;
  sourceSection?: string;
  citationExcerpt?: string;
  directAnswer?: string;
  explanation?: string;
  basedOnMaterial?: string;
  keyPointToRemember?: string;
  example?: string;
  lessonTitle?: string;
  isSafeguardTriggered?: boolean;
}

export async function askStudyBuddy(params: AskTutorParams): Promise<AskTutorResult> {
  const response = await fetch(apiUrl('/api/ask-tutor'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Study Buddy could not answer right now. Please try again.');
  }

  return response.json();
}

export interface AskGeneralParams {
  question: string;
  chatHistory?: { sender: 'user' | 'tutor'; text: string }[];
}

/**
 * Reusable function called askGemini(question)
 * Receives the student's question, sends it through the secure backend API to Gemini generateContent,
 * waits for the response, and returns the generated answer.
 */
export async function askGemini(question: string): Promise<string> {
  const response = await fetch(apiUrl('/api/ask-general'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Study Buddy could not answer right now. Please try again.');
  }

  const data = await response.json();
  if (!data.answer) {
    throw new Error('Study Buddy could not answer right now. Please try again.');
  }

  return data.answer;
}

/**
 * Reusable function to ask Gemini a general educational or academic question
 * outside the scope of uploaded learning materials.
 */
export async function askGeneralGemini(
  questionOrParams: string | AskGeneralParams,
  chatHistory?: { sender: 'user' | 'tutor'; text: string }[]
): Promise<{
  answer: string;
}> {
  const payload =
    typeof questionOrParams === 'string'
      ? { question: questionOrParams, chatHistory }
      : questionOrParams;

  const response = await fetch(apiUrl('/api/ask-general'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Study Buddy could not answer right now. Please try again.');
  }

  return response.json();
}

export async function suggestStudySchedule(params: StudyPlanParams): Promise<{
  overview: string;
  weeklyTips: string[];
  suggestedSessions: any[];
}> {
  const response = await fetch(apiUrl('/api/suggest-schedule'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to generate study schedule (${response.status})`);
  }

  const data = await response.json();
  return data.plan;
}

export interface ParsedDocumentResult {
  totalPages: number;
  pages: { pageNumber: number; text: string }[];
  chunks?: DocumentChunk[];
  fullTextLength?: number;
  fileType?: string;
  filename?: string;
}

export async function parseDocumentFile(
  base64: string,
  filename: string,
  fileType?: string,
  metadata?: { documentId?: string; title?: string; filePath?: string }
): Promise<ParsedDocumentResult> {
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/parse-document'), {
      method: 'POST',
      headers: await buildApiHeaders(),
      body: JSON.stringify({
        fileBase64: base64,
        filename,
        fileType,
        documentId: metadata?.documentId,
        title: metadata?.title,
        filePath: metadata?.filePath,
      }),
    });
  } catch {
    throw new Error(
      `Could not reach the Study Buddy AI document extraction server while processing "${filename}". Please check your network connection or backend service availability.`
    );
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const errorData = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : {};

    if (errorData.error) {
      throw new Error(errorData.error);
    }

    if (response.status === 401) {
      throw new Error(
        `Authentication required to process "${filename}". Please sign in to your Study Buddy AI account and try again.`
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Document extraction backend endpoint (/api/parse-document) was not found (HTTP 404). Ensure VITE_API_BASE_URL points to your deployed Render backend service.`
      );
    }
    if (response.status === 413) {
      throw new Error(
        `"${filename}" is too large for upload (HTTP 413). Please compress or split the document into a smaller file (under 35MB).`
      );
    }
    if (response.status === 415) {
      throw new Error(
        `Unsupported file format for "${filename}". Supported formats: PDF, PPTX, DOCX, XLSX/XLS, CSV/TSV, TXT, MD, and RTF.`
      );
    }
    if (response.status === 422) {
      throw new Error(
        `No readable text could be extracted from "${filename}". Verify the file is not corrupted, password-protected, or image-only.`
      );
    }
    if (response.status === 429) {
      throw new Error('Too many extraction requests in a short time. Please wait a moment and try again.');
    }

    throw new Error(
      `Could not extract contents from "${filename}" (server error HTTP ${response.status}). Please try again or verify the file format.`
    );
  }

  return response.json();
}

export async function parsePdfFile(base64: string, filename: string): Promise<ParsedDocumentResult> {
  return parseDocumentFile(base64, filename, 'pdf');
}

export async function storeDocumentContent(docData: {
  id: string;
  documentId?: string;
  title: string;
  filename: string;
  filePath?: string;
  fileType?: string;
  totalPages: number;
  pages: { pageNumber: number | string; text: string; sectionTitle?: string }[];
  chunks?: DocumentChunk[];
  processingStatus?: 'ready' | 'processing' | 'processing_failed' | 'reprocessing_required';
  statusMessage?: string;
}): Promise<{ success: boolean; document: any }> {
  const response = await fetch(apiUrl('/api/documents/store'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(docData),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to save document content to server.');
  }

  return response.json();
}

export async function fetchDocumentContent(id: string): Promise<{ success: boolean; document: any }> {
  const response = await fetch(apiUrl(`/api/documents/${encodeURIComponent(id)}`), {
    headers: await buildApiHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Document content not found.');
  }

  return response.json();
}

export async function reprocessDocument(
  id: string,
  params?: { fileBase64?: string; filename?: string; fileType?: string; title?: string; filePath?: string }
): Promise<{ success: boolean; document: any; message?: string }> {
  const response = await fetch(apiUrl(`/api/documents/${encodeURIComponent(id)}/reprocess`), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params || {}),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Reprocessing failed.');
  }

  return response.json();
}

// ==========================================
// SELF-REVIEWER & EXPLANATION API CLIENTS
// ==========================================

export interface ExplainTermResult {
  success: boolean;
  term: string;
  definition: string;
  isSupplementary: boolean;
  source: 'document' | 'gemini' | 'fallback';
  spokenText: string;
  citation: string;
}

export async function explainUnfamiliarTerm(params: {
  term: string;
  pageText?: string;
  allPagesText?: string;
  lessonTitle?: string;
}): Promise<ExplainTermResult> {
  const response = await fetch(apiUrl('/api/explain-term'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to retrieve term explanation');
  }

  return response.json();
}

export async function analyzeDocumentChapters(params: {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  lessonId?: string;
  documentId?: string;
  filename?: string;
}): Promise<DocumentChapter[]> {
  const response = await fetch(apiUrl('/api/analyze-chapters'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to analyze chapters');
  }

  const data = await response.json();
  return data.chapters || [];
}

export interface ReviewerGenerateParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  chapterId?: string;
  startPage?: number;
  endPage?: number;
  questionCount: number;
  difficulty: ReviewerDifficulty;
  questionTypes: string;
  excludeQuestions?: string[];
  batchIndex?: number;
  totalBatches?: number;
  lessonId?: string;
  documentId?: string;
  filename?: string;
}

export interface ReviewerGenerateResult {
  success: boolean;
  insufficient?: boolean;
  availableQuestions?: number;
  requestedCount?: number;
  generatedCount?: number;
  isComplete?: boolean;
  incompleteReason?: string;
  message?: string;
  questions: ReviewerQuestion[];
  isHighTrafficFallback?: boolean;
  notice?: string;
}

export interface ServerGradedAnswer {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  normalizedUserAnswer: string;
  expectedAnswer: string;
  acceptedAnswers: string[];
  reason: string;
}

export interface ServerQuizGradeResult {
  success: boolean;
  totalQuestions: number;
  score: number;
  percentage: number;
  gradedAnswers: ServerGradedAnswer[];
}

export async function generateSelfReviewer(params: ReviewerGenerateParams): Promise<ReviewerGenerateResult> {
  const response = await fetch(apiUrl('/api/reviewer-generate'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate self-reviewer questions');
  }

  return response.json();
}

export async function gradeQuizSubmission(
  questions: ReviewerQuestion[],
  answers: { questionId: string; userAnswer: string }[]
): Promise<ServerQuizGradeResult> {
  const response = await fetch(apiUrl('/api/quiz/grade'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify({
      questions: questions.map((q) => ({
        id: q.id,
        type: q.type,
        correctAnswer: q.correctAnswer,
        acceptedAnswers: q.acceptedAnswers,
      })),
      answers,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to validate quiz score on server.');
  }

  return response.json();
}

export async function generateFlashcards(params: {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  chapterId?: string;
  lessonId?: string;
  documentId?: string;
  filename?: string;
}): Promise<FlashcardItem[]> {
  const response = await fetch(apiUrl('/api/generate-flashcards'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate flashcards');
  }

  const data = await response.json();
  return data.flashcards || [];
}

export async function generateConceptContrasts(params: {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  lessonId?: string;
  documentId?: string;
  filename?: string;
}): Promise<ConceptContrastItem[]> {
  const response = await fetch(apiUrl('/api/generate-contrasts'), {
    method: 'POST',
    headers: await buildApiHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate concept contrasts');
  }

  const data = await response.json();
  return data.contrasts || [];
}

