import {
  UserProfile,
  LessonDocument,
  LessonSummary,
  QuizResult,
  WorkScheduleItem,
  ClassScheduleItem,
  SchoolTaskItem,
  TodayPlanItem,
  StudentProgress,
} from '../types';
import { DEFAULT_LESSONS } from '../data/defaultLessons';
import {
  DEFAULT_USER,
  DEFAULT_WORK_SCHEDULE,
  DEFAULT_CLASS_SCHEDULE,
  DEFAULT_SCHOOL_TASKS,
  DEFAULT_TODAY_PLAN,
  DEFAULT_PROGRESS,
} from '../data/mockUserData';
import {
  checkIsConfigured,
  syncStudyProgressToSupabase,
  fetchStudentMaterials,
  fetchStudentQuizAttempts,
  fetchStudyProgressFromSupabase,
} from '../lib/supabase';

const KEYS = {
  USER: 'studybuddy_user_profile',
  LESSONS: 'studybuddy_lessons',
  ACTIVE_LESSON_ID: 'studybuddy_active_lesson_id',
  SUMMARIES: 'studybuddy_summaries',
  QUIZ_RESULTS: 'studybuddy_quiz_results',
  WORK_SCHEDULE: 'studybuddy_work_schedule',
  CLASS_SCHEDULE: 'studybuddy_class_schedule',
  SCHOOL_TASKS: 'studybuddy_school_tasks',
  TODAY_PLAN: 'studybuddy_today_plan',
  PROGRESS: 'studybuddy_progress',
  AUTH_LOGGED_IN: 'studybuddy_logged_in',
};

// Safe JSON parser
function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error reading ${key} from storage:`, e);
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving ${key} to storage:`, e);
  }
}

// User Profile & Authentication
export function getUserProfile(): UserProfile {
  return safeGet<UserProfile>(KEYS.USER, DEFAULT_USER);
}

export function saveUserProfile(user: UserProfile): void {
  safeSet(KEYS.USER, user);
}

export function isLoggedIn(): boolean {
  return safeGet<boolean>(KEYS.AUTH_LOGGED_IN, false);
}

export function setLoggedIn(status: boolean): void {
  safeSet(KEYS.AUTH_LOGGED_IN, status);
}

// Lessons Management
export function getStoredLessons(): LessonDocument[] {
  const lessons = safeGet<LessonDocument[]>(KEYS.LESSONS, []);
  if (lessons.length === 0) {
    safeSet(KEYS.LESSONS, DEFAULT_LESSONS);
    return DEFAULT_LESSONS;
  }
  return lessons;
}

export function saveStoredLessons(lessons: LessonDocument[]): void {
  safeSet(KEYS.LESSONS, lessons);
}

export function addLesson(lesson: LessonDocument): void {
  const current = getStoredLessons();
  const updated = [lesson, ...current.filter((l) => l.id !== lesson.id)];
  saveStoredLessons(updated);
  setActiveLessonId(lesson.id);

  // Update progress
  updateProgress({ lessonsReviewed: getStudentProgress().lessonsReviewed + 1 });
}

export function getActiveLessonId(): string {
  const stored = safeGet<string>(KEYS.ACTIVE_LESSON_ID, '');
  if (stored) return stored;
  const lessons = getStoredLessons();
  return lessons[0]?.id || DEFAULT_LESSONS[0].id;
}

export function setActiveLessonId(id: string): void {
  safeSet(KEYS.ACTIVE_LESSON_ID, id);
}

export function getActiveLesson(): LessonDocument {
  const id = getActiveLessonId();
  const lessons = getStoredLessons();
  return lessons.find((l) => l.id === id) || lessons[0] || DEFAULT_LESSONS[0];
}

// Summaries Cache
export function getStoredSummary(lessonId: string): LessonSummary | null {
  const allSummaries = safeGet<Record<string, LessonSummary>>(KEYS.SUMMARIES, {});
  return allSummaries[lessonId] || null;
}

export function saveStoredSummary(lessonId: string, summary: LessonSummary): void {
  const allSummaries = safeGet<Record<string, LessonSummary>>(KEYS.SUMMARIES, {});
  allSummaries[lessonId] = summary;
  safeSet(KEYS.SUMMARIES, allSummaries);

  // Add topic to studied topics
  const progress = getStudentProgress();
  if (summary.mainTopic && !progress.topicsStudied.includes(summary.mainTopic)) {
    updateProgress({
      topicsStudied: [...progress.topicsStudied, summary.mainTopic],
    });
  }
}

// Quiz Results
export function getQuizResults(): QuizResult[] {
  return safeGet<QuizResult[]>(KEYS.QUIZ_RESULTS, []);
}

export function saveQuizResult(result: QuizResult): void {
  const current = getQuizResults();
  const updated = [result, ...current];
  safeSet(KEYS.QUIZ_RESULTS, updated);

  // Recalculate average quiz score
  const totalScore = updated.reduce((sum, r) => sum + r.percentage, 0);
  const avg = Math.round(totalScore / updated.length);

  updateProgress({
    quizzesCompleted: updated.length,
    averageQuizScore: avg,
  });

  // Note: GenerateQuizView handles inserting directly into Supabase quiz_attempts
  // with exact lessonId, score, total_questions, and verified student feedback.
}

// Work Schedule
export function getWorkSchedule(): WorkScheduleItem[] {
  return safeGet<WorkScheduleItem[]>(KEYS.WORK_SCHEDULE, DEFAULT_WORK_SCHEDULE);
}

export function saveWorkSchedule(schedule: WorkScheduleItem[]): void {
  safeSet(KEYS.WORK_SCHEDULE, schedule);
}

// Class Schedule
export function getClassSchedule(): ClassScheduleItem[] {
  return safeGet<ClassScheduleItem[]>(KEYS.CLASS_SCHEDULE, DEFAULT_CLASS_SCHEDULE);
}

export function saveClassSchedule(schedule: ClassScheduleItem[]): void {
  safeSet(KEYS.CLASS_SCHEDULE, schedule);
}

// School Tasks
export function getSchoolTasks(): SchoolTaskItem[] {
  return safeGet<SchoolTaskItem[]>(KEYS.SCHOOL_TASKS, DEFAULT_SCHOOL_TASKS);
}

export function saveSchoolTasks(tasks: SchoolTaskItem[]): void {
  safeSet(KEYS.SCHOOL_TASKS, tasks);
  const completed = tasks.filter((t) => t.completed).length;
  updateProgress({ tasksCompleted: completed });
}

// Today's Plan
export function getTodayPlan(): TodayPlanItem[] {
  return safeGet<TodayPlanItem[]>(KEYS.TODAY_PLAN, DEFAULT_TODAY_PLAN);
}

export function saveTodayPlan(plan: TodayPlanItem[]): void {
  safeSet(KEYS.TODAY_PLAN, plan);
}

// Progress Metrics
export function getStudentProgress(): StudentProgress {
  return safeGet<StudentProgress>(KEYS.PROGRESS, DEFAULT_PROGRESS);
}

export function updateProgress(partial: Partial<StudentProgress>): StudentProgress {
  const current = getStudentProgress();
  const updated = { ...current, ...partial };
  safeSet(KEYS.PROGRESS, updated);

  // Sync to Supabase study_progress table
  if (checkIsConfigured()) {
    const user = getUserProfile();
    if (user && user.id) {
      syncStudyProgressToSupabase(user.id, updated).catch((err) =>
        console.warn('Background Supabase progress sync error:', err)
      );
    }
  }

  return updated;
}

export function addStudyTimeMinutes(minutes: number): void {
  const current = getStudentProgress();
  updateProgress({
    totalStudyMinutes: current.totalStudyMinutes + minutes,
  });
}

export function recordCitationVerification(): void {
  const current = getStudentProgress();
  updateProgress({
    verifiedCitationsCount: (current.verifiedCitationsCount || 0) + 1,
  });
}

/**
 * Sync logged-in student's remote Supabase data (materials, quizzes, study progress) into local state
 */
export async function syncUserDataFromSupabase(userId: string): Promise<void> {
  if (!checkIsConfigured() || !userId) return;

  try {
    // 1. Fetch materials from learning_materials
    const remoteMaterialsRes = await fetchStudentMaterials(userId);
    if (remoteMaterialsRes.data && remoteMaterialsRes.data.length > 0) {
      const existing = getStoredLessons();
      const nonUserSamples = existing.filter((l) => l.isSample);
      const merged = [...remoteMaterialsRes.data, ...nonUserSamples];
      saveStoredLessons(merged);
      setActiveLessonId(remoteMaterialsRes.data[0].id);
    }

    // 2. Fetch quiz attempts from quiz_attempts
    const remoteQuizzesRes = await fetchStudentQuizAttempts(userId);
    if (remoteQuizzesRes.attempts && remoteQuizzesRes.attempts.length > 0) {
      const mapped: QuizResult[] = remoteQuizzesRes.attempts.map((q) => {
        const pct = q.total_questions > 0 ? Math.round((q.score / q.total_questions) * 100) : 0;
        return {
          id: q.id,
          lessonId: q.learning_material_id || '',
          lessonTitle: q.learning_materials?.title || 'Practice Quiz',
          completedAt: q.created_at || q.completed_at || new Date().toISOString(),
          totalQuestions: q.total_questions,
          score: q.score,
          percentage: pct,
          answers: [],
          questionsToReview: [],
          topicsToReview: [],
        };
      });
      safeSet(KEYS.QUIZ_RESULTS, mapped);
    }

    // 3. Fetch study progress from study_progress
    const remoteProgressRes = await fetchStudyProgressFromSupabase(userId);
    if (remoteProgressRes.progress) {
      safeSet(KEYS.PROGRESS, remoteProgressRes.progress);
    }
  } catch (err) {
    console.warn('syncUserDataFromSupabase error:', err);
  }
}

