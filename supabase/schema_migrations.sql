-- ======================================================================
-- STUDY BUDDY AI: SECURE USER ACCOUNT MANAGEMENT & ADMINISTRATOR SECURITY
-- Database Schema Migrations & Row Level Security (RLS)
-- ======================================================================

-- 1. Create Enum or Check Constraints for User Roles
-- Supported roles: 'student', 'admin', 'super_admin'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_type') THEN
    CREATE TYPE user_role_type AS ENUM ('student', 'admin', 'super_admin');
  END IF;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Enhanced Profiles Table
-- Ensure profiles table has all personal information and academic fields
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  first_name text DEFAULT '',
  middle_name text DEFAULT '',
  last_name text DEFAULT '',
  display_name text DEFAULT '',
  email text NOT NULL DEFAULT '',
  degree text DEFAULT '',
  job_title text DEFAULT '',
  institution text DEFAULT '',
  course text DEFAULT '',
  year_level text DEFAULT '',
  phone text DEFAULT '',
  avatar_seed text DEFAULT '',
  avatar_url text DEFAULT '',
  account_status text DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'pending')),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Safely add missing columns to profiles if the table already existed
DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS middle_name text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS institution text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS course text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS year_level text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT '';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
EXCEPTION
  WHEN others THEN null;
END $$;

-- 3. Dedicated User Roles Table (Server-Controlled Authority)
-- Never allow clients to alter roles via public API
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin', 'super_admin')),
  assigned_at timestamptz DEFAULT now(),
  assigned_by text DEFAULT 'system'
);

-- 4. Administrator Invitations Table (One-Time, Time-Limited)
CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'super_admin')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inviter_email text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 5. Security Audit Logs Table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id text,
  admin_email text,
  action text NOT NULL,
  target_user_id text,
  target_user_email text,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- 6. System Configuration Table
CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text DEFAULT 'system',
  updated_at timestamptz DEFAULT now()
);

-- 7. Trigger to automatically assign 'student' role on public signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger AS $$
BEGIN
  -- Insert default student role for every new account
  INSERT INTO public.user_roles (user_id, role, assigned_at, assigned_by)
  VALUES (new.id, 'student', now(), 'signup_trigger')
  ON CONFLICT (user_id) DO NOTHING;

  -- Ensure profile exists (resilient against minimal profiles schemas)
  BEGIN
    INSERT INTO public.profiles (
      id,
      full_name,
      email,
      degree,
      job_title,
      created_at
    )
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
      COALESCE(new.email, ''),
      COALESCE(new.raw_user_meta_data->>'degree', 'College Student'),
      COALESCE(new.raw_user_meta_data->>'job_title', 'Working Student'),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN undefined_column THEN
    INSERT INTO public.profiles (id, full_name, created_at)
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  END;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_role();

-- 8. Row Level Security (RLS) Configuration

-- Enable RLS on all sensitive tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is admin or super_admin
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id
    AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if current user is super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id
    AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PROFILES POLICIES
-- Users can view their own profile; admins can view student profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin(auth.uid()));

-- Users can insert their own profile row upon registration
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can only update their own personal information
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- USER ROLES POLICIES
-- Users can view their own role; admins can view all roles
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Only super admins can update or insert roles
DROP POLICY IF EXISTS "Super admins can manage roles" ON public.user_roles;
CREATE POLICY "Super admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.is_super_admin(auth.uid()));

-- AUDIT LOGS POLICIES
-- Only admins can view audit logs; nobody can delete audit logs
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs FOR SELECT
  USING (public.is_admin(auth.uid()));

-- INVITATIONS POLICIES
-- Admins can view invitations; only super admins can create super_admin invites
DROP POLICY IF EXISTS "Admins can view invitations" ON public.admin_invitations;
CREATE POLICY "Admins can view invitations"
  ON public.admin_invitations FOR SELECT
  USING (public.is_admin(auth.uid()));

-- Initial Super Administrator bootstrap seed placeholder
-- Will be activated securely via the one-time backend bootstrap endpoint
COMMENT ON TABLE public.user_roles IS 'Secure Role-Based Access Control: student, admin, super_admin';
