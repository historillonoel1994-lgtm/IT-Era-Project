import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Sparkles,
  HelpCircle,
  Calendar,
  CalendarDays,
  Timer,
  TrendingUp,
  Upload,
  User,
  ShieldCheck,
  ChevronRight,
  Database,
  LogIn,
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
} from './services/storage';
import {
  supabase,
  checkIsConfigured,
  ensureUserProfileAndProgress,
  DATA_UPDATED_EVENT,
  notifyDataChanged,
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
import { ResponsibleAiBanner } from './components/ResponsibleAiBanner';
import { GuestShowcaseHero } from './components/GuestShowcaseHero';
import { SupabaseDepositedVault } from './components/SupabaseDepositedVault';
import { DEFAULT_USER } from './data/mockUserData';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('summarize');
  const [lessons, setLessons] = useState<LessonDocument[]>(getStoredLessons());
  const [activeLesson, setActiveLesson] = useState<LessonDocument>(getActiveLesson());
  const [user, setUser] = useState<UserProfile>(getUserProfile());
  const [progress, setProgress] = useState<StudentProgress>(getStudentProgress());
  const [isUserLoggedIn, setIsUserLoggedIn] = useState<boolean>(isLoggedIn());

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');

  useEffect(() => {
    // Refresh lessons and active lesson on mount
    const stored = getStoredLessons();
    setLessons(stored);
    setActiveLesson(getActiveLesson());

    // If Supabase is configured, check session and sync user records
    if (checkIsConfigured()) {
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          setIsUserLoggedIn(true);
          setLoggedIn(true);
          const populatedProfile = await ensureUserProfileAndProgress(session.user);
          if (populatedProfile) {
            setUser(populatedProfile);
            saveUserProfile(populatedProfile);
          }
          await syncUserDataFromSupabase(session.user.id);
          setLessons(getStoredLessons());
          setActiveLesson(getActiveLesson());
          setProgress(getStudentProgress());
          setUser(getUserProfile());
        }
      });

      const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          setIsUserLoggedIn(true);
          setLoggedIn(true);
          const populatedProfile = await ensureUserProfileAndProgress(session.user);
          if (populatedProfile) {
            setUser(populatedProfile);
            saveUserProfile(populatedProfile);
          }
          await syncUserDataFromSupabase(session.user.id);
          setLessons(getStoredLessons());
          setActiveLesson(getActiveLesson());
          setProgress(getStudentProgress());
          setUser(getUserProfile());
        } else {
          setIsUserLoggedIn(isLoggedIn());
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
      setProgress(getStudentProgress());
      setLessons(getStoredLessons());
    };
    window.addEventListener(DATA_UPDATED_EVENT, handleRemoteUpdate);
    return () => {
      window.removeEventListener(DATA_UPDATED_EVENT, handleRemoteUpdate);
    };
  }, []);

  const handleSelectLesson = (lesson: LessonDocument) => {
    setActiveLesson(lesson);
    setActiveLessonId(lesson.id);
  };

  const handleLessonUploaded = (newLesson: LessonDocument) => {
    const updated = getStoredLessons();
    setLessons(updated);
    setActiveLesson(newLesson);
    setActiveLessonId(newLesson.id);
    setProgress(getStudentProgress());
    notifyDataChanged();
  };

  const handleUserChange = (newUser: UserProfile) => {
    setUser(newUser);
    const loggedIn = isLoggedIn();
    setIsUserLoggedIn(loggedIn);
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
  };

  const handleQuickDemoJuan = () => {
    saveUserProfile(DEFAULT_USER);
    setLoggedIn(true);
    setUser(DEFAULT_USER);
    setIsUserLoggedIn(true);
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
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
    setUser(maria);
    setIsUserLoggedIn(true);
    setLessons(getStoredLessons());
    setActiveLesson(getActiveLesson());
    setProgress(getStudentProgress());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 selection:bg-sky-200">
      {/* Navbar with tab switching, Supabase status, and profile/login button */}
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        activeLesson={activeLesson}
        lessons={lessons}
        onSelectLesson={handleSelectLesson}
        onOpenUpload={() => setIsUploadOpen(true)}
        user={user}
        onOpenAuth={() => {
          setAuthInitialMode('login');
          setIsAuthOpen(true);
        }}
        isLoggedIn={isUserLoggedIn}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* CONDITIONAL TOP SECTION:
            1. If not logged in -> Showcase Front Page explaining how to log in & browse
            2. If logged in -> Personalized Hero & Connected Supabase Vault
        */}
        {!isUserLoggedIn ? (
          <GuestShowcaseHero
            onOpenLogin={() => {
              setAuthInitialMode('login');
              setIsAuthOpen(true);
            }}
            onOpenSignup={() => {
              setAuthInitialMode('signup');
              setIsAuthOpen(true);
            }}
            onBrowseDemo={() => {
              const el = document.getElementById('feature-tabs-section');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            onQuickDemoJuan={handleQuickDemoJuan}
            onQuickDemoMaria={handleQuickDemoMaria}
          />
        ) : (
          <div className="space-y-6">
            {/* Authenticated Student Hero Dashboard */}
            <section className="bg-gradient-to-r from-sky-900 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-12 -left-12 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

              <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
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
                    Hello, {user.fullName.split(' ')[0]}! 👋
                  </h2>

                  <p className="text-xs sm:text-sm text-sky-100/90 leading-relaxed">
                    Balancing your <strong>{user.jobTitle}</strong> role with college classes? Study Buddy AI helps you understand long lesson materials faster, generates practice quizzes with exact page citations, and protects your rest time.
                  </p>

                  {/* Active Lesson indicator & Change button */}
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
                      Key ideas, definitions & takeaways with verifiable source pages.
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
                      <span className="text-xs font-black uppercase tracking-wider">3. AI Tutor Q&A</span>
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

            {/* Deposited Supabase Records & Cloud Vault */}
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
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-800">Study Buddy AI</span>
            <span>• Smart Support for Working Students</span>
            <span className="text-slate-400">• Cloud Synchronized</span>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                setAuthInitialMode('login');
                setIsAuthOpen(true);
              }}
              className="hover:text-slate-800 transition-colors cursor-pointer"
            >
              {isUserLoggedIn ? 'Student Profile & Settings' : 'Student Log In'}
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
      />
    </div>
  );
}
