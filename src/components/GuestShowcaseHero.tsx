import React, { useState } from 'react';
import {
  Sparkles,
  LogIn,
  UserPlus,
  ArrowRight,
  Database,
  Upload,
  BookOpen,
  Award,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Laptop,
  Code2,
  ChevronDown,
  ChevronUp,
  Server,
  Layers,
} from 'lucide-react';
import { checkIsConfigured, STORAGE_BUCKET } from '../lib/supabase';

interface GuestShowcaseHeroProps {
  onOpenLogin: () => void;
  onOpenSignup: () => void;
  onBrowseDemo: () => void;
  onQuickDemoJuan: () => void;
  onQuickDemoMaria: () => void;
}

export const GuestShowcaseHero: React.FC<GuestShowcaseHeroProps> = ({
  onOpenLogin,
  onOpenSignup,
  onBrowseDemo,
  onQuickDemoJuan,
  onQuickDemoMaria,
}) => {
  const [showDevDetails, setShowDevDetails] = useState(false);
  const isSupabaseReady = checkIsConfigured();

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Main Hero Banner */}
      <section className="bg-gradient-to-r from-sky-950 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden border border-sky-800/40">
        <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-sky-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl space-y-5">
          {/* Top badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-full text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Study Buddy AI • Working Student Platform</span>
            </span>

            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center space-x-1.5">
              <CheckCircle2 className="w-3 h-3" />
              <span>Cloud Sync Active</span>
            </span>
          </div>

          {/* Headline */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Smart Academic Support for Working Students
            </h1>
            <p className="text-sm sm:text-base text-sky-100/90 leading-relaxed max-w-3xl">
              Balancing job shifts and college courses? Study Buddy AI summarizes lengthy lesson PDFs, Word docs, PowerPoint decks, and data sheets with verified page citations, generates custom practice quizzes, and keeps your study library and progress saved securely across your devices.
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenLogin}
              className="px-6 py-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition-all flex items-center space-x-2 cursor-pointer transform hover:-translate-y-0.5"
            >
              <LogIn className="w-4 h-4 text-slate-950" />
              <span>Log In to Your Account</span>
            </button>

            <button
              onClick={onOpenSignup}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-sm rounded-xl border border-white/20 transition-all flex items-center space-x-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4 text-sky-300" />
              <span>Sign Up New Student</span>
            </button>

            <button
              onClick={onBrowseDemo}
              className="px-5 py-3 text-sky-200 hover:text-white font-semibold text-sm flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <span>Explore Sample Lessons</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* 1-Click Quick Demo Profiles for Class Presentation */}
          <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
            <span className="text-sky-300/80 font-medium">Quick 1-Click Demo Profiles (For Instant Preview):</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={onQuickDemoJuan}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-white font-semibold transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <span>Juan Dela Cruz</span>
                <span className="text-[10px] text-sky-300 font-normal">(Retail Associate)</span>
              </button>
              <button
                onClick={onQuickDemoMaria}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-white font-semibold transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <span>Maria Santos</span>
                <span className="text-[10px] text-sky-300 font-normal">(BPO Support)</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-100">
              How It Works • Study Workflow
            </span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
              How to Sign In & Browse Your Study Library
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Follow these simple steps to summarize your course materials, take quizzes, and track your progress.
            </p>
          </div>

          <button
            onClick={() => setShowDevDetails(!showDevDetails)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors flex items-center space-x-1.5 cursor-pointer self-start md:self-auto"
          >
            <Code2 className="w-3.5 h-3.5 text-slate-500" />
            <span>{showDevDetails ? 'Hide Dev Details' : 'Developer Architecture'}</span>
            {showDevDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* 4 Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Step 1 */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-5 space-y-3 relative group hover:border-sky-300 transition-all">
            <div className="w-8 h-8 rounded-xl bg-sky-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              1
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Sign In / Register</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Create your student profile or log in. Your degree program and work schedule customize your daily review schedule.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 text-[11px] text-sky-700 font-semibold flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Personalized profile</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-5 space-y-3 relative group hover:border-sky-300 transition-all">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              2
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Upload Course Material</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Upload your lecture slides (PPTX), textbook chapters (PDF), assignments (DOCX), or sheets (CSV) to study on any device.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 text-[11px] text-indigo-700 font-semibold flex items-center space-x-1">
              <Upload className="w-3.5 h-3.5" />
              <span>Study library storage</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-5 space-y-3 relative group hover:border-sky-300 transition-all">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              3
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Practice Quizzes</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                AI generates questions grounded in your lesson text with page citations, saving your score and mastery history.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 text-[11px] text-emerald-700 font-semibold flex items-center space-x-1">
              <Award className="w-3.5 h-3.5" />
              <span>Verifiable citations</span>
            </div>
          </div>

          {/* Step 4 */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-5 space-y-3 relative group hover:border-sky-300 transition-all">
            <div className="w-8 h-8 rounded-xl bg-amber-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              4
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Track Progress</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Track study time, completed topics, and quiz accuracy over time to keep your academic momentum strong.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/60 text-[11px] text-amber-700 font-semibold flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Real-time analytics</span>
            </div>
          </div>
        </div>

        {/* Developer Architecture Details (Collapsible) */}
        {showDevDetails && (
          <div className="p-5 bg-slate-900 text-slate-200 rounded-2xl border border-slate-800 space-y-3 font-mono text-xs animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5" />
                <span>Developer Specification • Cloud Storage & Database Architecture</span>
              </span>
              <span className="text-[10px] text-slate-400">
                Backend: Supabase
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
              <div className="p-3 bg-slate-800/70 rounded-xl space-y-1">
                <span className="text-sky-300 font-bold block">1. Authentication</span>
                <p className="text-slate-400">
                  Calls <code className="text-slate-200">supabase.auth.signUp()</code> and <code className="text-slate-200">signInWithPassword()</code>. User profile records are stored in table <code className="text-amber-300">profiles</code>.
                </p>
              </div>

              <div className="p-3 bg-slate-800/70 rounded-xl space-y-1">
                <span className="text-indigo-300 font-bold block">2. File Storage Bucket</span>
                <p className="text-slate-400">
                  PDFs are uploaded to bucket <code className="text-emerald-300">{STORAGE_BUCKET}</code> under <code className="text-slate-200">USER-ID/filename.pdf</code> and indexed in <code className="text-amber-300">learning_materials</code>.
                </p>
              </div>

              <div className="p-3 bg-slate-800/70 rounded-xl space-y-1">
                <span className="text-emerald-300 font-bold block">3. Quiz Attempts</span>
                <p className="text-slate-400">
                  Scores, total question counts, and percentages are saved in table <code className="text-amber-300">quiz_attempts</code>.
                </p>
              </div>

              <div className="p-3 bg-slate-800/70 rounded-xl space-y-1">
                <span className="text-amber-300 font-bold block">4. Study Progress</span>
                <p className="text-slate-400">
                  Study minutes and accuracy metrics are synced in table <code className="text-amber-300">study_progress</code>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Feature exploration callout */}
        <div className="p-4 bg-sky-50/70 border border-sky-200/70 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-sky-600 text-white rounded-xl shadow-xs">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">
                Ready to try out the app right now?
              </h4>
              <p className="text-[11px] sm:text-xs text-slate-600">
                You can browse sample lessons below, or log in to access your personal study library.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={onOpenLogin}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Log In to Account
            </button>
            <button
              onClick={onBrowseDemo}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-300 transition-colors cursor-pointer"
            >
              Browse as Guest
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
