import { LessonDocument, LessonSummary, QuizQuestion, StudentProgress, DocumentChunk } from '../types';

export interface SummarizeParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  subject?: string;
}

export interface QuizParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  questionCount: 5 | 10 | 15;
  quizType: 'multiple_choice' | 'true_false' | 'mixed';
}

export interface AskTutorParams {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  question: string;
  chatHistory?: { sender: 'user' | 'tutor'; text: string }[];
  tutorMode?: 'materials' | 'feynman' | 'general';
}

export interface StudyPlanParams {
  workSchedule: any[];
  classSchedule: any[];
  schoolTasks: any[];
}

export async function summarizeLesson(params: SummarizeParams): Promise<LessonSummary> {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const response = await fetch('/api/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const response = await fetch('/api/ask-tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const response = await fetch('/api/ask-general', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  const response = await fetch('/api/ask-general', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const response = await fetch('/api/suggest-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  fileType?: string
): Promise<ParsedDocumentResult> {
  const response = await fetch('/api/parse-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64: base64, filename, fileType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to extract contents from ${filename} (${response.status})`);
  }

  return response.json();
}

export async function parsePdfFile(base64: string, filename: string): Promise<ParsedDocumentResult> {
  return parseDocumentFile(base64, filename, 'pdf');
}

// ==========================================
// SELF-REVIEWER & EXPLANATION API CLIENTS
// ==========================================

import {
  DocumentChapter,
  ReviewerQuestion,
  ReviewerDifficulty,
  FlashcardItem,
  ConceptContrastItem,
} from '../types';

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
  const response = await fetch('/api/explain-term', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
}): Promise<DocumentChapter[]> {
  const response = await fetch('/api/analyze-chapters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
}

export interface ReviewerGenerateResult {
  success: boolean;
  insufficient?: boolean;
  availableQuestions?: number;
  message?: string;
  questions: ReviewerQuestion[];
  isHighTrafficFallback?: boolean;
  notice?: string;
}

export async function generateSelfReviewer(params: ReviewerGenerateParams): Promise<ReviewerGenerateResult> {
  const response = await fetch('/api/reviewer-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate self-reviewer questions');
  }

  return response.json();
}

export async function generateFlashcards(params: {
  pages: { pageNumber: number | string; text: string }[];
  lessonTitle: string;
  chapterId?: string;
}): Promise<FlashcardItem[]> {
  const response = await fetch('/api/generate-flashcards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
}): Promise<ConceptContrastItem[]> {
  const response = await fetch('/api/generate-contrasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate concept contrasts');
  }

  const data = await response.json();
  return data.contrasts || [];
}

