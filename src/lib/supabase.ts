import { createClient, SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';
import { UserProfile, LessonDocument, QuizResult, StudentProgress } from '../types';

export const STORAGE_BUCKET = 'study-buddy-materials';

export const DATA_UPDATED_EVENT = 'study-buddy-data-updated';

/**
 * Notifies all views and listeners across the app that Supabase records were added or modified
 */
export function notifyDataChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_UPDATED_EVENT));
  }
}

const STORAGE_KEYS = {
  URL: 'studybuddy_supabase_url',
  KEY: 'studybuddy_supabase_key',
};

// Check if valid URL and non-placeholder key are provided
export function isValidSupabaseConfig(url: string, key: string): boolean {
  if (!url || !key) return false;
  if (url.includes('your-project') || key.includes('your-supabase')) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && key.length > 10;
  } catch {
    return false;
  }
}

// Retrieve active credentials from localStorage or environment variables
export function getActiveSupabaseConfig(): { url: string; key: string; isConfigured: boolean } {
  let url = (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.URL) : '') || '';
  let key = (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.KEY) : '') || '';

  if (!url) {
    url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
  }
  if (!key) {
    key = (
      (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
      (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
      ''
    )?.trim();
  }

  return {
    url,
    key,
    isConfigured: isValidSupabaseConfig(url, key),
  };
}

// Dynamic Client Instance
let clientInstance: SupabaseClient = createInitialClient();

function createInitialClient(): SupabaseClient {
  const cfg = getActiveSupabaseConfig();
  return createClient(
    cfg.isConfigured ? cfg.url : 'https://placeholder-project.supabase.co',
    cfg.isConfigured ? cfg.key : 'placeholder-anon-key',
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );
}

// Save credentials from UI and reinitialize client
export function saveSupabaseCredentials(url: string, key: string): boolean {
  const cleanUrl = url.trim();
  const cleanKey = key.trim();
  if (!isValidSupabaseConfig(cleanUrl, cleanKey)) {
    return false;
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.URL, cleanUrl);
    localStorage.setItem(STORAGE_KEYS.KEY, cleanKey);
  }

  clientInstance = createClient(cleanUrl, cleanKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return true;
}

// Clear credentials from UI
export function clearSupabaseCredentials(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.URL);
    localStorage.removeItem(STORAGE_KEYS.KEY);
  }
  clientInstance = createClient('https://placeholder-project.supabase.co', 'placeholder-anon-key');
}

// Test connection to Supabase
export async function testSupabaseConnection(
  urlInput?: string,
  keyInput?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const config = getActiveSupabaseConfig();
    const url = urlInput ? urlInput.trim() : config.url;
    const key = keyInput ? keyInput.trim() : config.key;

    if (!isValidSupabaseConfig(url, key)) {
      return {
        success: false,
        message: 'Invalid Supabase URL or Key. The URL must start with https:// and Key must be your public anon key.',
      };
    }

    const testClient = createClient(url, key);
    const { error } = await testClient.auth.getSession();

    if (error && !error.message.includes('Auth session missing')) {
      return { success: false, message: `Supabase Error: ${error.message}` };
    }

    return {
      success: true,
      message: 'Connection successful! Connected to Supabase Authentication & Database.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Failed to reach Supabase project. Check URL and Key.',
    };
  }
}

// Proxy that always routes to the currently configured clientInstance
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (clientInstance as any)[prop];
  },
});

export const isConfigured = getActiveSupabaseConfig().isConfigured;

export function checkIsConfigured(): boolean {
  return getActiveSupabaseConfig().isConfigured;
}

// -------------------------------------------------------------
// Authentication helpers
// -------------------------------------------------------------

/**
 * Sign up a new student account with Supabase Authentication and save profile
 */
export async function signUpStudent(params: {
  email: string;
  password: string;
  fullName: string;
  degree?: string;
  jobTitle?: string;
}): Promise<{ user: SupabaseAuthUser | null; error: string | null; needsEmailConfirmation?: boolean }> {
  if (!checkIsConfigured()) {
    return {
      user: null,
      error: 'Supabase is not configured yet. Please enter your Supabase URL and Publishable Key.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: params.email.trim(),
      password: params.password,
      options: {
        data: {
          full_name: params.fullName.trim(),
          degree: params.degree?.trim() || '',
          job_title: params.jobTitle?.trim() || '',
        },
      },
    });

    if (error) {
      return { user: null, error: error.message };
    }

    if (data.user) {
      // Automatically populate profiles & study_progress
      await ensureUserProfileAndProgress(data.user, {
        fullName: params.fullName.trim(),
        degree: params.degree?.trim() || '',
        jobTitle: params.jobTitle?.trim() || '',
      });
    }

    const needsEmailConfirmation = Boolean(data.user && !data.session);

    return {
      user: data.user,
      error: null,
      needsEmailConfirmation,
    };
  } catch (err: any) {
    return { user: null, error: err.message || 'An unexpected error occurred during sign up.' };
  }
}

/**
 * Sign in existing student with email and password
 */
export async function signInStudent(params: {
  email: string;
  password: string;
}): Promise<{ user: SupabaseAuthUser | null; profile: UserProfile | null; error: string | null }> {
  if (!checkIsConfigured()) {
    return {
      user: null,
      profile: null,
      error: 'Supabase is not configured yet. Please enter your Supabase URL and Publishable Key.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email.trim(),
      password: params.password,
    });

    if (error) {
      return { user: null, profile: null, error: error.message };
    }

    if (!data.user) {
      return { user: null, profile: null, error: 'User could not be loaded.' };
    }

    // Automatically ensure profiles & study_progress are populated
    const profile = await ensureUserProfileAndProgress(data.user);

    return { user: data.user, profile, error: null };
  } catch (err: any) {
    return { user: null, profile: null, error: err.message || 'An unexpected error occurred during login.' };
  }
}

/**
 * Automatically ensures profiles and study_progress tables are populated for authenticated user
 */
export async function ensureUserProfileAndProgress(
  user: SupabaseAuthUser,
  overrides?: { fullName?: string; degree?: string; jobTitle?: string }
): Promise<UserProfile> {
  const fullName =
    overrides?.fullName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Working Student';
  const degree =
    overrides?.degree ||
    user.user_metadata?.degree ||
    'College Degree';
  const jobTitle =
    overrides?.jobTitle ||
    user.user_metadata?.job_title ||
    'Working Student';
  const avatarSeed = fullName.toLowerCase().replace(/\s+/g, '-');

  let profile: UserProfile = {
    id: user.id,
    fullName,
    email: user.email || '',
    degree,
    jobTitle,
    avatarSeed,
  };

  // 1. Populate profiles if missing
  try {
    const { data: existingProfile, error: profileFetchErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileFetchErr) {
      console.warn('Profiles fetch warning:', profileFetchErr.message);
    }

    if (!existingProfile) {
      let { data: insertedProfile, error: insertProfileErr } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          full_name: fullName,
          email: user.email || '',
          degree,
          job_title: jobTitle,
          avatar_seed: avatarSeed,
          updated_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle();

      // If failed due to extra columns (e.g. avatar_seed, degree, job_title not in user's schema), fallback to basic columns
      if (insertProfileErr) {
        console.error('Profile DB error (detailed):', insertProfileErr);
        const retryBasic = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            full_name: fullName,
            email: user.email || '',
          })
          .select()
          .maybeSingle();

        if (retryBasic.error) {
          console.error('Profile DB error (fallback):', retryBasic.error);
        } else {
          insertedProfile = retryBasic.data;
        }
      }

      if (insertedProfile) {
        profile = {
          id: insertedProfile.id || user.id,
          fullName: insertedProfile.full_name || fullName,
          email: insertedProfile.email || user.email || '',
          degree: insertedProfile.degree || degree,
          jobTitle: insertedProfile.job_title || jobTitle,
          avatarSeed: insertedProfile.avatar_seed || avatarSeed,
        };
      }
    } else {
      profile = {
        id: existingProfile.id,
        fullName: existingProfile.full_name || fullName,
        email: existingProfile.email || user.email || '',
        degree: existingProfile.degree || degree,
        jobTitle: existingProfile.job_title || jobTitle,
        avatarSeed: existingProfile.avatar_seed || avatarSeed,
      };
    }
  } catch (profileErr) {
    console.error('Profile DB error:', profileErr);
  }

  // 2. Populate study_progress with required initial zero fields if missing:
  // user_id = user.id, study_minutes = 0, tasks_completed = 0, verified_pages = 0
  try {
    const { data: existingProgressRows, error: progFetchErr } = await supabase
      .from('study_progress')
      .select('*')
      .eq('user_id', user.id);

    if (progFetchErr) {
      console.error('Progress DB error:', progFetchErr);
    }

    if (!progFetchErr && (!existingProgressRows || existingProgressRows.length === 0)) {
      const { error: progInsertErr } = await supabase.from('study_progress').insert({
        user_id: user.id,
        study_minutes: 0,
        tasks_completed: 0,
        verified_pages: 0,
      });

      if (progInsertErr) {
        console.error('Progress DB error:', progInsertErr);
      }
    } else if (existingProgressRows && existingProgressRows.length > 1) {
      // Multiple duplicate rows exist for this user in study_progress. Consolidate and clean up duplicates.
      const bestRow = existingProgressRows.reduce((prev: any, curr: any) => {
        const prevScore = (prev.study_minutes || 0) + (prev.tasks_completed || 0) + (prev.verified_pages || 0);
        const currScore = (curr.study_minutes || 0) + (curr.tasks_completed || 0) + (curr.verified_pages || 0);
        return currScore > prevScore ? curr : prev;
      }, existingProgressRows[0]);

      if (bestRow?.id) {
        const dupIds = existingProgressRows
          .filter((r: any) => r.id && r.id !== bestRow.id)
          .map((r: any) => r.id);
        if (dupIds.length > 0) {
          await supabase.from('study_progress').delete().in('id', dupIds);
        }
      }
    }
  } catch (progErr) {
    console.error('Progress DB error:', progErr);
  }

  return profile;
}

/**
 * Log out student
 */
export async function signOutStudent(): Promise<{ error: string | null }> {
  if (!checkIsConfigured()) return { error: null };
  try {
    const { error } = await supabase.auth.signOut();
    setCurrentLearningMaterialId(null);
    return { error: error ? error.message : null };
  } catch (err: any) {
    return { error: err.message || 'Error signing out.' };
  }
}

/**
 * Get currently authenticated Supabase user
 */
export async function getSupabaseUser(): Promise<SupabaseAuthUser | null> {
  if (!checkIsConfigured()) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user || null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// Learning Material Tracking & UUID Validation
// -------------------------------------------------------------

const MATERIAL_ID_KEY = 'studybuddy_current_material_id';
let inMemoryMaterialId: string | null = null;

export function setCurrentLearningMaterialId(id: string | null): void {
  inMemoryMaterialId = id;
  if (typeof window !== 'undefined') {
    if (id) {
      localStorage.setItem(MATERIAL_ID_KEY, id);
    } else {
      localStorage.removeItem(MATERIAL_ID_KEY);
    }
  }
}

export function getCurrentLearningMaterialId(): string | null {
  if (inMemoryMaterialId) return inMemoryMaterialId;
  if (typeof window !== 'undefined') {
    inMemoryMaterialId = localStorage.getItem(MATERIAL_ID_KEY);
  }
  return inMemoryMaterialId;
}

export function toValidUuidOrNull(str?: string | null): string | null {
  if (!str) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str.trim()) ? str.trim() : null;
}

// -------------------------------------------------------------
// 2. LEARNING MATERIAL DATABASE SAVE & STORAGE UPLOAD
// -------------------------------------------------------------

/**
 * Uploads file to Supabase Storage 'study-buddy-materials' and immediately
 * inserts record into 'learning_materials' table using exact existing columns:
 * user_id, title, file_name, file_path, total_pages
 */
export async function uploadAndSaveLearningMaterial(
  file: File,
  lessonTitle?: string,
  totalPages?: number
): Promise<{ success: boolean; materialId?: string; filePath?: string; material?: any; error?: string }> {
  if (!checkIsConfigured()) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    console.error('Material DB error: No authenticated user', userError);
    return { success: false, error: 'Please sign in to save your activity.' };
  }

  try {
    await ensureUserProfileAndProgress(user);

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/${Date.now()}_${cleanFileName}`;

    // Upload to Supabase Storage bucket 'study-buddy-materials'
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload failed:', uploadError);
      return { success: false, error: `Storage upload failed: ${uploadError.message}` };
    }

    // 2. Immediately insert its information into learning_materials
    // Use exact existing columns: user_id, title, file_name, file_path, total_pages
    const { data: material, error: materialError } = await supabase
      .from('learning_materials')
      .insert({
        user_id: user.id,
        title: lessonTitle || file.name,
        file_name: file.name,
        file_path: storagePath,
        total_pages: totalPages || null,
      })
      .select()
      .single();

    if (materialError) {
      console.error('Learning material database save failed:', materialError);
      console.error('Material DB error:', materialError);
      return { success: false, error: materialError.message || 'Learning material database save failed' };
    }

    // Store material.id as the current learning material ID
    if (material?.id) {
      setCurrentLearningMaterialId(material.id);
    }

    notifyDataChanged();

    return {
      success: true,
      materialId: material?.id,
      filePath: storagePath,
      material,
    };
  } catch (err: any) {
    console.error('Learning material database save failed:', err);
    console.error('Material DB error:', err);
    return { success: false, error: err.message || 'Failed to save learning material.' };
  }
}

/**
 * Backward compatibility wrapper
 */
export async function uploadLearningMaterial(
  _userId: string,
  file: File,
  _lessonId: string,
  metadata: {
    title: string;
    subject?: string;
    totalPages: number;
    pages?: { pageNumber: number; text: string }[];
  }
): Promise<{ success: boolean; filePath?: string; fileUrl?: string; materialId?: string; error?: string }> {
  const result = await uploadAndSaveLearningMaterial(file, metadata.title, metadata.totalPages);
  return {
    success: result.success,
    filePath: result.filePath,
    materialId: result.materialId,
    error: result.error,
  };
}

// -------------------------------------------------------------
// 3. SAVED LEARNING MATERIALS
// -------------------------------------------------------------

export interface RawLearningMaterialRow {
  id: string;
  user_id: string;
  title: string;
  file_name?: string;
  file_path?: string;
  total_pages?: number | null;
  created_at?: string;
  uploaded_at?: string;
}

/**
 * Load learning materials from 'learning_materials' using logged-in user's ID
 */
export async function fetchStudentMaterials(
  targetUserId?: string
): Promise<{ data: LessonDocument[]; error: string | null }> {
  if (!checkIsConfigured()) {
    return { data: [], error: 'Supabase is not configured.' };
  }

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  const userId = user?.id || targetUserId;
  if (!userId) {
    return { data: [], error: 'Please sign in to save your activity.' };
  }

  try {
    let { data, error: materialError } = await supabase
      .from('learning_materials')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Fallback if created_at column is not present
    if (materialError && materialError.message?.includes('created_at')) {
      const retry = await supabase
        .from('learning_materials')
        .select('*')
        .eq('user_id', userId);
      data = retry.data;
      materialError = retry.error;
    }

    if (materialError) {
      console.error('Material DB error:', materialError);
      return { data: [], error: materialError.message };
    }

    if (!data) return { data: [], error: null };

    // Deduplicate any exact twin materials from double submissions (same file_name and file_path)
    const seenFiles = new Set<string>();
    const deduplicatedRows: any[] = [];
    const duplicateIdsToRemove: string[] = [];

    for (const row of data) {
      const fileKey = `${row.file_name || ''}::${row.file_path || ''}`;
      if (fileKey !== '::' && seenFiles.has(fileKey)) {
        if (row.id) duplicateIdsToRemove.push(row.id);
      } else {
        if (fileKey !== '::') seenFiles.add(fileKey);
        deduplicatedRows.push(row);
      }
    }

    // Clean up redundant duplicate rows in Supabase background
    if (duplicateIdsToRemove.length > 0) {
      void Promise.resolve(supabase.from('learning_materials').delete().in('id', duplicateIdsToRemove)).catch(() => {});
    }

    const mapped: LessonDocument[] = deduplicatedRows.map((row: any) => {
      const ext = (row.file_name?.split('.').pop() || 'pdf').toLowerCase();
      return {
        id: row.id,
        title: row.title || row.file_name || 'Learning Material',
        subject: row.subject || 'Course Material',
        totalPages: row.total_pages || 1,
        uploadedAt: row.created_at || row.uploaded_at || new Date().toISOString(),
        fileName: row.file_name,
        filePath: row.file_path,
        fileType: ext,
        pages: row.pages || [
          {
            pageNumber: 1,
            text: `[Document: ${row.title || row.file_name}]\nStored path: ${row.file_path || 'saved in cloud vault'}.`,
          },
        ],
        isSample: false,
      };
    });

    return { data: mapped, error: null };
  } catch (err: any) {
    console.error('Material DB error:', err);
    return { data: [], error: err.message || 'Failed to fetch learning materials.' };
  }
}

// -------------------------------------------------------------
// 4 & 5. QUIZ ATTEMPTS (Save & Load)
// -------------------------------------------------------------

export interface RawQuizAttemptRow {
  id: string;
  user_id: string;
  learning_material_id?: string | null;
  score: number;
  total_questions: number;
  created_at?: string;
  completed_at?: string;
  learning_materials?: { title?: string; file_name?: string } | null;
}

/**
 * When a student finishes a quiz, insert a real row into quiz_attempts
 * using exact columns: user_id, learning_material_id, score, total_questions
 */
export async function saveQuizAttemptInSupabase(
  score: number,
  totalQuestions: number,
  learningMaterialId?: string | null
): Promise<{ success: boolean; attempt?: any; error?: string }> {
  if (!checkIsConfigured()) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    console.error('Quiz DB error: User not authenticated', userError);
    return { success: false, error: 'Please sign in to save your activity.' };
  }

  try {
    const validMaterialId = toValidUuidOrNull(learningMaterialId || getCurrentLearningMaterialId());

    const { data: attempt, error: quizError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: user.id,
        learning_material_id: validMaterialId,
        score: score,
        total_questions: totalQuestions,
      })
      .select()
      .single();

    if (quizError) {
      console.error('Quiz save failed:', quizError);
      console.error('Quiz DB error:', quizError);
      return { success: false, error: quizError.message || 'Quiz save failed' };
    }

    notifyDataChanged();

    return { success: true, attempt };
  } catch (err: any) {
    console.error('Quiz save failed:', err);
    console.error('Quiz DB error:', err);
    return { success: false, error: err.message || 'Failed to save quiz attempt.' };
  }
}

/**
 * Compatibility wrapper for recordQuizAttemptInSupabase
 */
export async function recordQuizAttemptInSupabase(
  _userId: string,
  result: QuizResult
): Promise<{ success: boolean; error?: string }> {
  return saveQuizAttemptInSupabase(result.score, result.totalQuestions, result.lessonId);
}

/**
 * Load Completed Quiz Attempts from: quiz_attempts for the current authenticated user
 */
export async function fetchStudentQuizAttempts(
  targetUserId?: string
): Promise<{ attempts: RawQuizAttemptRow[]; error: string | null }> {
  if (!checkIsConfigured()) {
    return { attempts: [], error: 'Supabase is not configured.' };
  }

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  const userId = user?.id || targetUserId;
  if (!userId) {
    return { attempts: [], error: 'Please sign in to save your activity.' };
  }

  try {
    let { data, error: quizError } = await supabase
      .from('quiz_attempts')
      .select('*, learning_materials(title, file_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // If joined select fails (e.g. FK name differences), fallback to simple select
    if (quizError) {
      const fallback = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      data = fallback.data;
      quizError = fallback.error;
    }

    if (quizError && quizError.message?.includes('created_at')) {
      const noOrder = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('user_id', userId);
      data = noOrder.data;
      quizError = noOrder.error;
    }

    if (quizError) {
      console.error('Quiz DB error:', quizError);
      return { attempts: [], error: quizError.message };
    }

    // Deduplicate any exact twin attempts created within 30s with identical score and total_questions
    const rawAttempts = (data as RawQuizAttemptRow[]) || [];
    const deduplicatedAttempts: RawQuizAttemptRow[] = [];
    const duplicateIdsToRemove: string[] = [];

    for (const attempt of rawAttempts) {
      const isDuplicate = deduplicatedAttempts.some((existing) => {
        const sameScore = existing.score === attempt.score && existing.total_questions === attempt.total_questions;
        const sameMat = (existing.learning_material_id || '') === (attempt.learning_material_id || '');
        if (!sameScore || !sameMat) return false;

        if (existing.created_at && attempt.created_at) {
          const diffMs = Math.abs(new Date(existing.created_at).getTime() - new Date(attempt.created_at).getTime());
          return diffMs <= 30000;
        }
        return true;
      });

      if (!isDuplicate) {
        deduplicatedAttempts.push(attempt);
      } else if (attempt.id) {
        duplicateIdsToRemove.push(attempt.id);
      }
    }

    // Clean up duplicate quiz attempts in Supabase background
    if (duplicateIdsToRemove.length > 0) {
      void Promise.resolve(supabase.from('quiz_attempts').delete().in('id', duplicateIdsToRemove)).catch(() => {});
    }

    return { attempts: deduplicatedAttempts, error: null };
  } catch (err: any) {
    console.error('Quiz DB error:', err);
    return { attempts: [], error: err.message || 'Failed to fetch quiz attempts.' };
  }
}

// -------------------------------------------------------------
// 6. STUDY PROGRESS
// -------------------------------------------------------------

export interface SupabaseProgressData {
  progress: StudentProgress;
  rawStudyProgress: {
    study_minutes: number;
    tasks_completed: number;
    verified_pages: number;
  };
  error: string | null;
}

/**
 * Loads real Supabase data for the dashboard:
 * - Average Quiz Score must be calculated from quiz_attempts
 * - Study Time must come from study_progress.study_minutes
 * - Tasks Done must come from study_progress.tasks_completed
 * - Verified Pages must come from study_progress.verified_pages
 *
 * If the logged-in user has no study_progress record, creates one with:
 * user_id = user.id, study_minutes = 0, tasks_completed = 0, verified_pages = 0
 */
export async function fetchStudyProgressFromSupabase(
  targetUserId?: string
): Promise<{ progress: StudentProgress | null; error: string | null }> {
  if (!checkIsConfigured()) {
    return { progress: null, error: 'Supabase is not configured.' };
  }

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  const userId = user?.id || targetUserId;
  if (!userId) {
    return { progress: null, error: 'Please sign in to save your activity.' };
  }

  try {
    // 1. Load study_progress record using array query to prevent PGRST116 multiple-rows error
    let { data: progressRows, error: progressError } = await supabase
      .from('study_progress')
      .select('*')
      .eq('user_id', userId);

    if (progressError) {
      console.error('Progress DB error:', progressError);
    }

    let progressRow = progressRows && progressRows.length > 0 ? progressRows[0] : null;

    // If multiple rows exist, pick the best one and clean up redundant duplicates
    if (progressRows && progressRows.length > 1) {
      progressRow = progressRows.reduce((prev: any, curr: any) => {
        const prevScore = (prev.study_minutes || 0) + (prev.tasks_completed || 0) + (prev.verified_pages || 0);
        const currScore = (curr.study_minutes || 0) + (curr.tasks_completed || 0) + (curr.verified_pages || 0);
        return currScore > prevScore ? curr : prev;
      }, progressRows[0]);

      if (progressRow?.id) {
        const dupIds = progressRows
          .filter((r: any) => r.id && r.id !== progressRow.id)
          .map((r: any) => r.id);
        if (dupIds.length > 0) {
          await supabase.from('study_progress').delete().in('id', dupIds);
        }
      }
    }

    // If the logged-in user has no study_progress record, create one
    if (!progressRow && !progressError) {
      const { data: newRows, error: insertError } = await supabase
        .from('study_progress')
        .insert({
          user_id: userId,
          study_minutes: 0,
          tasks_completed: 0,
          verified_pages: 0,
        })
        .select();

      if (insertError) {
        console.error('Progress DB error:', insertError);
      } else if (newRows && newRows.length > 0) {
        progressRow = newRows[0];
      }
    }

    // 2. Average Quiz Score must be calculated from quiz_attempts
    const { data: attempts, error: quizError } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_questions, created_at, learning_material_id')
      .eq('user_id', userId);

    if (quizError) {
      console.error('Quiz DB error:', quizError);
    }

    // Deduplicate attempts if double entries exist
    const rawAttemptsList = attempts || [];
    const uniqueAttempts: any[] = [];
    for (const att of rawAttemptsList) {
      const isDup = uniqueAttempts.some((existing) => {
        const sameScore = existing.score === att.score && existing.total_questions === att.total_questions;
        const sameMat = (existing.learning_material_id || '') === (att.learning_material_id || '');
        if (!sameScore || !sameMat) return false;
        if (existing.created_at && att.created_at) {
          return Math.abs(new Date(existing.created_at).getTime() - new Date(att.created_at).getTime()) <= 30000;
        }
        return true;
      });
      if (!isDup) uniqueAttempts.push(att);
    }

    let averageQuizScore = 0;
    const quizzesCompleted = uniqueAttempts.length;
    if (uniqueAttempts.length > 0) {
      const totalPercentage = uniqueAttempts.reduce((sum: number, q: any) => {
        const pct = q.total_questions > 0 ? (q.score / q.total_questions) * 100 : 0;
        return sum + pct;
      }, 0);
      averageQuizScore = Math.round(totalPercentage / uniqueAttempts.length);
    }

    // 3. Count learning materials
    const { count: materialsCount, error: matErr } = await supabase
      .from('learning_materials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (matErr) {
      console.error('Material DB error:', matErr);
    }

    const calculatedProgress: StudentProgress = {
      totalStudyMinutes: progressRow?.study_minutes ?? 0,
      tasksCompleted: progressRow?.tasks_completed ?? 0,
      verifiedCitationsCount: progressRow?.verified_pages ?? 0,
      averageQuizScore,
      quizzesCompleted,
      lessonsReviewed: materialsCount ?? 0,
      topicsStudied: [],
    };

    return { progress: calculatedProgress, error: null };
  } catch (err: any) {
    console.error('Progress DB error:', err);
    return { progress: null, error: err.message || 'Failed to fetch study progress.' };
  }
}

/**
 * Increment or set values in study_progress: study_minutes, tasks_completed, verified_pages
 */
export async function updateStudyProgressInSupabase(updates: {
  studyMinutesDelta?: number;
  tasksCompletedDelta?: number;
  tasksCompletedExact?: number;
  verifiedPagesDelta?: number;
}): Promise<{ success: boolean; error?: string }> {
  if (!checkIsConfigured()) return { success: false };

  // 1. AUTHENTICATED USER
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Please sign in to save your activity.' };
  }

  try {
    const { data: rows, error: fetchErr } = await supabase
      .from('study_progress')
      .select('*')
      .eq('user_id', user.id);

    if (fetchErr) {
      console.error('Progress DB error:', fetchErr);
    }

    let curRow = rows && rows.length > 0 ? rows[0] : null;
    if (rows && rows.length > 1) {
      curRow = rows.reduce((prev: any, curr: any) => {
        const prevScore = (prev.study_minutes || 0) + (prev.tasks_completed || 0) + (prev.verified_pages || 0);
        const currScore = (curr.study_minutes || 0) + (curr.tasks_completed || 0) + (curr.verified_pages || 0);
        return currScore > prevScore ? curr : prev;
      }, rows[0]);
    }

    const curMin = curRow?.study_minutes ?? 0;
    const curTasks = curRow?.tasks_completed ?? 0;
    const curPages = curRow?.verified_pages ?? 0;

    const newMin = updates.studyMinutesDelta !== undefined ? curMin + updates.studyMinutesDelta : curMin;
    const newTasks =
      updates.tasksCompletedExact !== undefined
        ? updates.tasksCompletedExact
        : updates.tasksCompletedDelta !== undefined
        ? curTasks + updates.tasksCompletedDelta
        : curTasks;
    const newPages = updates.verifiedPagesDelta !== undefined ? curPages + updates.verifiedPagesDelta : curPages;

    if (curRow) {
      // Update existing record using ID if present, otherwise user_id (avoids 42P10 ON CONFLICT error)
      let updateBuilder = supabase.from('study_progress').update({
        study_minutes: newMin,
        tasks_completed: newTasks,
        verified_pages: newPages,
      });

      if (curRow.id) {
        updateBuilder = updateBuilder.eq('id', curRow.id);
      } else {
        updateBuilder = updateBuilder.eq('user_id', user.id);
      }

      const { error: progressError } = await updateBuilder;

      if (progressError) {
        console.error('Progress DB error:', progressError);
        return { success: false, error: progressError.message };
      }

      // Consolidate/clean up duplicate rows if multiple rows were found
      if (rows && rows.length > 1 && curRow.id) {
        const dupIds = rows.filter((r: any) => r.id && r.id !== curRow.id).map((r: any) => r.id);
        if (dupIds.length > 0) {
          await supabase.from('study_progress').delete().in('id', dupIds);
        }
      }
    } else {
      // Insert initial record if none exists yet
      const { error: insertError } = await supabase.from('study_progress').insert({
        user_id: user.id,
        study_minutes: newMin,
        tasks_completed: newTasks,
        verified_pages: newPages,
      });

      if (insertError) {
        console.error('Progress DB error:', insertError);
        return { success: false, error: insertError.message };
      }
    }

    notifyDataChanged();
    return { success: true };
  } catch (err: any) {
    console.error('Progress DB error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Compatibility wrapper
 */
export async function syncStudyProgressToSupabase(
  _userId: string,
  progress: StudentProgress
): Promise<{ success: boolean; error?: string }> {
  return updateStudyProgressInSupabase({
    studyMinutesDelta: 0,
    tasksCompletedExact: progress.tasksCompleted,
  });
}

// -------------------------------------------------------------
// AI Tutor Interaction Logging (ask_tutor_logs)
// -------------------------------------------------------------

export interface LogAskTutorParams {
  question: string;
  answer: string;
  sourceType: 'uploaded_material' | 'gemini';
  materialTitle?: string | null;
  pageReference?: string | number | null;
}

/**
 * Saves one record to the ask_tutor_logs table for the currently authenticated Supabase user.
 * Fields saved:
 * - user_id = currently authenticated Supabase user's ID
 * - question = student's question
 * - answer = final AI Tutor response
 * - source_type = 'uploaded_material' or 'gemini'
 * - material_title = source document title when applicable, otherwise null
 * - page_reference = page/citation when applicable, otherwise null
 * - created_at = let Supabase generate this automatically
 */
export async function logAskTutorQuestion(
  params: LogAskTutorParams
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!checkIsConfigured()) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      // Unauthenticated or guest user: no log is saved
      return { success: false, error: 'User is not authenticated' };
    }

    const payload = {
      user_id: user.id,
      question: params.question,
      answer: params.answer,
      source_type: params.sourceType,
      material_title: params.sourceType === 'uploaded_material' ? (params.materialTitle ?? null) : null,
      page_reference: params.sourceType === 'uploaded_material' ? (params.pageReference ?? null) : null,
    };

    let { data, error } = await supabase
      .from('ask_tutor_logs')
      .insert(payload)
      .select();

    // If page_reference fails because table schema expects integer, retry with extracted integer
    if (error && error.message?.includes('integer') && payload.page_reference) {
      const match = String(payload.page_reference).match(/\d+/);
      if (match) {
        const retryPayload = {
          ...payload,
          page_reference: parseInt(match[0], 10),
        };
        const retry = await supabase.from('ask_tutor_logs').insert(retryPayload).select();
        data = retry.data;
        error = retry.error;
      }
    }

    if (error) {
      console.error('Error saving record to ask_tutor_logs:', error);
      return { success: false, error: error.message };
    }

    notifyDataChanged();
    return { success: true, data };
  } catch (err: any) {
    console.error('Exception writing to ask_tutor_logs:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

