import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Sparkles,
  HelpCircle,
  ShieldCheck,
  Compass,
  UserPlus,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import {
  LessonDocument,
  UserProfile,
  StudentProgress,
} from './types';
import {
  getActiveLesson,
  getStoredLessons,
  setActiveLessonId,
  getUserProfile,
  getStudentProgress,
  syncUserDataFromSupabase,
  isLoggedIn,
  setLoggedIn,
  saveUserProfile,
  loadAndReconstructLesson,
  isPlaceholderContent,
  resetUserScopedLocalData,
  setDemoModeActive,
  isDemoModeActive,
  setTutorialCompleted,
} from './services/storage';
import { setApiDemoMode } from './services/api';
import {
  supabase,
  checkIsConfigured,
  ensureUserProfileAndProgress,
  DATA_UPDATED_EVENT,
  notifyDataChanged,
  verifyUserRoleWithServer,
  clearAdminMfaToken,
} from './lib/supabase';
import { Navbar, NavTab } from './components/Navbar';
import { SummarizeLessonView } from './components/SummarizeLessonView';
import { GenerateQuizView } from './components/GenerateQuizView';
import { AskStudyBuddyView } from './components/AskStudyBuddyView';
import { WorkStudyPlannerView } from './components/WorkStudyPlannerView';
import { TodaysPlanView } from './components/TodaysPlanView';
import { FocusTimerView } from './components/FocusTimerView';
import { MyProgressView } from './components/MyProgressView';
import { UploadLessonModal } from './components/UploadLessonModal';
import { AuthModal } from './components/AuthModal';
import { MyAccountModal } from './components/MyAccountModal';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import { ResponsibleAiBanner } from './components/ResponsibleAiBanner';
import { GuestShowcaseHero } from './components/GuestShowcaseHero';
import { SupabaseDepositedVault } from './components/SupabaseDepositedVault';
import { StudyBuddyLogo } from './components/StudyBuddyLogo';
import { UserTutorial } from './components/UserTutorial';
import { DEFAULT_USER, DEMO_VISITOR_PROFILE } from './data/mockUserData';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('summarize');
  const [lessons, setLessons] = useState<LessonDocument[]>(getStoredLessons());
  const [activeLesson, setActiveLesson] = useState<LessonDocument>(getActiveLesson());
  const [user, setUser] = useState<UserProfile>(getUserProfile());
  const [progress, setProgress] = useState<StudentProgress>(getStudentProgress());
  const [isUserLoggedIn, setIsUserLoggedIn] = useState<boolean>(isLoggedIn());
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  // Modals & Tutorial
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup' | 'admin_login'>('login');
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountModalSection, setAccountModalSection] = useState<'personal' | 'security' | 'learning'>('personal');
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  // Security guard: block direct URL/hash navigation attempts to admin routes when unauthorized
  useEffect(() => {
    const checkRouteGuard = () => {
      const pathLower = (window.location.pathname || '').toLowerCase();
      const hashLower = (window.location.hash || '').toLowerCase();
      if (pathLower.includes('/admin') || hashLower.includes('admin')) {
        const isAuthorizedAdmin =
          isUserLoggedIn &&
          !isDemoMode &&
          (user.role === 'admin' || user.role === 'super_admin');
        if (!isAuthorizedAdmin) {
          setIsAdminDashboardOpen(false);
          if (hashLower.includes('admin')) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }
      }
    };
    checkRouteGuard();
    window.addEventListener('hashchange', checkRouteGuard);
    return () => window.removeEventListener('hashchange', checkRouteGuard);
  }, [isUserLoggedIn, isDemoMode, user.role]);

  useEffect(() => {
    // Refresh lessons and active lesson on mount
    const stored = getStoredLessons();
    setLessons(stored);
    setActiveLesson(getActiveLesson());

    // If Supabase is configured, check session and sync user records
    if (checkIsConfigured()) {
      const syncAuthenticatedSession = async (sessionUser: any) => {
        // Exit Demo Mode cleanly whenever a real authenticated session begins
        setDemoModeActive(false);
        setApiDemoMode(false);
        setIsDemoMode(false);

        resetUserScopedLocalData(sessionUser.id);
        setIsUserLoggedIn(true);
        setLoggedIn(true);
        let populatedProfile = await ensureUserProfileAndProgress(sessionUser);
        if (sessionUser.email) {
          try {
            const roleRes = await verifyUserRoleWithServer({
              email: sessionUser.email,
              userId: sessionUser.id,
              fullName: populatedProfile?.fullName,
            });
            if (roleRes?.role && populatedProfile) {
              populatedProfile = { ...populatedProfile, role: roleRes.role };
            }
          } catch (e) {
            console.warn('Role verification notice:', e);
          }
        }
        if (populatedProfile) {
          setUser(populatedProfile);
          saveUserProfile(populatedProfile);
        }
        await syncUserDataFromSupabase(sessionUser.id);
        const syncedLessons = getStoredLessons();
        setLessons(syncedLessons);
        const currentActive = getActiveLesson();
        setActiveLesson(currentActive);
        setProgress(getStudentProgress());
        setUser(getUserProfile());

        if (isPlaceholderContent(currentActive.pages) || currentActive.processingStatus !== 'ready') {
          loadAndReconstructLesson(currentActive.id)
            .then((full) => {
              setActiveLesson(full);
              setLessons(getStoredLessons());
            })
            .catch(() => {});
        }
      };

      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          await syncAuthenticatedSession(session.user);
        } else {
          // Ensure stale cached local login flag cannot masquerade as an active admin session
          const storedProfile = getUserProfile();
          if (storedProfile.role === 'admin' || storedProfile.role === 'super_admin') {
            clearAdminMfaToken();
            resetUserScopedLocalData();
            setLoggedIn(false);
            setIsUserLoggedIn(false);
            setUser(DEFAULT_USER);
          }
        }
      });

      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          await syncAuthenticatedSession(session.user);
        } else {
          if (event === 'SIGNED_OUT') {
            clearAdminMfaToken();
            resetUserScopedLocalData();
            setLoggedIn(false);
            setIsUserLoggedIn(false);
            setIsAdminDashboardOpen(false);
            setUser(DEFAULT_USER);
            setLessons(getStoredLessons());
            setActiveLesson(getActiveLesson());
            setProgress(getStudentProgress());
          } else {
            setIsUserLoggedIn(isLoggedIn());
          }
        }
      });

      return () => {
        authListener?.subscription.unsubscribe();
      };
    }
  }, []);

  // Listen to remote Supabase data changes across the app
  useEffect(() => {
    const handleRemoteUpdate = () => {
      if (isDemoModeActive()) return;
      setProgress(getStudentProgress());
      setLessons(getStoredLessons());
    };
    window.addEventListener(DATA_UPDATED_EVENT, handleRemoteUpdate);
    return () => {
      window.removeEventListener(DATA_UPDATED_EVENT, handleRemoteUpdate);
    };
  }, []);

  // Ensure active lesson has full extracted content on initial load
  useEffect(() => {
    const current = getActiveLesson();
    if (isPlaceholderContent(current.pages) || current.processingStatus !== 'ready') {
      loadAndReconstructLesson(current.id)
        .then((full) => {
          setActiveLesson(full);
          setLessons(getStoredLessons());
        })
        .catch(() => {});
    }
  }, []);

  const handleSelectLesson = async (lesson: LessonDocument) => {
    setActiveLesson(lesson);
    setActiveLessonId(lesson.id);

    // Retrieve and reconstruct complete document content from backend/database/storage
    // Ensures selecting an existing saved document provides the same level of understanding
    // as selecting it immediately after its original upload
    if (isPlaceholderContent(lesson.pages) || lesson.processingStatus !== 'ready') {
      try {
        const fullDoc = await loadAndReconstructLesson(lesson.id);
        setActiveLesson(fullDoc);
        setLessons(getStoredLessons());
      } catch (err) {
        console.warn('Lesson reconstruction note:', err);
      }
    }
  };

  const handleLessonUploaded = (newLesson: LessonDocument) => {
    const updated = getStoredLessons();
    setLessons(updated);
    setActiveLesson(newLesson);
    setActiveLessonId(newLesson.id);
    setProgress(getStudentProgress());
    if (!isDemoMode) {
      notifyDataChanged();
    }
  };

  const handleUserChange = (newUser: UserProfile) => {
    // Switching to an authenticated user automatically leaves Demo Mode
    if (isDemoMode) {
      setDemoModeActive(false);
      setApiDemoMode(false);
      setIsDemoMode(false);
    }
    setUser(newUser);
    const loggedIn = isLoggedIn();
    setIsUserLoggedIn(loggedIn);
    if (!loggedIn || (newUser.role !== 'admin' && newUser.role !== 'super_admin')) {
      setIsAdminDashboardOpen(false);
    }
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
  };

  // Safe Sample Demo Mode: Isolated, non-persistent, sample data only — never logs into any real account
  const handleEnterDemoMode = () => {
    setDemoModeActive(true);
    setApiDemoMode(true);
    setIsDemoMode(true);
    setIsUserLoggedIn(false);
    setIsAdminDashboardOpen(false);
    setIsAccountModalOpen(false);
    setUser(DEMO_VISITOR_PROFILE);
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
    setCurrentTab('summarize');
    setTimeout(() => {
      const el = document.getElementById('demo-mode-banner');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleExitDemoMode = () => {
    setDemoModeActive(false);
    setApiDemoMode(false);
    setIsDemoMode(false);
    setUser(DEFAULT_USER);
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
  };

  const handleOpenSignupFromDemo = () => {
    handleExitDemoMode();
    setAuthInitialMode('signup');
    setIsAuthOpen(true);
  };

  const handleOpenAdminDashboardSafely = () => {
    if (isUserLoggedIn && !isDemoMode && (user.role === 'admin' || user.role === 'super_admin')) {
      setIsAdminDashboardOpen(true);
    }
  };

  const handleOpenAccountModalSafely = () => {
    if (isUserLoggedIn && !isDemoMode) {
      setAccountModalSection('personal');
      setIsAccountModalOpen(true);
    }
  };

  const handleTutorialComplete = () => {
    // Persist tutorial completion ONLY for registered authenticated users (never in Demo Mode)
    if (isUserLoggedIn && !isDemoMode && user.id && user.id !== 'demo-visitor-session') {
      setTutorialCompleted(user.id, true);
    }
  };

  const canRenderAdminDashboard =
    isAdminDashboardOpen &&
    isUserLoggedIn &&
    !isDemoMode &&
    (user.role === 'admin' || user.role === 'super_admin');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 selection:bg-sky-200">
      {/* Navbar with official logo, tab switching, Help & Tutorial, and profile/login controls */}
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        activeLesson={activeLesson}
        lessons={lessons}
        onSelectLesson={handleSelectLesson}
        onOpenUpload={() => setIsUploadOpen(true)}
        user={user}
        onOpenAuth={() => {
          if (isDemoMode) handleExitDemoMode();
          setAuthInitialMode('login');
          setIsAuthOpen(true);
        }}
        onOpenSignup={handleOpenSignupFromDemo}
        isLoggedIn={isUserLoggedIn}
        isDemoMode={isDemoMode}
        onExitDemo={handleExitDemoMode}
        onOpenAdminDashboard={handleOpenAdminDashboardSafely}
        onOpenAccountModal={handleOpenAccountModalSafely}
        onOpenTutorial={() => setIsTutorialOpen(true)}
      />

      {/* Visible Persistent Demo Mode Banner */}
      {isDemoMode && (
        <div
          id="demo-mode-banner"
          className="bg-amber-50 border-b-2 border-amber-300 shadow-2xs"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center space-x-3">
              <div className="p-2 bg-amber-400/25 border border-amber-400 rounded-xl shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-800" />
              </div>
              <div className="text-xs sm:text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-amber-950 tracking-wide uppercase">
                    DEMO MODE — Sample Data Only
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900">
                    Temporary Session • Changes Not Saved
                  </span>
                </div>
                <p className="text-xs text-amber-900/90 mt-0.5">
                  You are exploring Study Buddy AI with fictional sample lessons, quizzes, and metrics. Administrative areas and account settings are locked.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleOpenSignupFromDemo}
                className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create an Account to Save Your Progress</span>
              </button>

              <button
                type="button"
                onClick={() => setIsTutorialOpen(true)}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Start Tutorial</span>
              </button>

              <button
                type="button"
                onClick={handleExitDemoMode}
                className="px-3 py-2 bg-white hover:bg-amber-100 text-amber-950 font-semibold text-xs rounded-xl border border-amber-300 transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Exit Demo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* CONDITIONAL TOP SECTION:
            1. Guest Landing (neither logged in nor in Demo Mode) -> GuestShowcaseHero
            2. Demo Mode -> Isolated Sample Dashboard Header
            3. Authenticated User -> Personalized Hero & Connected Supabase Vault
        */}
        {!isUserLoggedIn && !isDemoMode ? (
          <GuestShowcaseHero
            onOpenLogin={() => {
              setAuthInitialMode('login');
              setIsAuthOpen(true);
            }}
            onOpenSignup={() => {
              setAuthInitialMode('signup');
              setIsAuthOpen(true);
            }}
            onStartDemo={handleEnterDemoMode}
            onStartTutorial={() => setIsTutorialOpen(true)}
          />
        ) : isDemoMode ? (
          <section
            data-tutorial-target="dashboard-overview"
            className="bg-gradient-to-r from-sky-900 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden"
          >
            <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-start space-x-4 max-w-2xl">
                <StudyBuddyLogo size="md" className="ring-2 ring-white/25 hidden sm:flex" />
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 bg-amber-400/20 text-amber-200 border border-amber-400/40 rounded-full text-xs font-extrabold uppercase tracking-wider flex items-center space-x-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Demo Mode — Sample Data Only</span>
                    </span>
                  </div>

                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                    Explore Study Buddy AI
                  </h2>

                  <p className="text-xs sm:text-sm text-sky-100/90 leading-relaxed">
                    Try summarizing sample chapters, taking citation-backed practice quizzes, asking the AI Tutor, and testing the Focus Timer. Sign up anytime to upload and save your own school materials.
                  </p>

                  <div className="pt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-sky-200/70">Sample Lesson:</span>
                    <span className="font-bold text-white bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 truncate max-w-xs">
                      {activeLesson.title} ({activeLesson.totalPages} Pages)
                    </span>
                    <button
                      onClick={() => setIsTutorialOpen(true)}
                      className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 rounded-lg font-bold transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>Start Tutorial</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Sample Metrics Badge */}
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 shrink-0 grid grid-cols-2 gap-4 text-center lg:w-72">
                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-white">{progress.averageQuizScore}%</span>
                  <span className="text-[11px] text-sky-200 block font-medium">Sample Quiz Avg</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-white">
                    {(progress.totalStudyMinutes / 60).toFixed(1)}h
                  </span>
                  <span className="text-[11px] text-sky-200 block font-medium">Sample Study Time</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-emerald-300">{progress.tasksCompleted}</span>
                  <span className="text-[11px] text-sky-200 block font-medium">Sample Tasks</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-2xl font-black text-amber-300">
                    {progress.verifiedCitationsCount || 12}
                  </span>
                  <span className="text-[11px] text-sky-200 block font-medium">Verified Pages</span>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {/* Authenticated Student Hero Dashboard */}
            <section
              data-tutorial-target="dashboard-overview"
              className="bg-gradient-to-r from-sky-900 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden"
            >
              <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -left-12 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="flex items-start space-x-4 max-w-2xl">
                  <StudyBuddyLogo size="md" className="ring-2 ring-white/25 hidden sm:flex" />
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-full text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Authenticated Student Portal</span>
                      </span>
                      <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-semibold flex items-center space-x-1">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Account Synchronized</span>
                      </span>
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                      Hello, {user.fullName.split(' ')[0]}!
                    </h2>

                    <p className="text-xs sm:text-sm text-sky-100/90 leading-relaxed">
                      Balancing your <strong>{user.jobTitle}</strong> role with college classes? Study Buddy AI helps you understand long lesson materials faster, generates practice quizzes with exact page citations, and protects your rest time.
                    </p>

                    {/* Active Lesson indicator & Action buttons */}
                    <div className="pt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-sky-200/70">Current Lesson:</span>
                      <span className="font-bold text-white bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 truncate max-w-xs">
                        {activeLesson.title} ({activeLesson.totalPages} {activeLesson.fileType === 'pptx' || activeLesson.fileType === 'ppt' ? 'Slides' : 'Pages'})
                      </span>
                      <button
                        onClick={() => setIsUploadOpen(true)}
                        className="text-sky-300 hover:text-white font-semibold underline cursor-pointer ml-1"
                      >
                        Upload New Material
                      </button>
                      <button
                        onClick={() => setIsTutorialOpen(true)}
                        className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 rounded-lg font-bold transition-colors cursor-pointer flex items-center space-x-1 ml-1"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Start Tutorial</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Metrics Badge */}
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/15 shrink-0 grid grid-cols-2 gap-4 text-center lg:w-72">
                  <div className="space-y-0.5">
                    <span className="text-2xl font-black text-white">{progress.averageQuizScore}%</span>
                    <span className="text-[11px] text-sky-200 block font-medium">Avg Quiz Score</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-2xl font-black text-white">
                      {(progress.totalStudyMinutes / 60).toFixed(1)}h
                    </span>
                    <span className="text-[11px] text-sky-200 block font-medium">Study Tracked</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-2xl font-black text-emerald-300">{progress.tasksCompleted}</span>
                    <span className="text-[11px] text-sky-200 block font-medium">Tasks Done</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-2xl font-black text-amber-300">
                      {progress.verifiedCitationsCount || 12}
                    </span>
                    <span className="text-[11px] text-sky-200 block font-medium">Verified Pages</span>
                  </div>
                </div>
              </div>

              {/* Three Main Learning Features Quick-Launch Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-6 border-t border-white/10 mt-6">
                {/* Feature 1 */}
                <button
                  onClick={() => setCurrentTab('summarize')}
                  className={`p-3.5 rounded-2xl text-left transition-all border cursor-pointer flex items-start space-x-3 ${
                    currentTab === 'summarize'
                      ? 'bg-white text-slate-900 border-white shadow-md'
                      : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      currentTab === 'summarize' ? 'bg-sky-100 text-sky-800' : 'bg-white/10 text-sky-300'
                    }`}
                  >
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-black uppercase tracking-wider">1. Summarize Lesson</span>
                      <span className="text-[10px] font-bold text-sky-500 bg-sky-100 px-1 rounded">Primary</span>
                    </div>
                    <p
                      className={`text-xs leading-snug ${
                        currentTab === 'summarize' ? 'text-slate-600' : 'text-sky-200/80'
                      }`}
                    >
                      Key ideas, definitions &amp; takeaways with verifiable source pages.
                    </p>
                  </div>
                </button>

                {/* Feature 2 */}
                <button
                  onClick={() => setCurrentTab('quiz')}
                  className={`p-3.5 rounded-2xl text-left transition-all border cursor-pointer flex items-start space-x-3 ${
                    currentTab === 'quiz'
                      ? 'bg-white text-slate-900 border-white shadow-md'
                      : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      currentTab === 'quiz' ? 'bg-indigo-100 text-indigo-800' : 'bg-white/10 text-indigo-300'
                    }`}
                  >
                    <HelpCircle className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-black uppercase tracking-wider">2. Generate Quiz</span>
                      <span className="text-[10px] font-bold text-indigo-500 bg-indigo-100 px-1 rounded">Practice</span>
                    </div>
                    <p
                      className={`text-xs leading-snug ${
                        currentTab === 'quiz' ? 'text-slate-600' : 'text-sky-200/80'
                      }`}
                    >
                      Instant practice questions with page citations and explanation feedback.
                    </p>
                  </div>
                </button>

                {/* Feature 3 */}
                <button
                  onClick={() => setCurrentTab('tutor')}
                  className={`p-3.5 rounded-2xl text-left transition-all border cursor-pointer flex items-start space-x-3 ${
                    currentTab === 'tutor'
                      ? 'bg-white text-slate-900 border-white shadow-md'
                      : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      currentTab === 'tutor' ? 'bg-sky-100 text-sky-800' : 'bg-white/10 text-sky-300'
                    }`}
                  >
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-black uppercase tracking-wider">3. AI Tutor Q&amp;A</span>
                      <span className="text-[10px] font-bold text-emerald-500 bg-emerald-100 px-1 rounded">24/7</span>
                    </div>
                    <p
                      className={`text-xs leading-snug ${
                        currentTab === 'tutor' ? 'text-slate-600' : 'text-sky-200/80'
                      }`}
                    >
                      Ask questions grounded strictly in your lesson document pages.
                    </p>
                  </div>
                </button>
              </div>
            </section>

            {/* Deposited Supabase Records & Cloud Vault (Authenticated Registered Accounts Only) */}
            <SupabaseDepositedVault
              user={user}
              lessons={lessons}
              progress={progress}
              onOpenUpload={() => setIsUploadOpen(true)}
              onSelectLesson={handleSelectLesson}
              onTakeQuiz={() => setCurrentTab('quiz')}
              onDataRefreshed={() => {
                setLessons(getStoredLessons());
                setProgress(getStudentProgress());
              }}
            />
          </div>
        )}

        {/* Responsible AI Verification Bar */}
        <ResponsibleAiBanner />

        {/* Feature Tabs Content Anchor */}
        <div id="feature-tabs-section">
          {/* Active Tab View */}
          {currentTab === 'summarize' && (
            <SummarizeLessonView
              lesson={activeLesson}
              onOpenUpload={() => setIsUploadOpen(true)}
              onNavigateToQuiz={() => setCurrentTab('quiz')}
              onNavigateToTutor={() => setCurrentTab('tutor')}
            />
          )}

          {currentTab === 'quiz' && (
            <GenerateQuizView
              lesson={activeLesson}
              lessons={lessons}
              onSelectLesson={handleSelectLesson}
              onOpenUpload={() => setIsUploadOpen(true)}
              onNavigateToSummary={() => setCurrentTab('summarize')}
              onNavigateToProgress={() => setCurrentTab('progress')}
            />
          )}

          {currentTab === 'tutor' && (
            <AskStudyBuddyView
              lesson={activeLesson}
              onOpenUpload={() => setIsUploadOpen(true)}
              onNavigateToSummary={() => setCurrentTab('summarize')}
            />
          )}

          {currentTab === 'planner' && (
            <WorkStudyPlannerView
              onNavigateToTodayPlan={() => setCurrentTab('today')}
            />
          )}

          {currentTab === 'today' && (
            <TodaysPlanView
              onNavigateToTimer={() => setCurrentTab('timer')}
              onNavigateToQuiz={() => setCurrentTab('quiz')}
              onNavigateToSummary={() => setCurrentTab('summarize')}
            />
          )}

          {currentTab === 'timer' && (
            <FocusTimerView
              onNavigateToProgress={() => setCurrentTab('progress')}
              onNavigateToQuiz={() => setCurrentTab('quiz')}
            />
          )}

          {currentTab === 'progress' && (
            <MyProgressView
              onNavigateToQuiz={() => setCurrentTab('quiz')}
              onNavigateToSummary={() => setCurrentTab('summarize')}
              onNavigateToTimer={() => setCurrentTab('timer')}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/80 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center space-x-2.5">
            <StudyBuddyLogo size="xs" />
            <span className="font-semibold text-slate-800">Study Buddy AI</span>
            <span>• Smart Support for Working Students</span>
            <span className="text-slate-400">
              {isDemoMode ? '• Demo Mode (Sample Data)' : '• Cloud Synchronized'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsTutorialOpen(true)}
              className="hover:text-slate-800 transition-colors cursor-pointer font-semibold text-emerald-700"
            >
              Help &amp; Tutorial
            </button>
            <span>•</span>
            <button
              onClick={() => {
                if (isDemoMode) handleExitDemoMode();
                setAuthInitialMode('login');
                setIsAuthOpen(true);
              }}
              className="hover:text-slate-800 transition-colors cursor-pointer"
            >
              {isUserLoggedIn && !isDemoMode ? 'Student Profile & Settings' : 'Student Log In'}
            </button>
            <span>•</span>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="hover:text-slate-800 transition-colors cursor-pointer"
            >
              Upload Material
            </button>
            <span>•</span>
            <span>Source Grounded • Zero Hallucination Citations</span>
          </div>
        </div>
      </footer>

      {/* Interactive 9-Step User Tutorial */}
      <UserTutorial
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        onComplete={handleTutorialComplete}
        onNavigateTab={setCurrentTab}
        isDemoMode={isDemoMode}
        isRegisteredUser={isUserLoggedIn && !isDemoMode}
      />

      {/* Upload Material Modal */}
      <UploadLessonModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onLessonUploaded={handleLessonUploaded}
      />

      {/* Account / Auth Modal with Supabase Integration */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        currentUser={user}
        onUserChange={handleUserChange}
        initialMode={authInitialMode}
        onOpenAdminDashboard={handleOpenAdminDashboardSafely}
      />

      {/* Personal Account Settings & Profile Modal (Registered Users Only) */}
      {isUserLoggedIn && !isDemoMode && (
        <MyAccountModal
          isOpen={isAccountModalOpen}
          onClose={() => setIsAccountModalOpen(false)}
          currentUser={user}
          onUserChange={handleUserChange}
          onNavigateToProgress={() => {
            setIsAccountModalOpen(false);
            setCurrentTab('progress');
          }}
          initialSection={accountModalSection}
        />
      )}

      {/* Administrator Security & Control Center Dashboard (Strictly Gated) */}
      {canRenderAdminDashboard && (
        <AdminDashboardModal
          isOpen={canRenderAdminDashboard}
          onClose={() => setIsAdminDashboardOpen(false)}
          currentUser={user}
        />
      )}
    </div>
  );
}

