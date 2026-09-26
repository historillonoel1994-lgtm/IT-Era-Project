import React from 'react';
import { X, CheckCircle, BookOpen, AlertCircle, ExternalLink } from 'lucide-react';
import { LessonDocument } from '../types';
import { recordCitationVerification } from '../services/storage';

interface CitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageNumber: number | string;
  lesson: LessonDocument;
  highlightExcerpt?: string;
  onVerified?: () => void;
}

export const CitationModal: React.FC<CitationModalProps> = ({
  isOpen,
  onClose,
  pageNumber,
  lesson,
  highlightExcerpt,
  onVerified,
}) => {
  const [hasVerified, setHasVerified] = React.useState(false);

  if (!isOpen) return null;

  const targetPageNum = Number(pageNumber);
  const pageData = lesson.pages.find((p) => p.pageNumber === targetPageNum) ||
    lesson.pages[Math.min(Math.max(0, targetPageNum - 1), lesson.pages.length - 1)];

  const handleVerify = () => {
    recordCitationVerification();
    setHasVerified(true);
    if (onVerified) onVerified();
    setTimeout(() => {
      setHasVerified(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-sky-900 via-slate-900 to-sky-950 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-sky-500/20 rounded-lg text-sky-300 border border-sky-400/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base text-white">Source Verification Inspector</span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-sky-400 text-slate-950 rounded-full">
                  Page {pageNumber}
                </span>
              </div>
              <p className="text-xs text-sky-200/80 truncate max-w-md">
                {lesson.title} ({lesson.subject})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Responsible AI Safeguard notice */}
        <div className="bg-sky-50 border-b border-sky-100 px-6 py-2.5 flex items-center space-x-2 text-xs text-sky-900">
          <AlertCircle className="w-4 h-4 text-sky-600 shrink-0" />
          <span>
            <strong>Responsible AI Verification:</strong> Compare the AI's summary or question with the authentic original text below.
          </span>
        </div>

        {/* Excerpt if provided */}
        {highlightExcerpt && (
          <div className="mx-6 mt-4 p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900">
            <div className="font-semibold text-amber-800 mb-1 flex items-center space-x-1">
              <span>Asserted AI Point:</span>
            </div>
            <p className="italic font-serif">"{highlightExcerpt}"</p>
          </div>
        )}

        {/* Original Page Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1 text-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Original Lesson Text — Page {pageData ? pageData.pageNumber : pageNumber}
            </span>
            <span className="text-xs text-slate-500">
              Total Pages: {lesson.totalPages}
            </span>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm leading-relaxed font-sans whitespace-pre-wrap selection:bg-sky-200">
            {pageData ? pageData.text : 'Page content is currently not available for this index.'}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Verifying citations builds good academic study habits.
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleVerify}
              disabled={hasVerified}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center space-x-2 transition-all ${
                hasVerified
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm hover:shadow'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{hasVerified ? 'Verified & Recorded!' : 'I Have Verified This in My Lesson'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
