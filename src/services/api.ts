import { LessonDocument, LessonSummary, QuizQuestion, StudentProgress } from '../types';

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

export async function askStudyBuddy(params: AskTutorParams): Promise<{
  answer: string;
  sourcePage?: number;
  isSafeguardTriggered?: boolean;
}> {
  const response = await fetch('/api/ask-tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to reach Study Buddy tutor (${response.status})`);
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

export async function parsePdfFile(base64: string, filename: string): Promise<{
  totalPages: number;
  pages: { pageNumber: number; text: string }[];
}> {
  const response = await fetch('/api/parse-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfBase64: base64, filename }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to extract PDF contents (${response.status})`);
  }

  return response.json();
}
