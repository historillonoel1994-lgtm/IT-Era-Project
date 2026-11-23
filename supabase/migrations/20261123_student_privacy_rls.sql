-- ============================================================================
-- STUDY BUDDY AI — STUDENT DATA PRIVACY & ISOLATION MIGRATION (NON-DESTRUCTIVE)
-- ============================================================================
-- REVIEW BEFORE EXECUTING IN SUPABASE SQL EDITOR.
--
-- Safety guarantees:
--   1. Does NOT delete or overwrite any existing student accounts or records.
--   2. Does NOT arbitrarily reassign rows with missing user_id values.
--   3. Step 1 (Audit Queries) lets you inspect any orphaned/legacy records first.
--   4. Step 2 enables Row Level Security (RLS) and strict per-student policies
--      using auth.uid() across all user-owned tables and private Storage bucket.
-- ============================================================================

-- ============================================================================
-- STEP 1: READ-ONLY PRE-MIGRATION OWNERSHIP AUDIT (RUN FIRST TO REVIEW)
-- ============================================================================
-- Check if any rows are missing user_id (do NOT auto-assign or delete):
SELECT 'learning_materials' AS table_name, COUNT(*) AS missing_user_id_count
FROM public.learning_materials WHERE user_id IS NULL
UNION ALL
SELECT 'quiz_attempts' AS table_name, COUNT(*) AS missing_user_id_count
FROM public.quiz_attempts WHERE user_id IS NULL
UNION ALL
SELECT 'study_progress' AS table_name, COUNT(*) AS missing_user_id_count
FROM public.study_progress WHERE user_id IS NULL;

-- Check Storage objects in 'study-buddy-materials' whose first path segment is NOT a UUID:
SELECT name, bucket_id, owner, created_at
FROM storage.objects
WHERE bucket_id = 'study-buddy-materials'
  AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
LIMIT 50;


-- ============================================================================
-- STEP 2: ENABLE ROW LEVEL SECURITY & STRICT USER-OWNED POLICIES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2A. PROFILES (Each user can only view/insert/update their own profile)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- 2B. LEARNING MATERIALS (Private by default; optional public flag supported)
-- ----------------------------------------------------------------------------
ALTER TABLE public.learning_materials ENABLE ROW LEVEL SECURITY;

-- Add non-destructive opt-in is_public column (defaults to FALSE = private)
ALTER TABLE public.learning_materials
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "learning_materials_select_own" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_insert_own" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_update_own" ON public.learning_materials;
DROP POLICY IF EXISTS "learning_materials_delete_own" ON public.learning_materials;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.learning_materials;

CREATE POLICY "learning_materials_select_own"
  ON public.learning_materials
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR is_public = true);

CREATE POLICY "learning_materials_insert_own"
  ON public.learning_materials
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "learning_materials_update_own"
  ON public.learning_materials
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "learning_materials_delete_own"
  ON public.learning_materials
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2C. QUIZ ATTEMPTS (Strictly private to the owning student)
-- ----------------------------------------------------------------------------
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quiz_attempts_select_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "quiz_attempts_insert_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "quiz_attempts_update_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "quiz_attempts_delete_own" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.quiz_attempts;

CREATE POLICY "quiz_attempts_select_own"
  ON public.quiz_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "quiz_attempts_insert_own"
  ON public.quiz_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "quiz_attempts_update_own"
  ON public.quiz_attempts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "quiz_attempts_delete_own"
  ON public.quiz_attempts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2D. STUDY PROGRESS (Strictly private to the owning student)
-- ----------------------------------------------------------------------------
ALTER TABLE public.study_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "study_progress_select_own" ON public.study_progress;
DROP POLICY IF EXISTS "study_progress_insert_own" ON public.study_progress;
DROP POLICY IF EXISTS "study_progress_update_own" ON public.study_progress;
DROP POLICY IF EXISTS "study_progress_delete_own" ON public.study_progress;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.study_progress;

CREATE POLICY "study_progress_select_own"
  ON public.study_progress
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "study_progress_insert_own"
  ON public.study_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "study_progress_update_own"
  ON public.study_progress
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "study_progress_delete_own"
  ON public.study_progress
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2E. OPTIONAL TABLES (ask_tutor_logs, schedules, flashcards, reviewers if present)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ask_tutor_logs',
    'tutor_logs',
    'schedules',
    'study_schedules',
    'flashcards',
    'reviewers'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'user_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_select_own" ON public.%I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_insert_own" ON public.%I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_update_own" ON public.%I', tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS "%s_delete_own" ON public.%I', tbl, tbl);

      EXECUTE format(
        'CREATE POLICY "%s_select_own" ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
        tbl, tbl
      );
      EXECUTE format(
        'CREATE POLICY "%s_insert_own" ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
        tbl, tbl
      );
      EXECUTE format(
        'CREATE POLICY "%s_update_own" ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
        tbl, tbl
      );
      EXECUTE format(
        'CREATE POLICY "%s_delete_own" ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 2F. PRIVATE SUPABASE STORAGE BUCKET & PER-STUDENT FOLDER POLICIES
-- ----------------------------------------------------------------------------
-- Ensure bucket 'study-buddy-materials' is PRIVATE (not publicly browsable)
UPDATE storage.buckets
SET public = false
WHERE id = 'study-buddy-materials';

DROP POLICY IF EXISTS "materials_storage_select_own" ON storage.objects;
DROP POLICY IF EXISTS "materials_storage_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "materials_storage_update_own" ON storage.objects;
DROP POLICY IF EXISTS "materials_storage_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;

-- Each student's files live inside "<auth.uid()>/<timestamp>_<filename>"
CREATE POLICY "materials_storage_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'study-buddy-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "materials_storage_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'study-buddy-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "materials_storage_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'study-buddy-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'study-buddy-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "materials_storage_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'study-buddy-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
