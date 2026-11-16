import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Lock,
  GraduationCap,
  Briefcase,
  Check,
  Loader2,
  AlertCircle,
  Shield,
  ShieldCheck,
  KeyRound,
  Sparkles,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';
import { DEFAULT_USER } from '../data/mockUserData';
import {
  saveUserProfile,
  setLoggedIn,
  syncUserDataFromSupabase,
  resetUserScopedLocalData,
} from '../services/storage';
import {
  signUpStudent,
  signInStudent,
  signOutStudent,
  getActiveSupabaseConfig,
  verifyUserRoleWithServer,
  triggerInitialSuperAdminBootstrap,
  sendPasswordResetEmail,
} from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUserChange: (user: UserProfile) => void;
  initialMode?: 'login' | 'signup' | 'admin_login';
  onOpenAdminDashboard?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
  initialMode = 'login',
  onOpenAdminDashboard,
}) => {
  // Login Type: 'student' or 'admin'
  const [loginType, setLoginType] = useState<'student' | 'admin'>(
    initialMode === 'admin_login' ? 'admin' : 'student'
  );

  // Student Submode: 'login' | 'signup' | 'forgot_password'
  const [studentMode, setStudentMode] = useState<'login' | 'signup' | 'forgot_password'>('login');

  // Form Fields
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('');
  const [degree, setDegree] = useState(currentUser.degree);
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle);

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Initial Super Admin Quick Activation status
  const [isBootstrappingInitial, setIsBootstrappingInitial] = useState(false);

  const switchStudentMode = (nextMode: 'login' | 'signup' | 'forgot_password') => {
    setStudentMode(nextMode);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (nextMode === 'signup') {
      setFullName('');
      setEmail('');
      setPassword('');
      setDegree('');
      setJobTitle('');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setPassword('');
      if (initialMode === 'admin_login') {
        setLoginType('admin');
        setStudentMode('login');
      } else if (initialMode === 'signup') {
        setLoginType('student');
        setStudentMode('signup');
        setFullName('');
        setEmail('');
        setDegree('');
        setJobTitle('');
      } else {
        setLoginType('student');
        setStudentMode('login');
        setFullName(currentUser.fullName);
        setEmail(currentUser.email);
        setDegree(currentUser.degree);
        setJobTitle(currentUser.jobTitle);
      }
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  // Handle Student Login & Sign Up
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (studentMode === 'forgot_password') {
      setLoading(true);
      setLoadingMessage('Sending password recovery instructions...');
      const res = await sendPasswordResetEmail(email.trim());
      setLoading(false);
      if (res.success) {
        setSuccessMessage('Password recovery link sent! Please check your email inbox.');
      } else {
        setErrorMessage(res.error || 'Failed to send recovery email. Please try again.');
      }
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    const supabaseConfig = getActiveSupabaseConfig();
    const cleanEmail = email.trim();

    // -------------------------------------------------------------
    // ADMINISTRATOR LOGIN FLOW
    // -------------------------------------------------------------
    if (loginType === 'admin') {
      setLoading(true);
      setLoadingMessage('Authenticating administrator credentials with Supabase...');

      if (supabaseConfig.isConfigured) {
        const authRes = await signInStudent({
          email: cleanEmail,
          password,
        });

        if (authRes.error) {
          setLoading(false);
          setErrorMessage(authRes.error);
          return;
        }

        // Server-Side Role Verification (CRITICAL SECURITY REQUIREMENT)
        setLoadingMessage('Verifying administrative access permissions...');
        const roleRes = await verifyUserRoleWithServer({
          email: cleanEmail,
          userId: authRes.user?.id,
          fullName: authRes.profile?.fullName,
        });

        if (!roleRes.isAdmin) {
          // Immediately sign out from Supabase to prevent unauthorized session
          await signOutStudent();
          setLoading(false);
          setErrorMessage(
            `Access Denied: The account "${cleanEmail}" does not possess Administrator or Super Administrator privileges. Please use Student Login.`
          );
          return;
        }

        setLoading(false);
        const adminProfile: UserProfile = {
          id: authRes.user?.id || 'admin-user',
          fullName: authRes.profile?.fullName || 'Administrator',
          email: cleanEmail,
          role: roleRes.role,
          degree: authRes.profile?.degree || 'Master of Science',
          jobTitle: authRes.profile?.jobTitle || 'System Administrator',
          avatarSeed: cleanEmail.toLowerCase().replace(/\s+/g, '-'),
          accountStatus: roleRes.accountStatus,
        };

        if (adminProfile.id !== currentUser.id) {
          resetUserScopedLocalData(adminProfile.id);
        }
        saveUserProfile(adminProfile);
        setLoggedIn(true);
        onUserChange(adminProfile);
        syncUserDataFromSupabase(adminProfile.id);
        setSuccessMessage(`Welcome, Administrator ${adminProfile.fullName}!`);

        setTimeout(() => {
          onClose();
          if (onOpenAdminDashboard) {
            onOpenAdminDashboard();
          }
        }, 800);
        return;
      } else {
        // Local offline check if Supabase is unconfigured
        const roleRes = await verifyUserRoleWithServer({ email: cleanEmail });
        setLoading(false);
        if (!roleRes.isAdmin) {
          setErrorMessage(
            `Access Denied: The account "${cleanEmail}" does not possess administrative privileges.`
          );
          return;
        }

        const adminProfile: UserProfile = {
          id: 'admin-super-noel-01',
          fullName: 'Noel Historillo',
          email: cleanEmail,
          role: 'super_admin',
          degree: 'Master of Science in Information Technology',
          jobTitle: 'Super Administrator',
          avatarSeed: 'noel-historillo',
          accountStatus: 'active',
        };
        if (adminProfile.id !== currentUser.id) {
          resetUserScopedLocalData(adminProfile.id);
        }
        saveUserProfile(adminProfile);
        setLoggedIn(true);
        onUserChange(adminProfile);
        setSuccessMessage(`Welcome, Super Administrator Noel Historillo!`);
        setTimeout(() => {
          onClose();
          if (onOpenAdminDashboard) {
            onOpenAdminDashboard();
          }
        }, 800);
        return;
      }
    }

    // -------------------------------------------------------------
    // STUDENT LOGIN & SIGNUP FLOW
    // -------------------------------------------------------------
    if (loginType === 'student') {
      if (studentMode === 'signup') {
        if (!fullName.trim()) {
          setErrorMessage('Please enter your full name for your student profile.');
          return;
        }
        if (password.length < 6) {
          setErrorMessage('Password must be at least 6 characters long.');
          return;
        }
      }

      if (supabaseConfig.isConfigured) {
        setLoading(true);

        if (studentMode === 'signup') {
          setLoadingMessage('Creating student account on Supabase Auth...');
          const res = await signUpStudent({
            email: cleanEmail,
            password,
            fullName: fullName.trim(),
            degree: degree.trim(),
            jobTitle: jobTitle.trim(),
          });

          if (res.error) {
            setLoading(false);
            setErrorMessage(res.error);
            return;
          }

          if (res.needsEmailConfirmation) {
            setLoading(false);
            setSuccessMessage(
              'Student account registered! A confirmation email has been sent by Supabase. Please verify your email, then log in.'
            );
            setStudentMode('login');
            setPassword('');
            return;
          }

          if (res.user) {
            const roleCheck = await verifyUserRoleWithServer({
              email: cleanEmail,
              userId: res.user.id,
              fullName: fullName.trim(),
              degree: degree.trim(),
              jobTitle: jobTitle.trim(),
            });

            const newProfile: UserProfile = {
              id: res.user.id,
              fullName: fullName.trim(),
              email: cleanEmail,
              role: roleCheck.role,
              degree: degree.trim() || 'College Student',
              jobTitle: jobTitle.trim() || 'Working Student',
              avatarSeed: fullName.trim().toLowerCase().replace(/\s+/g, '-'),
              accountStatus: 'active',
            };

            resetUserScopedLocalData(newProfile.id);
            saveUserProfile(newProfile);
            setLoggedIn(true);
            onUserChange(newProfile);
            await syncUserDataFromSupabase(newProfile.id);
            setLoading(false);
            setSuccessMessage('Student account registered and authenticated via Supabase!');
            setTimeout(() => {
              onClose();
            }, 800);
            return;
          }
          setLoading(false);
        } else {
          // STUDENT LOGIN
          setLoadingMessage('Authenticating with Supabase...');
          const res = await signInStudent({
            email: cleanEmail,
            password,
          });

          setLoading(false);

          if (res.error) {
            setErrorMessage(res.error);
            return;
          }

          if (res.profile) {
            const roleCheck = await verifyUserRoleWithServer({
              email: cleanEmail,
              userId: res.profile.id,
              fullName: res.profile.fullName,
            });

            if (roleCheck.error) {
              setErrorMessage(roleCheck.error);
              return;
            }

            const updatedProfile: UserProfile = {
              ...res.profile,
              role: roleCheck.role,
              accountStatus: roleCheck.accountStatus,
            };

            if (updatedProfile.id !== currentUser.id) {
              resetUserScopedLocalData(updatedProfile.id);
            }
            saveUserProfile(updatedProfile);
            setLoggedIn(true);
            onUserChange(updatedProfile);
            await syncUserDataFromSupabase(updatedProfile.id);
            setSuccessMessage(`Welcome back, ${updatedProfile.fullName}!`);
            setTimeout(() => {
              onClose();
            }, 800);
            return;
          }
        }
      } else {
        // Local session fallback when Supabase credentials are not configured
        setLoading(true);
        const cleanName = fullName.trim() || cleanEmail.split('@')[0];
        const deterministicId = `local-${cleanEmail.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const roleCheck = await verifyUserRoleWithServer({
          email: cleanEmail,
          userId: deterministicId,
          fullName: cleanName,
          degree: degree.trim(),
          jobTitle: jobTitle.trim(),
        });
        setLoading(false);
        if (roleCheck.error) {
          setErrorMessage(roleCheck.error);
          return;
        }
        const localUser: UserProfile = {
          id: deterministicId,
          fullName: cleanName,
          email: cleanEmail,
          role: roleCheck.role,
          degree: degree.trim() || 'College Student',
          jobTitle: jobTitle.trim() || 'Working Student',
          avatarSeed: cleanName.toLowerCase().replace(/\s+/g, '-'),
          accountStatus: roleCheck.accountStatus || 'active',
        };
        if (localUser.id !== currentUser.id) {
          resetUserScopedLocalData(localUser.id);
        }
        saveUserProfile(localUser);
        setLoggedIn(true);
        onUserChange(localUser);
        setSuccessMessage(
          studentMode === 'signup'
            ? `Student account created for ${cleanName}!`
            : `Welcome back, ${cleanName}!`
        );
        setTimeout(() => {
          onClose();
        }, 800);
      }
    }
  };

  // Quick initial Super Administrator setup trigger (for Noel Historillo)
  const handleBootstrapInitialAdmin = async () => {
    setIsBootstrappingInitial(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const res = await triggerInitialSuperAdminBootstrap({
      email: 'historillo.noel1994@gmail.com',
      fullName: 'Noel Historillo',
    });
    setIsBootstrappingInitial(false);

    if (res.success) {
      setSuccessMessage(res.message);
      setEmail('historillo.noel1994@gmail.com');
      setLoginType('admin');
    } else {
      setErrorMessage(res.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 text-white flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2">
              <h3 className="font-extrabold text-base text-white tracking-tight">
                Study Buddy AI Authentication
              </h3>
              <span className="px-2 py-0.5 bg-sky-500/20 text-sky-200 border border-sky-400/30 text-[10px] rounded-full font-semibold flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3 text-sky-300" />
                <span>Supabase RBAC</span>
              </span>
            </div>
            <p className="text-xs text-sky-200/90">
              {loginType === 'student'
                ? 'Sign in to access your learning materials, quizzes & study plans'
                : 'Restricted administrative authorization portal'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* TWO PRIMARY LOGIN OPTIONS (PART 2) */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-100 border-b border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setLoginType('student');
              setStudentMode('login');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`py-2.5 px-3 rounded-2xl flex items-center justify-center space-x-2 transition-all cursor-pointer ${
              loginType === 'student'
                ? 'bg-white text-sky-800 shadow-sm border border-slate-200/80 font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GraduationCap className="w-4 h-4 text-sky-600" />
            <span>STUDENT LOGIN</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setLoginType('admin');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`py-2.5 px-3 rounded-2xl flex items-center justify-center space-x-2 transition-all cursor-pointer ${
              loginType === 'admin'
                ? 'bg-slate-900 text-white shadow-sm font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4 text-amber-400" />
            <span>ADMINISTRATOR LOGIN</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Feedback messages */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-900 flex items-start space-x-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold block">Authentication Notice</span>
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-start space-x-2.5 animate-fadeIn">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold block">Success</span>
                <p className="leading-relaxed">{successMessage}</p>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* 1. STUDENT LOGIN INTERFACE */}
          {/* ========================================================= */}
          {loginType === 'student' && (
            <div className="space-y-4">
              {/* Sub-mode navigation for Student */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="space-x-3 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => switchStudentMode('login')}
                    className={`pb-1 cursor-pointer transition-colors ${
                      studentMode === 'login'
                        ? 'text-sky-700 border-b-2 border-sky-600'
                        : 'text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    Student Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchStudentMode('signup')}
                    className={`pb-1 cursor-pointer transition-colors ${
                      studentMode === 'signup'
                        ? 'text-sky-700 border-b-2 border-sky-600'
                        : 'text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    Register New Student
                  </button>
                </div>

                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  STUDENT PORTAL
                </span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                {studentMode === 'signup' && (
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Full Name</label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Maria Santos"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    {studentMode === 'signup' ? 'Student Email' : 'Email Address'}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="student@university.edu"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                    />
                  </div>
                </div>

                {studentMode !== 'forgot_password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-700 font-bold">Password</label>
                      {studentMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => {
                            setStudentMode('forgot_password');
                            setErrorMessage(null);
                          }}
                          className="text-[11px] font-bold text-sky-700 hover:underline cursor-pointer"
                        >
                          Forgot Password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                      />
                    </div>
                  </div>
                )}

                {studentMode === 'signup' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-slate-700 font-bold mb-1">Course / Program</label>
                        <div className="relative">
                          <GraduationCap className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                          <input
                            type="text"
                            value={degree}
                            onChange={(e) => setDegree(e.target.value)}
                            placeholder="BS Computer Science"
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-slate-700 font-bold mb-1">Job / Work Role</label>
                        <div className="relative">
                          <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                          <input
                            type="text"
                            value={jobTitle}
                            onChange={(e) => setJobTitle(e.target.value)}
                            placeholder="Customer Support (20h/wk)"
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-extrabold rounded-xl shadow-xs transition-colors mt-2 cursor-pointer flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{loadingMessage || 'Processing...'}</span>
                    </>
                  ) : (
                    <span>
                      {studentMode === 'login'
                        ? 'LOG IN'
                        : studentMode === 'signup'
                        ? 'REGISTER NEW STUDENT'
                        : 'SEND RECOVERY EMAIL'}
                    </span>
                  )}
                </button>
              </form>

              {/* Quick toggle between Login and Sign up */}
              <div className="text-center pt-2 border-t border-slate-100 text-xs text-slate-500">
                {studentMode === 'login' ? (
                  <span>
                    Need a student account?{' '}
                    <button
                      type="button"
                      onClick={() => switchStudentMode('signup')}
                      className="font-bold text-sky-700 hover:underline cursor-pointer"
                    >
                      REGISTER NEW STUDENT
                    </button>
                  </span>
                ) : (
                  <span>
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => switchStudentMode('login')}
                      className="font-bold text-sky-700 hover:underline cursor-pointer"
                    >
                      Return to Log In
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* 2. ADMINISTRATOR LOGIN INTERFACE */}
          {/* ========================================================= */}
          {loginType === 'admin' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-900 text-white rounded-2xl space-y-1">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span className="font-extrabold text-xs uppercase tracking-wider text-amber-300">
                    Protected Administrative Access
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Only accounts granted Administrator or Super Administrator authority can access administrative functions. Unauthorized attempts are audited.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Administrator Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@university.edu"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-medium"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-700 font-bold">Password</label>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!email.trim()) {
                          setErrorMessage('Please enter your administrator email first.');
                          return;
                        }
                        setLoading(true);
                        const res = await sendPasswordResetEmail(email.trim());
                        setLoading(false);
                        if (res.success) {
                          setSuccessMessage('Password recovery link dispatched to administrator email.');
                        } else {
                          setErrorMessage(res.error || 'Failed to send recovery link.');
                        }
                      }}
                      className="text-[11px] font-bold text-sky-700 hover:underline cursor-pointer"
                    >
                      FORGOT PASSWORD
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-medium"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-slate-900 hover:bg-black disabled:opacity-60 text-white font-extrabold rounded-xl shadow-xs transition-colors mt-2 cursor-pointer flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      <span>{loadingMessage || 'Verifying administrative permissions...'}</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-amber-400" />
                      <span>ADMINISTRATOR SIGN IN</span>
                    </>
                  )}
                </button>
              </form>

              {/* Initial Super Administrator Activation Callout (Part 3) */}
              <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-amber-950 flex items-center space-x-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Initial Super Administrator Setup</span>
                  </span>
                  <span className="px-2 py-0.5 bg-amber-200/60 text-amber-900 rounded-full font-bold text-[10px]">
                    One-Time Provision
                  </span>
                </div>

                <p className="text-[11px] text-amber-900 leading-snug">
                  Initial administrator: <strong>Noel Historillo</strong> (<code className="font-mono text-[10px]">historillo.noel1994@gmail.com</code>).
                </p>

                <button
                  type="button"
                  onClick={handleBootstrapInitialAdmin}
                  disabled={isBootstrappingInitial}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center space-x-1.5 shadow-2xs"
                >
                  {isBootstrappingInitial ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Activating Super Administrator...</span>
                    </>
                  ) : (
                    <>
                      <span>Activate Initial Super Administrator (Noel Historillo)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
