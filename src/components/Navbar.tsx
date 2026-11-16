import React, { useState } from 'react';
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
  ChevronDown,
  Shield,
  ShieldCheck,
  Database,
  LogIn,
  Settings,
} from 'lucide-react';
import { LessonDocument, UserProfile } from '../types';
import { checkIsConfigured } from '../lib/supabase';

export type NavTab =
  | 'summarize'
  | 'quiz'
  | 'tutor'
  | 'planner'
  | 'today'
  | 'timer'
  | 'progress';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeLesson: LessonDocument;
  lessons: LessonDocument[];
  onSelectLesson: (lesson: LessonDocument) => void;
  onOpenUpload: () => void;
  user: UserProfile;
  onOpenAuth: () => void;
  isLoggedIn?: boolean;
  onOpenAdminDashboard?: () => void;
  onOpenAccountModal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  activeLesson,
  lessons,
  onSelectLesson,
  onOpenUpload,
  user,
  onOpenAuth,
  isLoggedIn = false,
  onOpenAdminDashboard,
  onOpenAccountModal,
}) => {
  const [showLessonDropdown, setShowLessonDropdown] = React.useState(false);
  const [showAllLessons, setShowAllLessons] = React.useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const isSuperAdmin = user.role === 'super_admin';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
      {/* Main Nav Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Logo and Brand */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-600 via-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-sm">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg text-slate-900 tracking-tight">
              Study Buddy <span className="text-sky-600">AI</span>
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">
              Smart Support for Working Students
            </p>
          </div>
        </div>

        {/* Active Lesson Selector & Upload button */}
        <div className="hidden lg:flex items-center space-x-2">
          <div className="relative">
            <button
              onClick={() => setShowLessonDropdown(!showLessonDropdown)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 flex items-center space-x-2 transition-all max-w-[280px]"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{activeLesson.title}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </button>

            {showLessonDropdown && (
              <div className="absolute left-0 mt-1.5 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 animate-fadeIn">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {lessons.length > 4 && !showAllLessons
                      ? `Select Active Lesson (4 of ${lessons.length})`
                      : `Select Active Lesson (${lessons.length})`}
                  </span>
                  {lessons.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAllLessons((prev) => !prev)}
                      className="text-[10px] font-bold text-sky-700 hover:text-sky-900 cursor-pointer"
                    >
                      {showAllLessons ? 'Show 4' : 'Open All'}
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {(showAllLessons ? lessons : lessons.slice(0, 4)).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        onSelectLesson(l);
                        setShowLessonDropdown(false);
                      }}
                      className={`w-full p-2 rounded-xl text-left text-xs transition-colors flex items-center justify-between ${
                        l.id === activeLesson.id
                          ? 'bg-sky-50 text-sky-900 font-bold border border-sky-200'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="truncate mr-2">
                        <span className="block truncate">{l.title}</span>
                        <span className="text-[10px] text-slate-400 block font-normal truncate">
                          {l.subject} • {l.totalPages} pages
                        </span>
                      </div>
                      {l.id === activeLesson.id && (
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-600 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="pt-2 mt-2 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setShowLessonDropdown(false);
                      onOpenUpload();
                    }}
                    className="w-full py-1.5 text-center text-xs font-bold text-sky-700 hover:bg-sky-50 rounded-lg flex items-center justify-center space-x-1"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload New Lesson PDF</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onOpenUpload}
            className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Upload or change PDF"
          >
            <Upload className="w-4 h-4" />
            <span>Upload PDF</span>
          </button>
        </div>

        {/* User Account / Profile / Administrator Portal */}
        <div className="flex items-center space-x-2 relative">
          {isLoggedIn ? (
            <div className="flex items-center space-x-2">
              {/* Administrator Portal Quick Launch Button */}
              {isAdmin && (
                <button
                  onClick={onOpenAdminDashboard}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer border ${
                    isSuperAdmin
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 border-amber-400'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500'
                  }`}
                  title="Open Administrator Dashboard & Control Center"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">
                    {isSuperAdmin ? 'Super Admin Portal' : 'Admin Portal'}
                  </span>
                  <span className="sm:hidden">Admin</span>
                </button>
              )}

              {/* Profile button */}
              <div className="relative">
                <button
                  onClick={() => setShowUserDropdown(!showUserDropdown)}
                  className="flex items-center space-x-2 p-1.5 pl-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 transition-colors cursor-pointer"
                  title="View profile & account menu"
                >
                  <div className="text-right hidden sm:block">
                    <span className="font-bold text-slate-900 block leading-tight truncate max-w-[130px]">
                      {user.fullName}
                    </span>
                    <span className="text-[10px] block leading-tight flex items-center justify-end space-x-1">
                      {isSuperAdmin ? (
                        <span className="text-amber-700 font-bold">★ Super Admin</span>
                      ) : isAdmin ? (
                        <span className="text-indigo-700 font-bold">🛡️ Administrator</span>
                      ) : (
                        <span className="text-slate-500">Student Account</span>
                      )}
                    </span>
                  </div>
                  <div
                    className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shadow-xs text-white ${
                      isSuperAdmin ? 'bg-amber-600' : isAdmin ? 'bg-indigo-600' : 'bg-sky-600'
                    }`}
                  >
                    {user.fullName[0]?.toUpperCase() || 'U'}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Dropdown Menu */}
                {showUserDropdown && (
                  <div
                    className="absolute right-0 mt-1.5 w-60 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 text-xs"
                    onClick={() => setShowUserDropdown(false)}
                  >
                    <div className="px-3.5 py-2 border-b border-slate-100">
                      <div className="font-bold text-slate-900 truncate">{user.fullName}</div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">{user.email}</div>
                      <div className="mt-1">
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center space-x-1 ${
                            isSuperAdmin
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : isAdmin
                              ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                              : 'bg-sky-100 text-sky-800 border border-sky-200'
                          }`}
                        >
                          <Shield className="w-2.5 h-2.5" />
                          <span>
                            {isSuperAdmin
                              ? 'Super Administrator'
                              : isAdmin
                              ? 'Administrator'
                              : 'Student Account'}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => {
                          if (onOpenAccountModal) onOpenAccountModal();
                          else onOpenAuth();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-slate-700 font-medium flex items-center space-x-2 cursor-pointer"
                      >
                        <User className="w-4 h-4 text-sky-600" />
                        <span>My Account & Personal Profile</span>
                      </button>

                      {isAdmin && onOpenAdminDashboard && (
                        <button
                          onClick={onOpenAdminDashboard}
                          className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 text-indigo-900 font-bold flex items-center space-x-2 cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4 text-indigo-600" />
                          <span>Administrator Security Center</span>
                        </button>
                      )}

                      <button
                        onClick={onOpenAuth}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-slate-700 font-medium flex items-center space-x-2 cursor-pointer"
                      >
                        <LogIn className="w-4 h-4 text-slate-500" />
                        <span>Switch User / Manage Sessions</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Log In / Sign Up</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex space-x-1 overflow-x-auto no-scrollbar border-t border-slate-100 pt-1">
        {/* Main 3 Learning Features */}
        <button
          onClick={() => onTabChange('summarize')}
          className={`px-3.5 py-2.5 text-xs font-bold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'summarize'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>1. Summarize Lesson</span>
        </button>

        <button
          onClick={() => onTabChange('quiz')}
          className={`px-3.5 py-2.5 text-xs font-bold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'quiz'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>2. Generate Quiz</span>
        </button>

        <button
          onClick={() => onTabChange('tutor')}
          className={`px-3.5 py-2.5 text-xs font-bold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'tutor'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>3. Ask Study Buddy</span>
        </button>

        <div className="h-6 w-px bg-slate-200 my-auto mx-1" />

        {/* 4 Supporting Features */}
        <button
          onClick={() => onTabChange('planner')}
          className={`px-3 py-2.5 text-xs font-semibold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'planner'
              ? 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Work & Study Planner</span>
        </button>

        <button
          onClick={() => onTabChange('today')}
          className={`px-3 py-2.5 text-xs font-semibold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'today'
              ? 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          <span>Today's Plan</span>
        </button>

        <button
          onClick={() => onTabChange('timer')}
          className={`px-3 py-2.5 text-xs font-semibold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'timer'
              ? 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <Timer className="w-3.5 h-3.5" />
          <span>Focus Timer</span>
        </button>

        <button
          onClick={() => onTabChange('progress')}
          className={`px-3 py-2.5 text-xs font-semibold rounded-t-xl flex items-center space-x-1.5 transition-all shrink-0 cursor-pointer ${
            currentTab === 'progress'
              ? 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>My Progress</span>
        </button>
      </div>
    </header>
  );
};
