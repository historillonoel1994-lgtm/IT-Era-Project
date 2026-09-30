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
  AudioSessionProgress,
  ReviewerAttempt,
  MemorizationLevelProgress,
} from '../types';
import { DEFAULT_LESSONS } from '../data/defaultLessons';
import { SAMPLE_EXAM_TAKES } from '../data/precomputedData';
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
  AUDIO_SESSIONS: 'studybuddy_audio_sessions',
  REVIEWER_ATTEMPTS: 'studybuddy_reviewer_attempts',
  FLASHCARD_PROGRESS: 'studybuddy_flashcard_progress',
  MEMORIZATION_PROGRESS: 'studybuddy_memorization_progress',
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
  // Ensure all DEFAULT_LESSONS exist in the list so new samples are always accessible
  let merged = [...lessons];
  let changed = false;
  for (const def of DEFAULT_LESSONS) {
    if (!merged.some((l) => l.id === def.id)) {
      merged.push(def);
      changed = true;
    }
  }
  if (changed) {
    safeSet(KEYS.LESSONS, merged);
  }
  return merged;
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
  const stored = safeGet<QuizResult[]>(KEYS.QUIZ_RESULTS, []);
  if (stored.length === 0) {
    safeSet(KEYS.QUIZ_RESULTS, SAMPLE_EXAM_TAKES);
    return SAMPLE_EXAM_TAKES;
  }
  return stored;
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

// ==========================================
// AUDIO SESSIONS PERSISTENCE
// ==========================================

export function getAudioSessionProgress(documentId: string): AudioSessionProgress | null {
  const sessions = safeGet<Record<string, AudioSessionProgress>>(KEYS.AUDIO_SESSIONS, {});
  return sessions[documentId] || null;
}

export function saveAudioSessionProgress(progress: AudioSessionProgress): void {
  const sessions = safeGet<Record<string, AudioSessionProgress>>(KEYS.AUDIO_SESSIONS, {});
  sessions[progress.documentId] = {
    ...progress,
    lastAccessedAt: new Date().toISOString(),
  };
  safeSet(KEYS.AUDIO_SESSIONS, sessions);
}

// ==========================================
// SELF-REVIEWER ATTEMPTS PERSISTENCE
// ==========================================

export function getReviewerAttempts(): ReviewerAttempt[] {
  return safeGet<ReviewerAttempt[]>(KEYS.REVIEWER_ATTEMPTS, []);
}

export function saveReviewerAttempt(attempt: ReviewerAttempt): void {
  const current = getReviewerAttempts();
  const updated = [attempt, ...current.filter((a) => a.id !== attempt.id)];
  safeSet(KEYS.REVIEWER_ATTEMPTS, updated);

  // Also maintain existing quiz score and tasks completed stats
  const progress = getStudentProgress();
  const totalScore = updated.reduce((acc, a) => acc + a.percentage, 0);
  const avg = Math.round(totalScore / updated.length);

  updateProgress({
    quizzesCompleted: progress.quizzesCompleted + 1,
    averageQuizScore: avg,
    tasksCompleted: progress.tasksCompleted + 1,
    verifiedCitationsCount: (progress.verifiedCitationsCount || 0) + (attempt.answers ? attempt.answers.length : 5),
  });
}

// ==========================================
// FLASHCARDS & MEMORIZATION PERSISTENCE
// ==========================================

export function getFlashcardProgress(documentId: string): Record<string, 'mastered' | 'learning' | 'review_again'> {
  const all = safeGet<Record<string, Record<string, 'mastered' | 'learning' | 'review_again'>>>(KEYS.FLASHCARD_PROGRESS, {});
  return all[documentId] || {};
}

export function saveFlashcardProgress(
  documentId: string,
  progress: Record<string, 'mastered' | 'learning' | 'review_again'>
): void {
  const all = safeGet<Record<string, Record<string, 'mastered' | 'learning' | 'review_again'>>>(KEYS.FLASHCARD_PROGRESS, {});
  all[documentId] = progress;
  safeSet(KEYS.FLASHCARD_PROGRESS, all);
}

export function getMemorizationProgress(documentId: string): MemorizationLevelProgress {
  const all = safeGet<Record<string, MemorizationLevelProgress>>(KEYS.MEMORIZATION_PROGRESS, {});
  if (all[documentId]) return all[documentId];

  // Default initial baseline
  return {
    level1_terms: 45,
    level2_definitions: 30,
    level3_own_words: 20,
    level4_application: 10,
    level5_mastery: 5,
    recommendations: [
      'Complete Chapter 1 interactive flashcards to boost Level 1 term recognition.',
      'Practice with Medium difficulty questions to strengthen definition recall (Level 2).',
      'Attempt Scenario & Short Answer questions to test practical application (Level 4 & 5).',
    ],
  };
}

export function saveMemorizationProgress(documentId: string, progress: MemorizationLevelProgress): void {
  const all = safeGet<Record<string, MemorizationLevelProgress>>(KEYS.MEMORIZATION_PROGRESS, {});
  all[documentId] = progress;
  safeSet(KEYS.MEMORIZATION_PROGRESS, all);
}


