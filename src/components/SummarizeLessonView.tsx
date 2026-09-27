import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Sparkles,
  FileText,
  AlertCircle,
  Copy,
  Check,
  Bookmark,
  ArrowRight,
  RefreshCw,
  HelpCircle,
  Layers,
  Key,
  ListChecks,
  ExternalLink,
} from 'lucide-react';
import { LessonDocument, LessonSummary } from '../types';
import { summarizeLesson } from '../services/api';
import { getStoredSummary, saveStoredSummary } from '../services/storage';
import { PRECOMPUTED_SUMMARIES } from '../data/precomputedData';
import { ResponsibleAiBanner } from './ResponsibleAiBanner';
import { CitationModal } from './CitationModal';
import { AudioTeachingPlayer } from './AudioTeachingPlayer';
import { buildLessonAudioScript } from '../services/speech';

interface SummarizeLessonViewProps {
  lesson: LessonDocument;
  onNavigateToQuiz: () => void;
  onNavigateToTutor: () => void;
  onOpenUpload: () => void;
}

export const SummarizeLessonView: React.FC<SummarizeLessonViewProps> = ({
  lesson,
  onNavigateToQuiz,
  onNavigateToTutor,
  onOpenUpload,
}) => {
  const [summary, setSummary] = useState<LessonSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Citation inspector modal state
  const [inspectPage, setInspectPage] = useState<number | string | null>(null);
  const [inspectExcerpt, setInspectExcerpt] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Check if we already have a cached summary for this lesson
    const cached = getStoredSummary(lesson.id);
    if (cached) {
      setSummary(cached);
      setError(null);
    } else {
      handleGenerateSummary();
    }
  }, [lesson.id]);

  const handleGenerateSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await summarizeLesson({
        pages: lesson.pages,
        lessonTitle: lesson.title,
        subject: lesson.subject,
      });
      setSummary(result);
      saveStoredSummary(lesson.id, result);
    } catch (err: any) {
      console.error('Error generating summary:', err);
      // Resilient fallback for sample lessons during 503 high traffic spikes
      const fallback = PRECOMPUTED_SUMMARIES[lesson.id];
      if (fallback) {
        setSummary(fallback);
        saveStoredSummary(lesson.id, fallback);
        setError(null);
      } else {
        setError(err.message || 'Unable to generate summary. Please check your network or try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopyNotes = () => {
    if (!summary) return;
    const text = `# ${summary.mainTopic} (${lesson.title})
## Simple Explanation
${summary.simpleExplanation}

## Key Ideas
${summary.keyIdeas.map((k) => `- ${k.idea} [Source: Page ${k.sourcePage}]`).join('\n')}

## Important Terms
${summary.importantTerms.map((t) => `- **${t.term}**: ${t.definition} [Source: Page ${t.sourcePage}]`).join('\n')}

## Key Takeaways
${summary.keyTakeaways.map((t) => `- ${t.takeaway} [Source: Page ${t.sourcePage}]`).join('\n')}

## Quick Review Notes
${summary.quickReviewNotes
  .map(
    (n) => `### ${n.heading} [Source: Page ${n.sourcePage}]\n` + n.bulletPoints.map((b) => `  * ${b}`).join('\n')
  )
  .join('\n\n')}

*AI-generated summary. Please verify important information using your original lesson.*`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openInspector = (pageNumber: number | string, excerpt?: string) => {
    setInspectPage(pageNumber);
    setInspectExcerpt(excerpt);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-sky-600 to-sky-800 text-white rounded-xl shadow-sm shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 bg-sky-100 px-2.5 py-0.5 rounded-full">
                  Feature 1 • Lesson Summarizer
                </span>
                <span className="text-xs text-slate-400">
                  {lesson.totalPages} Pages Analyzed
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                {lesson.title}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Course: <span className="text-slate-700 font-semibold">{lesson.subject}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 shrink-0">
            <button
              onClick={handleGenerateSummary}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center space-x-1.5 transition-colors disabled:opacity-50"
              title="Regenerate summary with AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Processing...' : 'Regenerate'}</span>
            </button>
            <button
              onClick={handleCopyNotes}
              disabled={!summary}
              className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Notes'}</span>
            </button>
            <button
              onClick={onOpenUpload}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Change Lesson
            </button>
          </div>
        </div>
      </div>

      {/* Prominent Safeguard Banner */}
      <ResponsibleAiBanner />

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-sm text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Unable to complete summarization:</span>
            <p className="text-xs text-red-700">{error}</p>
            <button
              onClick={handleGenerateSummary}
              className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
            >
              Retry Summarizing
            </button>
          </div>
        </div>
      )}

      {/* Loading state skeleton */}
      {loading && !summary && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center space-y-4">
          <div className="inline-flex p-4 bg-sky-50 rounded-2xl text-sky-600 animate-pulse">
            <Sparkles className="w-8 h-8 animate-spin" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              Summarizing Lesson for Fast Review...
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Reading all {lesson.totalPages} pages, indexing definitions, extracting key ideas, and mapping verifiable page citations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto pt-4 text-left">
            <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {/* Summary Content */}
      {summary && (
        <div className="space-y-6">
          {/* Audio Teaching for Uploaded Learning Material */}
          <AudioTeachingPlayer
            id={`audio-lesson-${lesson.id}`}
            title={`Audio Teaching: ${lesson.title}`}
            subtitle={`Listen to the core concepts and definitions of this ${lesson.subject} lesson — perfect for listening on shifts or commutes.`}
            textToSpeak={buildLessonAudioScript(lesson.title, lesson.subject, summary, lesson.pages)}
            variant="card"
          />

          {/* Main Topic & Simple Explanation */}
          <div className="bg-white rounded-2xl border border-sky-100 p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-sky-100/50 rounded-bl-full pointer-events-none" />
            <div className="space-y-3 relative z-10">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-200/60 px-2.5 py-0.5 rounded-full">
                  Main Topic
                </span>
                <span className="text-xs text-slate-400">High-Yield Overview</span>
              </div>
              <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {summary.mainTopic}
              </h3>

              <div className="mt-3 p-4 bg-sky-50/70 border border-sky-200/70 rounded-xl">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-sky-900 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                  <span>Simple Explanation (For Busy Working Students):</span>
                </div>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {summary.simpleExplanation}
                </p>
              </div>
            </div>
          </div>

          {/* Key Ideas Grid with Page citations */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-sky-100 text-sky-700 rounded-lg">
                  <Bookmark className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Key Ideas & Core Concepts</h4>
                  <p className="text-xs text-slate-500">
                    Click any page badge to verify against the authentic textbook page
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {summary.keyIdeas.map((item, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border border-slate-200 hover:border-sky-300 bg-slate-50/50 hover:bg-sky-50/30 transition-all flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-slate-400">0{idx + 1}</span>
                      <button
                        onClick={() => openInspector(item.sourcePage, item.citationExcerpt || item.idea)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-bold bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-full transition-colors cursor-pointer"
                        title="Click to inspect this original page in PDF"
                      >
                        <span>Source: Page {item.sourcePage}</span>
                        <ExternalLink className="w-3 h-3 text-sky-600" />
                      </button>
                    </div>
                    <p className="text-sm font-semibold text-slate-800 leading-snug">
                      {item.idea}
                    </p>
                  </div>

                  {item.citationExcerpt && (
                    <div className="text-xs text-slate-500 italic bg-white p-2.5 rounded-lg border border-slate-100 font-serif">
                      "{item.citationExcerpt}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Two-column layout: Important Terms & Key Takeaways */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Important Terms */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Important Terms</h4>
                  <p className="text-xs text-slate-500">Key definitions for exam recall</p>
                </div>
              </div>

              <div className="space-y-3">
                {summary.importantTerms.map((termItem, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 hover:border-amber-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                        {termItem.term}
                      </span>
                      <button
                        onClick={() => openInspector(termItem.sourcePage, `${termItem.term}: ${termItem.definition}`)}
                        className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 hover:underline"
                      >
                        Page {termItem.sourcePage}
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed pt-1">
                      {termItem.definition}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Takeaways */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                  <ListChecks className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Key Takeaways</h4>
                  <p className="text-xs text-slate-500">Core actionable concepts</p>
                </div>
              </div>

              <div className="space-y-3">
                {summary.keyTakeaways.map((takeawayItem, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-start space-x-3"
                  >
                    <span className="w-5 h-5 rounded-full bg-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-semibold text-slate-800 leading-snug">
                        {takeawayItem.takeaway}
                      </p>
                      <button
                        onClick={() => openInspector(takeawayItem.sourcePage, takeawayItem.takeaway)}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                      >
                        Source: Page {takeawayItem.sourcePage}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Review Notes */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-sky-100 text-sky-800 rounded-lg">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Quick Review Notes</h4>
                  <p className="text-xs text-slate-500">
                    Bite-sized bullet points designed for rapid review during transit or work breaks
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {summary.quickReviewNotes.map((section, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-slate-50/80 border border-slate-200 rounded-xl space-y-2.5"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h5 className="text-xs font-bold text-slate-900">{section.heading}</h5>
                    <button
                      onClick={() => openInspector(section.sourcePage, section.heading)}
                      className="text-[11px] font-semibold text-sky-700 hover:underline"
                    >
                      Page {section.sourcePage}
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {section.bulletPoints.map((point, pIdx) => (
                      <li key={pIdx} className="text-xs text-slate-700 flex items-start space-x-2">
                        <span className="text-sky-500 font-bold">•</span>
                        <span className="leading-relaxed">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Action shortcuts */}
          <div className="bg-gradient-to-r from-sky-900 via-slate-900 to-sky-950 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center md:text-left">
              <h4 className="text-base font-bold text-white">Ready to test your comprehension?</h4>
              <p className="text-xs text-sky-200/80">
                Generate a 5, 10, or 15-question quiz derived strictly from this lesson or ask Study Buddy questions.
              </p>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
              <button
                onClick={onNavigateToTutor}
                className="px-4 py-2.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/20 transition-all flex items-center space-x-1.5"
              >
                <HelpCircle className="w-4 h-4 text-sky-300" />
                <span>Ask Study Buddy</span>
              </button>
              <button
                onClick={onNavigateToQuiz}
                className="px-5 py-2.5 text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl shadow transition-all flex items-center space-x-1.5"
              >
                <span>Generate Quiz</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Citation Inspector Modal */}
      {inspectPage !== null && (
        <CitationModal
          isOpen={inspectPage !== null}
          onClose={() => setInspectPage(null)}
          pageNumber={inspectPage}
          lesson={lesson}
          highlightExcerpt={inspectExcerpt}
        />
      )}
    </div>
  );
};
