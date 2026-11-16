import {
  UserProfile,
  LessonDocument,
  LessonPage,
  DocumentChunk,
  DocumentProcessingStatus,
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
  supabase,
  STORAGE_BUCKET,
} from '../lib/supabase';
import {
  storeDocumentContent,
  fetchDocumentContent,
  parseDocumentFile,
} from './api';

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
  DOCUMENTS_CONTENT: 'studybuddy_documents_content',
  LAST_USER_ID: 'studybuddy_last_auth_user_id',
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
    // Handle QuotaExceededError gracefully by evicting oldest cached document bodies
    try {
      const cachedDocs = safeGet<Record<string, StoredDocumentContentRecord>>(KEYS.DOCUMENTS_CONTENT, {});
      const activeId = safeGet<string>(KEYS.ACTIVE_LESSON_ID, '');
      const entries = Object.entries(cachedDocs).sort((a, b) => {
        const ta = new Date(a[1]?.updatedAt || 0).getTime();
        const tb = new Date(b[1]?.updatedAt || 0).getTime();
        return ta - tb;
      });
      for (const [docKey] of entries) {
        if (docKey === activeId) continue;
        delete cachedDocs[docKey];
        try {
          localStorage.setItem(KEYS.DOCUMENTS_CONTENT, JSON.stringify(cachedDocs));
          localStorage.setItem(key, JSON.stringify(value));
          return;
        } catch {
          // Continue evicting
        }
      }
    } catch {
      // Ignore cleanup failure
    }
    console.error(`Error saving ${key} to storage:`, e);
  }
}

// Clear user-scoped data when switching to a different account or signing out
export function resetUserScopedLocalData(nextUserId?: string): void {
  try {
    const prevUserId = localStorage.getItem(KEYS.LAST_USER_ID);
    if (nextUserId && prevUserId === nextUserId) {
      return;
    }

    localStorage.removeItem(KEYS.LESSONS);
    localStorage.removeItem(KEYS.ACTIVE_LESSON_ID);
    localStorage.removeItem(KEYS.SUMMARIES);
    localStorage.removeItem(KEYS.QUIZ_RESULTS);
    localStorage.removeItem(KEYS.PROGRESS);
    localStorage.removeItem(KEYS.AUDIO_SESSIONS);
    localStorage.removeItem(KEYS.REVIEWER_ATTEMPTS);
    localStorage.removeItem(KEYS.FLASHCARD_PROGRESS);
    localStorage.removeItem(KEYS.MEMORIZATION_PROGRESS);
    localStorage.removeItem(KEYS.DOCUMENTS_CONTENT);
    localStorage.removeItem('studybuddy_current_material_id');

    if (nextUserId) {
      localStorage.setItem(KEYS.LAST_USER_ID, nextUserId);
    } else {
      localStorage.removeItem(KEYS.LAST_USER_ID);
      localStorage.removeItem(KEYS.USER);
    }
  } catch (e) {
    console.warn('resetUserScopedLocalData warning:', e);
  }
}

// User Profile & Authentication
export function getUserProfile(): UserProfile {
  return safeGet<UserProfile>(KEYS.USER, DEFAULT_USER);
}

export function saveUserProfile(user: UserProfile): void {
  safeSet(KEYS.USER, user);
  try {
    if (user?.id) {
      localStorage.setItem(KEYS.LAST_USER_ID, user.id);
    }
  } catch {}
}

export function isLoggedIn(): boolean {
  return safeGet<boolean>(KEYS.AUTH_LOGGED_IN, false);
}

export function setLoggedIn(status: boolean): void {
  safeSet(KEYS.AUTH_LOGGED_IN, status);
}

// ==========================================
// DOCUMENT CONTENT PERSISTENCE & RECONSTRUCTION
// ==========================================

export interface StoredDocumentContentRecord {
  id: string;
  title?: string;
  fileName?: string;
  filePath?: string;
  fileType?: string;
  totalPages?: number;
  pages: LessonPage[];
  chunks?: DocumentChunk[];
  processingStatus?: DocumentProcessingStatus;
  statusMessage?: string;
  updatedAt: string;
}

export function isPlaceholderContent(pages?: LessonPage[]): boolean {
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

export function saveDocumentFullContent(
  id: string,
  content: {
    pages: LessonPage[];
    chunks?: DocumentChunk[];
    totalPages?: number;
    title?: string;
    fileName?: string;
    filePath?: string;
    fileType?: string;
  },
  syncToServer: boolean = true
): Promise<boolean> {
  if (!id || isPlaceholderContent(content.pages)) return Promise.resolve(false);

  // Store each full document ONCE under its canonical ID (and strip any legacy file:/path: duplicate entries)
  const rawDocs = safeGet<Record<string, StoredDocumentContentRecord>>(KEYS.DOCUMENTS_CONTENT, {});
  const cleanDocs: Record<string, StoredDocumentContentRecord> = {};
  for (const [k, v] of Object.entries(rawDocs)) {
    if (!k.startsWith('file:') && !k.startsWith('path:')) {
      cleanDocs[k] = v;
    }
  }

  cleanDocs[id] = {
    id,
    title: content.title,
    fileName: content.fileName,
    filePath: content.filePath,
    fileType: content.fileType,
    totalPages: content.totalPages || content.pages.length,
    pages: content.pages,
    chunks: content.chunks,
    processingStatus: 'ready',
    statusMessage: 'Ready',
    updatedAt: new Date().toISOString(),
  };

  safeSet(KEYS.DOCUMENTS_CONTENT, cleanDocs);

  if (!syncToServer) return Promise.resolve(true);

  return storeDocumentContent({
    id,
    title: content.title || content.fileName || 'Learning Material',
    filename: content.fileName || id,
    filePath: content.filePath,
    fileType: content.fileType,
    totalPages: content.totalPages || content.pages.length,
    pages: content.pages,
    chunks: content.chunks,
    processingStatus: 'ready',
  })
    .then(() => true)
    .catch((err) => {
      console.warn('Server document store notice:', err.message);
      return false;
    });
}

export function getDocumentFullContent(idOrKey: string): StoredDocumentContentRecord | null {
  if (!idOrKey) return null;
  const allDocs = safeGet<Record<string, StoredDocumentContentRecord>>(KEYS.DOCUMENTS_CONTENT, {});
  if (allDocs[idOrKey]) return allDocs[idOrKey];
  const keyLow = idOrKey.toLowerCase();
  if (allDocs[`file:${keyLow}`]) return allDocs[`file:${keyLow}`];
  if (allDocs[`path:${idOrKey}`]) return allDocs[`path:${idOrKey}`];

  return (
    Object.values(allDocs).find(
      (d) =>
        d.id === idOrKey ||
        (d.fileName && d.fileName.toLowerCase() === keyLow) ||
        (d.filePath && d.filePath === idOrKey)
    ) || null
  );
}

// Lessons Management
export function getStoredLessons(): LessonDocument[] {
  const lessons = safeGet<LessonDocument[]>(KEYS.LESSONS, []);
  let list = lessons;
  if (list.length === 0) {
    safeSet(KEYS.LESSONS, DEFAULT_LESSONS);
    list = DEFAULT_LESSONS;
  }

  // Ensure all DEFAULT_LESSONS exist in the list
  let merged = [...list];
  let changed = false;
  for (const def of DEFAULT_LESSONS) {
    if (!merged.some((l) => l.id === def.id)) {
      merged.push(def);
      changed = true;
    }
  }

  // Reconstruct full pages from local document content cache when missing (pure read, zero HTTP side-effects)
  merged = merged.map((lesson) => {
    if (lesson.isSample) {
      return {
        ...lesson,
        processingStatus: 'ready',
      };
    }

    if (!isPlaceholderContent(lesson.pages)) {
      return {
        ...lesson,
        processingStatus: lesson.processingStatus || 'ready',
      };
    }

    const cached =
      getDocumentFullContent(lesson.id) ||
      (lesson.filePath ? getDocumentFullContent(lesson.filePath) : null) ||
      (lesson.fileName ? getDocumentFullContent(lesson.fileName) : null);

    if (cached && cached.pages && !isPlaceholderContent(cached.pages)) {
      changed = true;
      return {
        ...lesson,
        pages: cached.pages,
        chunks: cached.chunks || lesson.chunks,
        totalPages: cached.totalPages || lesson.totalPages,
        processingStatus: 'ready',
        statusMessage: 'Ready',
      };
    }

    return {
      ...lesson,
      processingStatus: lesson.processingStatus || 'reprocessing_required',
      statusMessage: 'This learning material needs to be processed again to access its complete content.',
    };
  });

  if (changed) {
    safeSet(KEYS.LESSONS, merged);
  }
  return merged;
}

export function saveStoredLessons(lessons: LessonDocument[], syncToServer: boolean = false): void {
  for (const l of lessons) {
    if (!l.isSample && !isPlaceholderContent(l.pages)) {
      void saveDocumentFullContent(l.id, l, syncToServer);
    }
  }
  safeSet(KEYS.LESSONS, lessons);
}

export function addLesson(lesson: LessonDocument): Promise<boolean> {
  const current = getStoredLessons();
  const readyLesson: LessonDocument = {
    ...lesson,
    processingStatus: isPlaceholderContent(lesson.pages) ? 'reprocessing_required' : 'ready',
  };
  let persistPromise: Promise<boolean> = Promise.resolve(true);
  if (!lesson.isSample && !isPlaceholderContent(lesson.pages)) {
    persistPromise = saveDocumentFullContent(lesson.id, readyLesson, true);
  }
  const updated = [readyLesson, ...current.filter((l) => l.id !== lesson.id)];
  safeSet(KEYS.LESSONS, updated);
  setActiveLessonId(lesson.id);

  // Update progress
  updateProgress({ lessonsReviewed: getStudentProgress().lessonsReviewed + 1 });
  return persistPromise;
}

/**
 * Reconstructs complete extracted document content from backend/database/storage
 * Ensures full document access when selecting saved documents.
 * Supports passing either a lessonId or a partial lesson object.
 */
export async function loadAndReconstructLesson(
  lessonIdOrMat: string | Partial<LessonDocument>,
  options?: { forceReprocess?: boolean }
): Promise<LessonDocument> {
  const lessons = getStoredLessons();
  const searchKey = typeof lessonIdOrMat === 'string' ? lessonIdOrMat : (lessonIdOrMat.id || lessonIdOrMat.fileName || '');
  const baseObj = typeof lessonIdOrMat === 'object' ? lessonIdOrMat : null;

  let found = lessons.find(
    (l) => l.id === searchKey || (l.fileName && l.fileName === searchKey) || (l.title && l.title === searchKey)
  );

  if (!found && baseObj) {
    found = {
      id: baseObj.id || `doc-${Date.now()}`,
      title: baseObj.title || baseObj.fileName || 'Learning Material',
      subject: baseObj.subject || 'Course Material',
      totalPages: baseObj.totalPages || 1,
      uploadedAt: baseObj.uploadedAt || new Date().toISOString(),
      pages: baseObj.pages || [{ pageNumber: 1, text: '' }],
      fileName: baseObj.fileName,
      filePath: baseObj.filePath,
      fileType: baseObj.fileType || 'pdf',
      isSample: false,
      processingStatus: 'processing',
    };
  }

  // 1. If already complete and not forcing reprocess, return immediately
  if (found && !options?.forceReprocess && !isPlaceholderContent(found.pages)) {
    // Ensure pages are sorted in natural numerical order
    const sortedPages = [...found.pages].sort((a, b) => {
      const numA = typeof a.pageNumber === 'number' ? a.pageNumber : parseInt(String(a.pageNumber), 10) || 0;
      const numB = typeof b.pageNumber === 'number' ? b.pageNumber : parseInt(String(b.pageNumber), 10) || 0;
      return numA - numB;
    });
    return {
      ...found,
      pages: sortedPages,
      processingStatus: 'ready',
      statusMessage: 'Ready',
    };
  }

  const lookupIds = [
    searchKey,
    found?.id,
    found?.fileName,
    found?.filePath,
    found?.title,
  ].filter(Boolean) as string[];

  // 2. Check local full document content cache
  if (!options?.forceReprocess) {
    for (const key of lookupIds) {
      const localCached = getDocumentFullContent(key);
      if (localCached && localCached.pages && !isPlaceholderContent(localCached.pages)) {
        const sortedPages = [...localCached.pages].sort((a, b) => {
          const numA = typeof a.pageNumber === 'number' ? a.pageNumber : parseInt(String(a.pageNumber), 10) || 0;
          const numB = typeof b.pageNumber === 'number' ? b.pageNumber : parseInt(String(b.pageNumber), 10) || 0;
          return numA - numB;
        });

        const updated: LessonDocument = {
          id: found?.id || localCached.id,
          title: found?.title || localCached.title || 'Learning Material',
          subject: found?.subject || 'Course Material',
          totalPages: localCached.totalPages || sortedPages.length,
          uploadedAt: found?.uploadedAt || new Date().toISOString(),
          fileName: found?.fileName || localCached.fileName,
          filePath: found?.filePath || localCached.filePath,
          fileType: found?.fileType || localCached.fileType || 'pdf',
          pages: sortedPages,
          chunks: localCached.chunks || found?.chunks,
          processingStatus: 'ready',
          statusMessage: 'Ready',
          isSample: found?.isSample || false,
        };

        const existingIdx = lessons.findIndex((l) => l.id === updated.id);
        const newLessons = existingIdx >= 0
          ? lessons.map((l) => (l.id === updated.id ? updated : l))
          : [updated, ...lessons];
        saveStoredLessons(newLessons);
        return updated;
      }
    }
  }

  // 3. Try to fetch complete content from server document store
  for (const key of lookupIds) {
    try {
      const serverRes = await fetchDocumentContent(key);
      if (serverRes.success && serverRes.document && !isPlaceholderContent(serverRes.document.pages)) {
        const doc = serverRes.document;
        const sortedPages = [...doc.pages].sort((a: any, b: any) => {
          const numA = typeof a.pageNumber === 'number' ? a.pageNumber : parseInt(String(a.pageNumber), 10) || 0;
          const numB = typeof b.pageNumber === 'number' ? b.pageNumber : parseInt(String(b.pageNumber), 10) || 0;
          return numA - numB;
        });

        const updated: LessonDocument = {
          id: found?.id || doc.id,
          title: found?.title || doc.title || 'Learning Material',
          subject: found?.subject || 'Course Material',
          totalPages: doc.totalPages || sortedPages.length,
          uploadedAt: found?.uploadedAt || new Date().toISOString(),
          fileName: found?.fileName || doc.filename,
          filePath: found?.filePath || doc.filePath,
          fileType: found?.fileType || doc.fileType || 'pdf',
          pages: sortedPages,
          chunks: doc.chunks || found?.chunks,
          processingStatus: 'ready',
          statusMessage: 'Ready',
          isSample: found?.isSample || false,
        };

        saveDocumentFullContent(updated.id, updated);
        const existingIdx = lessons.findIndex((l) => l.id === updated.id);
        const newLessons = existingIdx >= 0
          ? lessons.map((l) => (l.id === updated.id ? updated : l))
          : [updated, ...lessons];
        saveStoredLessons(newLessons);
        return updated;
      }
    } catch {
      // Continue to next recovery candidate
    }
  }

  // 4. If document has a file in Supabase Storage, download and reprocess
  const storagePath = found?.filePath || (found?.fileName ? `materials/${found.fileName}` : null);
  if (storagePath && checkIsConfigured()) {
    try {
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(storagePath);

      if (!downloadError && fileBlob) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(fileBlob);
        });

        const parsed = await parseDocumentFile(
          base64,
          found?.fileName || found?.title || 'document',
          found?.fileType,
          {
            documentId: found?.id,
            title: found?.title,
            filePath: storagePath,
          }
        );

        if (parsed && parsed.pages && parsed.pages.length > 0 && !isPlaceholderContent(parsed.pages)) {
          const sortedPages = [...parsed.pages].sort((a, b) => {
            const numA = typeof a.pageNumber === 'number' ? a.pageNumber : parseInt(String(a.pageNumber), 10) || 0;
            const numB = typeof b.pageNumber === 'number' ? b.pageNumber : parseInt(String(b.pageNumber), 10) || 0;
            return numA - numB;
          });

          const updated: LessonDocument = {
            id: found?.id || `doc-${Date.now()}`,
            title: found?.title || 'Learning Material',
            subject: found?.subject || 'Course Material',
            totalPages: parsed.totalPages || sortedPages.length,
            uploadedAt: found?.uploadedAt || new Date().toISOString(),
            fileName: found?.fileName,
            filePath: found?.filePath || storagePath,
            fileType: found?.fileType || parsed.fileType || 'pdf',
            pages: sortedPages,
            chunks: parsed.chunks || [],
            processingStatus: 'ready',
            statusMessage: 'Ready',
            isSample: false,
          };

          await saveDocumentFullContent(updated.id, updated, true);
          const existingIdx = lessons.findIndex((l) => l.id === updated.id);
          const newLessons = existingIdx >= 0
            ? lessons.map((l) => (l.id === updated.id ? updated : l))
            : [updated, ...lessons];
          saveStoredLessons(newLessons);
          return updated;
        }
      }
    } catch (err: any) {
      console.warn('Reprocess from Supabase storage failed:', err);
    }
  }

  // 5. Fallback: if cannot reprocess automatically, set state to reprocessing_required
  const targetId = found?.id || searchKey || `doc-${Date.now()}`;
  const updatedFail: LessonDocument = {
    id: targetId,
    title: found?.title || 'Learning Material',
    subject: found?.subject || 'Course Material',
    totalPages: found?.totalPages || 1,
    uploadedAt: found?.uploadedAt || new Date().toISOString(),
    fileName: found?.fileName,
    filePath: found?.filePath,
    fileType: found?.fileType || 'pdf',
    pages: found?.pages || [
      {
        pageNumber: 1,
        text: `[Document: ${found?.title || 'Learning Material'}]\nStored path: ${found?.filePath || 'saved in vault'}.`,
      },
    ],
    processingStatus: 'reprocessing_required',
    statusMessage: 'This learning material needs to be processed again to access its complete content.',
    isSample: false,
  };

  const existingIdx = lessons.findIndex((l) => l.id === updatedFail.id);
  const newLessons = existingIdx >= 0
    ? lessons.map((l) => (l.id === updatedFail.id ? updatedFail : l))
    : [updatedFail, ...lessons];
  saveStoredLessons(newLessons);
  return updatedFail;
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

      // Preserve complete extracted content for every material (checking local cache + server store)
      const resolvedRemote = await Promise.all(
        remoteMaterialsRes.data.map(async (remoteMat) => {
          // 1. Check existing in local lessons
          const existingMatch = existing.find(
            (l) =>
              l.id === remoteMat.id ||
              (l.filePath && remoteMat.filePath && l.filePath === remoteMat.filePath) ||
              (l.fileName && remoteMat.fileName && l.fileName === remoteMat.fileName)
          );
          if (existingMatch && !isPlaceholderContent(existingMatch.pages)) {
            return {
              ...remoteMat,
              pages: existingMatch.pages,
              chunks: existingMatch.chunks || remoteMat.chunks,
              totalPages: existingMatch.totalPages || remoteMat.totalPages,
              processingStatus: 'ready' as DocumentProcessingStatus,
              statusMessage: 'Ready',
            };
          }

          // 2. Check dedicated local document content cache
          const cached =
            getDocumentFullContent(remoteMat.id) ||
            (remoteMat.filePath ? getDocumentFullContent(remoteMat.filePath) : null) ||
            (remoteMat.fileName ? getDocumentFullContent(remoteMat.fileName) : null);
          if (cached && cached.pages && !isPlaceholderContent(cached.pages)) {
            return {
              ...remoteMat,
              pages: cached.pages,
              chunks: cached.chunks || remoteMat.chunks,
              totalPages: cached.totalPages || remoteMat.totalPages,
              processingStatus: 'ready' as DocumentProcessingStatus,
              statusMessage: 'Ready',
            };
          }

          // 3. Check persistent server document store
          const candidateKeys = [remoteMat.id, remoteMat.filePath, remoteMat.fileName].filter(Boolean) as string[];
          for (const key of candidateKeys) {
            try {
              const serverRes = await fetchDocumentContent(key);
              if (serverRes.success && serverRes.document && !isPlaceholderContent(serverRes.document.pages)) {
                const doc = serverRes.document;
                const hydrated: LessonDocument = {
                  ...remoteMat,
                  pages: doc.pages,
                  chunks: doc.chunks || remoteMat.chunks,
                  totalPages: doc.totalPages || doc.pages.length || remoteMat.totalPages,
                  processingStatus: 'ready' as DocumentProcessingStatus,
                  statusMessage: 'Ready',
                };
                void saveDocumentFullContent(hydrated.id, hydrated, false);
                return hydrated;
              }
            } catch {
              // Continue to next lookup key
            }
          }

          // 4. Needs automatic or manual reprocessing
          return {
            ...remoteMat,
            processingStatus: 'reprocessing_required' as DocumentProcessingStatus,
            statusMessage: 'This learning material needs to be processed again to access its complete content.',
          };
        })
      );

      const merged = [...resolvedRemote, ...nonUserSamples];
      saveStoredLessons(merged);
      setActiveLessonId(resolvedRemote[0]?.id || merged[0]?.id);
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


