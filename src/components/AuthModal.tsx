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
  LogOut,
  Database,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Globe,
  CheckCircle2,
} from 'lucide-react';
import { UserProfile } from '../types';
import { DEFAULT_USER } from '../data/mockUserData';
import { saveUserProfile, setLoggedIn, syncUserDataFromSupabase } from '../services/storage';
import {
  signUpStudent,
  signInStudent,
  signOutStudent,
  getActiveSupabaseConfig,
  saveSupabaseCredentials,
  clearSupabaseCredentials,
  testSupabaseConnection,
} from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUserChange: (user: UserProfile) => void;
  initialMode?: 'login' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('');
  const [degree, setDegree] = useState(currentUser.degree);
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle);

  // Supabase Configuration State
  const [supabaseConfig, setSupabaseConfig] = useState(getActiveSupabaseConfig());
  const [inputUrl, setInputUrl] = useState(supabaseConfig.url || '');
  const [inputKey, setInputKey] = useState(supabaseConfig.key || '');
  const [isConfigDrawerOpen, setIsConfigDrawerOpen] = useState(!supabaseConfig.isConfigured);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestFeedback, setConnectionTestFeedback] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  // Status & Feedback states
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
      setSuccessMessage(null);
      const current = getActiveSupabaseConfig();
      setSupabaseConfig(current);
      setInputUrl(current.url || '');
      setInputKey(current.key || '');
      if (!current.isConfigured) {
        setIsConfigDrawerOpen(true);
      }
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  // Handle Testing & Connecting Supabase directly from UI
  const handleConnectSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectionTestFeedback({ type: null, message: '' });
    setTestingConnection(true);

    const testRes = await testSupabaseConnection(inputUrl, inputKey);
    setTestingConnection(false);

    if (testRes.success) {
      saveSupabaseCredentials(inputUrl, inputKey);
      const updated = getActiveSupabaseConfig();
      setSupabaseConfig(updated);
      setConnectionTestFeedback({
        type: 'success',
        message: 'Successfully connected to Supabase! You can now Sign Up or Log In.',
      });
      setTimeout(() => {
        setIsConfigDrawerOpen(false);
      }, 1500);
    } else {
      setConnectionTestFeedback({
        type: 'error',
        message: testRes.message,
      });
    }
  };

  const handleDisconnect = () => {
    clearSupabaseCredentials();
    const updated = getActiveSupabaseConfig();
    setSupabaseConfig(updated);
    setInputUrl('');
    setInputKey('');
    setConnectionTestFeedback({ type: null, message: '' });
    setIsConfigDrawerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setErrorMessage('Please enter your student email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter a password.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    // 1. SUPABASE AUTHENTICATION FLOW
    if (supabaseConfig.isConfigured) {
      setLoading(true);

      if (mode === 'signup') {
        if (!fullName.trim()) {
          setErrorMessage('Please enter your full name for your student profile.');
          setLoading(false);
          return;
        }

        setLoadingMessage('Creating student account on Supabase Auth & saving profile...');
        const res = await signUpStudent({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          degree: degree.trim(),
          jobTitle: jobTitle.trim(),
        });

        setLoading(false);

        if (res.error) {
          setErrorMessage(res.error);
          return;
        }

        if (res.needsEmailConfirmation) {
          setSuccessMessage(
            'Account created! A confirmation email has been sent by Supabase. If email confirmation is disabled in your Supabase project, you can now switch to Login.'
          );
          setMode('login');
          return;
        }

        if (res.user) {
          const newProfile: UserProfile = {
            id: res.user.id,
            fullName: fullName.trim(),
            email: email.trim(),
            degree: degree.trim() || 'College Degree',
            jobTitle: jobTitle.trim() || 'Working Student',
            avatarSeed: fullName.trim().toLowerCase().replace(/\s+/g, '-'),
          };
          saveUserProfile(newProfile);
          setLoggedIn(true);
          onUserChange(newProfile);
          setSuccessMessage('Student account registered and authenticated via Supabase!');
          setTimeout(() => {
            onClose();
          }, 900);
          return;
        }
      } else {
        // LOGIN MODE
        setLoadingMessage('Authenticating with Supabase...');
        const res = await signInStudent({
          email: email.trim(),
          password,
        });

        setLoading(false);

        if (res.error) {
          setErrorMessage(res.error);
          return;
        }

        if (res.profile) {
          saveUserProfile(res.profile);
          setLoggedIn(true);
          onUserChange(res.profile);
          // Sync student's materials, quizzes, and progress
          syncUserDataFromSupabase(res.profile.id);
          setSuccessMessage(`Welcome back, ${res.profile.fullName}!`);
          setTimeout(() => {
            onClose();
          }, 800);
          return;
        }
      }
    } else {
      // 2. FALLBACK LOCAL MODE (If Supabase keys are not set yet)
      const updated: UserProfile = {
        id: `usr-${Date.now()}`,
        fullName: fullName.trim() || 'Working Student',
        email: email.trim() || 'student@university.edu',
        degree: degree.trim() || 'College Degree',
        jobTitle: jobTitle.trim() || 'Working Student',
        avatarSeed: (fullName || 'student').toLowerCase().replace(/\s+/g, '-'),
      };
      saveUserProfile(updated);
      setLoggedIn(true);
      onUserChange(updated);
      setSuccessMessage('Profile active locally. Connect Supabase above to sync to cloud database.');
      setTimeout(() => {
        onClose();
      }, 900);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setLoadingMessage('Signing out from Supabase...');
    if (supabaseConfig.isConfigured) {
      await signOutStudent();
    }
    setLoggedIn(false);
    saveUserProfile(DEFAULT_USER);
    onUserChange(DEFAULT_USER);
    setLoading(false);
    onClose();
  };

  const handleQuickDemoJuan = () => {
    saveUserProfile(DEFAULT_USER);
    setLoggedIn(true);
    onUserChange(DEFAULT_USER);
    onClose();
  };

  const handleQuickDemoMaria = () => {
    const maria: UserProfile = {
      id: 'usr-working-maria',
      fullName: 'Maria Santos',
      email: 'maria.santos@univ.edu',
      degree: 'BS Information Technology (3rd Year)',
      jobTitle: 'BPO Customer Support (Night Shift, 30 hrs/wk)',
      institution: 'City State College',
      avatarSeed: 'maria-studybuddy',
    };
    saveUserProfile(maria);
    setLoggedIn(true);
    onUserChange(maria);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 max-w-lg w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-sky-800 to-slate-900 text-white flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-base text-white">Student Account & Profile</h3>
              <span className="px-2 py-0.5 bg-sky-500/20 text-sky-200 border border-sky-400/30 text-[10px] rounded-full font-semibold flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3 text-sky-300" />
                <span>Account Access</span>
              </span>
            </div>
            <p className="text-xs text-sky-200/90">
              Manage your student profile & study records
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connection Header Bar */}
        <div className="px-6 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span
              className={`w-2 h-2 rounded-full ${
                supabaseConfig.isConfigured ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className="font-medium text-slate-700 text-[11px]">
              {supabaseConfig.isConfigured
                ? 'Account Cloud Sync Active'
                : 'Offline Mode (Local Storage)'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsConfigDrawerOpen(!isConfigDrawerOpen)}
            className="inline-flex items-center space-x-1 text-slate-600 hover:text-slate-900 text-[11px] font-semibold cursor-pointer"
          >
            <span>{isConfigDrawerOpen ? 'Hide Developer Settings' : 'Developer & Cloud Settings'}</span>
            {isConfigDrawerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Developer Connection Setup Box */}
        {isConfigDrawerOpen && (
          <div className="px-6 py-4 bg-amber-50/70 border-b border-amber-200 text-xs space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-bold text-amber-950 flex items-center space-x-1.5 text-xs">
                  <Database className="w-4 h-4 text-amber-700" />
                  <span>Developer & Cloud Connection</span>
                </h4>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Configure backend Supabase project credentials (URL & public API key).
                </p>
              </div>

              {supabaseConfig.isConfigured && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-[10px] text-red-600 hover:text-red-800 underline font-medium cursor-pointer"
                >
                  Clear credentials
                </button>
              )}
            </div>

            <form onSubmit={handleConnectSupabase} className="space-y-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Project URL
                </label>
                <div className="relative">
                  <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="url"
                    required
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="https://your-project-id.supabase.co"
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Publishable / Anon API Key
                </label>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="password"
                    required
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
                  />
                </div>
              </div>

              {connectionTestFeedback.message && (
                <div
                  className={`p-2 rounded-lg text-[11px] flex items-start space-x-1.5 ${
                    connectionTestFeedback.type === 'success'
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-red-100 text-red-900 border border-red-300'
                  }`}
                >
                  {connectionTestFeedback.type === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  )}
                  <span>{connectionTestFeedback.message}</span>
                </div>
              )}

              <div className="pt-1 flex items-center justify-between">
                <span className="text-[10px] text-amber-800">
                  Credentials are saved securely in your browser session.
                </span>
                <button
                  type="submit"
                  disabled={testingConnection}
                  className="px-3 py-1.5 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded-lg font-bold text-xs shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  {testingConnection && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{testingConnection ? 'Testing...' : 'Save & Connect'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab switch */}
        <div className="px-6 pt-3 border-b border-slate-100 flex space-x-6 text-xs font-semibold bg-slate-50/50">
          <button
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`pb-3 border-b-2 transition-colors cursor-pointer ${
              mode === 'login'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Login to Account
          </button>
          <button
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`pb-3 border-b-2 transition-colors cursor-pointer ${
              mode === 'signup'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign Up New Student
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Feedback banners */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start space-x-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Quick Demo Profiles (Kept for Presentations) */}
          <div className="p-3 bg-sky-50/70 border border-sky-200/70 rounded-xl space-y-2">
            <span className="text-[11px] font-bold text-sky-900 uppercase tracking-wider block">
              Quick 1-Click Demo Profiles (For Class Presentation)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleQuickDemoJuan}
                className="p-2 bg-white hover:bg-sky-100/70 border border-sky-200 rounded-lg text-left text-xs transition-colors cursor-pointer"
              >
                <span className="font-bold text-slate-800 block">Juan Dela Cruz</span>
                <span className="text-[10px] text-slate-500 block truncate">Retail Associate (24h/wk)</span>
              </button>
              <button
                type="button"
                onClick={handleQuickDemoMaria}
                className="p-2 bg-white hover:bg-sky-100/70 border border-sky-200 rounded-lg text-left text-xs transition-colors cursor-pointer"
              >
                <span className="font-bold text-slate-800 block">Maria Santos</span>
                <span className="text-[10px] text-slate-500 block truncate">BPO Support (30h/wk)</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {mode === 'signup' && (
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Student Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password (min 6 chars)"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              {mode === 'login' && !supabaseConfig.isConfigured && (
                <p className="text-[10px] text-amber-700 mt-1">
                  💡 Note: To log into a real Supabase account, click <strong>"Configure Connection"</strong> above and provide your Supabase URL & Key.
                </p>
              )}
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Degree / Major</label>
                  <div className="relative">
                    <GraduationCap className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={degree}
                      onChange={(e) => setDegree(e.target.value)}
                      placeholder="e.g. BS Business Administration"
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Job / Employment Role</label>
                  <div className="relative">
                    <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="e.g. Retail Sales Associate (24 hrs/wk)"
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold rounded-xl shadow transition-colors mt-2 cursor-pointer flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{loadingMessage || 'Processing...'}</span>
                </>
              ) : (
                <span>
                  {mode === 'login' ? 'Log In to Study Buddy' : 'Create Student Account'}
                </span>
              )}
            </button>
          </form>

          {/* Current Account Card & Logout */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
            <div className="truncate max-w-[220px]">
              <span className="text-[10px] text-slate-400 block">Logged In As:</span>
              <span className="font-semibold text-slate-800 truncate block">
                {currentUser.fullName}
              </span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg font-semibold border border-red-200 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
