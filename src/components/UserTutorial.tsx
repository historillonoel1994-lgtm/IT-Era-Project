import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  BookOpen,
  HelpCircle,
  Timer,
  TrendingUp,
  UserCheck,
  LayoutDashboard,
  Upload,
  ShieldAlert,
  Settings,
} from 'lucide-react';
import { NavTab } from './Navbar';
import { StudyBuddyLogo } from './StudyBuddyLogo';

interface TutorialStep {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  tips: string[];
  warningNote?: string;
  targetSelector?: string;
  tabToActivate?: NavTab;
  icon: React.ComponentType<{ className?: string }>;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 1,
    title: 'Welcome to Study Buddy AI',
    subtitle: 'Smart Academic Support for Working Students',
    description:
      'Study Buddy AI helps you turn lengthy lecture files into clear summaries, practice quizzes, audio study guides, and focused study plans—built specifically for students balancing work shifts and classes.',
    tips: [
      'Every summary and quiz links back to verifiable page numbers from your course material.',
      'You can revisit this guided tutorial anytime from the "Help & Tutorial" button in the top bar.',
    ],
    icon: Sparkles,
  },
  {
    id: 2,
    title: 'Account Registration and Login',
    subtitle: 'Save Your Materials & Study Progress',
    description:
      'Use the Log In / Sign Up menu to register a personal student account or sign back in. Registered accounts keep your uploaded files, quiz history, and study progress securely synced across devices.',
    tips: [
      'In Demo Mode, you can explore all features safely with sample data—no registration required.',
      'Create a free student account whenever you are ready to save your own files and scores.',
    ],
    targetSelector: '[data-tutorial-target="nav-account"]',
    icon: UserCheck,
  },
  {
    id: 3,
    title: 'Understanding the Dashboard',
    subtitle: 'Your Central Study Command Center',
    description:
      'Your dashboard brings together your active lesson selector, quick study metrics, Work & Study Planner, Today\'s Plan, and saved study materials so you always know what to review next.',
    tips: [
      'Use the top lesson switcher to jump between saved documents or sample chapters.',
      'Quick-launch cards let you jump straight into Summarize, Practice Quiz, or AI Tutor.',
    ],
    targetSelector: '[data-tutorial-target="dashboard-overview"]',
    tabToActivate: 'summarize',
    icon: LayoutDashboard,
  },
  {
    id: 4,
    title: 'Uploading and Summarizing PDFs',
    subtitle: 'Full Document Reading & Audio Lessons',
    description:
      'Click "Upload PDF" to add PDFs, Word docs (DOCX), PowerPoint decks (PPTX), spreadsheets, or text notes. Study Buddy reads every page and generates structured summaries, key takeaways, and audio narration.',
    tips: [
      'Open "1. Summarize Lesson" to view key ideas, definitions, and page citations.',
      'Use the built-in Audio Teaching Player to listen to your lesson during commutes or breaks.',
    ],
    targetSelector: '[data-tutorial-target="nav-tab-summarize"]',
    tabToActivate: 'summarize',
    icon: Upload,
  },
  {
    id: 5,
    title: 'Creating Practice Quizzes',
    subtitle: 'Test Retention with Page Citations',
    description:
      'Switch to "2. Generate Quiz" to create customized practice exams, flashcards, concept contrasts, and memorization drills grounded directly in your active lesson pages.',
    tips: [
      'Choose your preferred question count, difficulty level, and specific chapters.',
      'After submitting, review explanations and click any citation to verify the exact source page.',
    ],
    targetSelector: '[data-tutorial-target="nav-tab-quiz"]',
    tabToActivate: 'quiz',
    icon: BookOpen,
  },
  {
    id: 6,
    title: 'Using the AI Tutor',
    subtitle: 'Ask Questions Grounded in Your Material',
    description:
      'In "3. Ask Study Buddy", ask questions about difficult concepts, request step-by-step breakdowns, or switch to Feynman Tutor mode for everyday analogies connected to real work scenarios.',
    tips: [
      'Study Buddy searches your active document first and cites the matching page whenever available.',
      'For questions outside your file, Study Buddy clearly labels general AI explanations.',
    ],
    warningNote:
      'Important Reminder: Always verify AI answers against your official textbooks, lecture notes, syllabus, and instructor guidelines.',
    targetSelector: '[data-tutorial-target="nav-tab-tutor"]',
    tabToActivate: 'tutor',
    icon: HelpCircle,
  },
  {
    id: 7,
    title: 'Using the Focus Timer',
    subtitle: 'Protect Your Study & Rest Time',
    description:
      'Open "Focus Timer" to run structured Pomodoro study intervals tailored around your work shifts. Completed focus sessions automatically count toward your tracked study time.',
    tips: [
      'Use short 25-minute blocks after work shifts to avoid burnout and keep retention high.',
      'Pair the Focus Timer with "Work & Study Planner" and "Today\'s Plan" to guard your rest buffers.',
    ],
    targetSelector: '[data-tutorial-target="nav-tab-timer"]',
    tabToActivate: 'timer',
    icon: Timer,
  },
  {
    id: 8,
    title: 'Monitoring Learning Progress',
    subtitle: 'Track Accuracy, Hours & Mastery',
    description:
      'Visit "My Progress" to see your total tracked study hours, average quiz score, completed tasks, verified citations, and topics studied over time.',
    tips: [
      'Spot lower-scoring topics quickly so you can focus your next short review session where it counts.',
      'Registered students automatically sync progress metrics to their account.',
    ],
    targetSelector: '[data-tutorial-target="nav-tab-progress"]',
    tabToActivate: 'progress',
    icon: TrendingUp,
  },
  {
    id: 9,
    title: 'Account Settings and Logout',
    subtitle: 'Manage Your Profile & Keep Your Session Safe',
    description:
      'Open your profile menu in the top-right corner to edit your academic and job details, update your email or password, review security options, or sign out safely.',
    tips: [
      'Always log out when finishing a study session on a shared, school, or workplace computer.',
      'Need a refresher later? Click "Help & Tutorial" in the header at any time to restart this tour.',
    ],
    targetSelector: '[data-tutorial-target="nav-account"]',
    icon: Settings,
  },
];

interface UserTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onNavigateTab: (tab: NavTab) => void;
  isDemoMode: boolean;
  isRegisteredUser: boolean;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const UserTutorial: React.FC<UserTutorialProps> = ({
  isOpen,
  onClose,
  onComplete,
  onNavigateTab,
  isDemoMode,
  isRegisteredUser,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);

  const currentStep = TUTORIAL_STEPS[stepIndex];
  const totalSteps = TUTORIAL_STEPS.length;
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  // Reset to Step 1 whenever tutorial opens
  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  // Switch active tab when step maps to a specific workspace section
  useEffect(() => {
    if (!isOpen) return;
    if (currentStep.tabToActivate) {
      onNavigateTab(currentStep.tabToActivate);
    }
  }, [isOpen, stepIndex]);

  // Measure highlighted DOM element
  const measureTarget = useCallback(() => {
    if (!isOpen || !currentStep.targetSelector) {
      setSpotlightRect(null);
      return;
    }

    const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
    if (!el) {
      setSpotlightRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSpotlightRect(null);
      return;
    }

    const padding = 6;
    setSpotlightRect({
      top: Math.max(4, rect.top - padding),
      left: Math.max(4, rect.left - padding),
      width: Math.min(window.innerWidth - 8, rect.width + padding * 2),
      height: rect.height + padding * 2,
    });
  }, [isOpen, currentStep]);

  useEffect(() => {
    if (!isOpen) return;

    // Scroll target smoothly into view if it is off-screen
    if (currentStep.targetSelector) {
      const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    const timer = setTimeout(measureTarget, 120);
    window.addEventListener('resize', measureTarget);
    window.addEventListener('scroll', measureTarget, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measureTarget);
      window.removeEventListener('scroll', measureTarget, true);
    };
  }, [isOpen, stepIndex, measureTarget, currentStep]);

  // Support Escape / Arrow keys
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' && !isLastStep) {
        setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
      } else if (e.key === 'ArrowLeft' && !isFirstStep) {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFirstStep, isLastStep, onClose, totalSteps]);

  if (!isOpen) return null;

  const StepIcon = currentStep.icon;
  const progressPercent = Math.round(((stepIndex + 1) / totalSteps) * 100);

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Study Buddy AI Tutorial Step ${currentStep.id} of ${totalSteps}: ${currentStep.title}`}
    >
      {/* Dimmed Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/55 backdrop-blur-[1px] transition-opacity"
        onClick={onClose}
      />

      {/* Dynamic Spotlight Highlight Ring over active UI control */}
      {spotlightRect && (
        <div
          className="fixed z-[61] rounded-2xl border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)] ring-4 ring-sky-400/30 pointer-events-none transition-all duration-300"
          style={{
            top: `${spotlightRect.top}px`,
            left: `${spotlightRect.left}px`,
            width: `${spotlightRect.width}px`,
            height: `${spotlightRect.height}px`,
          }}
        />
      )}

      {/* Interactive Tutorial Card */}
      <div className="fixed inset-x-4 bottom-4 sm:inset-auto sm:bottom-6 sm:right-6 z-[62] w-auto sm:w-[440px] max-h-[88vh] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-fadeIn">
        {/* Top Progress Bar */}
        <div className="h-1.5 bg-slate-100 w-full">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 text-white flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            {stepIndex === 0 ? (
              <StudyBuddyLogo size="sm" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
                <StepIcon className="w-5 h-5 text-sky-300" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-sky-300">
                  Step {currentStep.id} of {totalSteps}
                </span>
                {isDemoMode && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-400/30">
                    Demo Preview
                  </span>
                )}
              </div>
              <h3 className="font-extrabold text-sm sm:text-base text-white truncate">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Close tutorial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs sm:text-sm text-slate-700">
          {stepIndex === 0 && (
            <div className="flex items-center space-x-4 p-3.5 bg-sky-50/70 border border-sky-100 rounded-2xl">
              <StudyBuddyLogo size="lg" />
              <div>
                <p className="font-extrabold text-slate-900 text-sm">Study Buddy AI</p>
                <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                  Empowering Working Students Through Quality Education.
                </p>
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700 mb-1">
              {currentStep.subtitle}
            </p>
            <p className="leading-relaxed text-slate-700 text-xs sm:text-sm">
              {currentStep.description}
            </p>
          </div>

          {/* Practical Tips */}
          <ul className="space-y-2 bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
            {currentStep.tips.map((tip, idx) => (
              <li key={idx} className="flex items-start space-x-2 text-xs text-slate-700 leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>

          {/* AI Verification Reminder (Step 6) */}
          {currentStep.warningNote && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-2.5 text-xs text-amber-950">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="font-semibold leading-relaxed">{currentStep.warningNote}</p>
            </div>
          )}

          {/* Step Quick Dots */}
          <div className="flex items-center justify-center space-x-1.5 pt-1">
            {TUTORIAL_STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIndex(idx)}
                aria-label={`Go to step ${s.id}: ${s.title}`}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  idx === stepIndex
                    ? 'w-6 bg-sky-600'
                    : idx < stepIndex
                    ? 'w-2 bg-emerald-500'
                    : 'w-2 bg-slate-300 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            Skip
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={isFirstStep}
              className="px-3 py-2 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition-colors flex items-center space-x-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            {!isLastStep ? (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.min(totalSteps - 1, i + 1))}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onComplete();
                  onClose();
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isRegisteredUser ? 'Finish & Save' : 'Finish'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
