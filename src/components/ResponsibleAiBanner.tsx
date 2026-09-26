import React from 'react';
import { ShieldCheck, AlertTriangle, BookCheck, Sparkles, HelpCircle } from 'lucide-react';

interface ResponsibleAiBannerProps {
  compact?: boolean;
}

export const ResponsibleAiBanner: React.FC<ResponsibleAiBannerProps> = ({ compact = false }) => {
  const [showDetails, setShowDetails] = React.useState(false);

  if (compact) {
    return (
      <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-amber-900 shadow-sm">
        <div className="flex items-center space-x-2.5">
          <span className="p-1 bg-amber-100 text-amber-800 rounded-md">
            <AlertTriangle className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium">
            AI-generated summary. Please verify important information using your original lesson.
          </span>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-amber-800 hover:text-amber-950 font-semibold underline text-xs ml-3 shrink-0"
        >
          {showDetails ? 'Hide Safeguards' : 'Why check?'}
        </button>

        {showDetails && (
          <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-800 w-full col-span-2">
            AI may occasionally misunderstand or omit context. Study Buddy AI grounds every assertion in your uploaded PDF pages and never invents page citations. Always cross-check with your professor or course module.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-sky-50 via-white to-emerald-50 border border-sky-200/70 rounded-2xl p-4 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start space-x-3">
          <div className="p-2.5 bg-sky-100 text-sky-800 rounded-xl shrink-0 border border-sky-200">
            <ShieldCheck className="w-5 h-5 text-sky-700" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded-full">
                Responsible AI Verification
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                Zero Hallucinated Citations
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-800 mt-1">
              “AI-generated summary. Please verify important information using your original lesson.”
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              Study Buddy AI extracts learning concepts strictly from your uploaded lesson pages. Click on any{' '}
              <span className="font-semibold text-sky-700 bg-sky-100 px-1 py-0.5 rounded text-[11px]">
                [Source: Page X]
              </span>{' '}
              citation to inspect the authentic textbook excerpt.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
