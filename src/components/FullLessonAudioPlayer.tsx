import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Headphones,
  Gauge,
  SkipForward,
  SkipBack,
  BookOpen,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  CheckCircle2,
  Radio,
  Lightbulb,
  Mic,
  Info,
} from 'lucide-react';
import { LessonDocument, LessonSummary } from '../types';
import {
  speechController,
  buildLessonAudioScript,
  buildPageAudioText,
  buildExplanatoryPageAudioText,
  cleanTextForSpeech,
} from '../services/speech';

interface FullLessonAudioPlayerProps {
  lesson: LessonDocument;
  summary?: LessonSummary | null;
}

export const FullLessonAudioPlayer: React.FC<FullLessonAudioPlayerProps> = ({
  lesson,
  summary,
}) => {
  const [audioMode, setAudioMode] = useState<'full' | 'summary'>('full');
  const [narrationStyle, setNarrationStyle] = useState<'explanatory' | 'verbatim'>('explanatory');
  const [transcriptTab, setTranscriptTab] = useState<'explanatory' | 'raw'>('explanatory');
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [continuousPlay, setContinuousPlay] = useState<boolean>(true);
  const [showTranscript, setShowTranscript] = useState<boolean>(false);
  const [isSupported, setIsSupported] = useState<boolean>(true);

  // Refs for callbacks
  const continuousPlayRef = useRef(continuousPlay);
  continuousPlayRef.current = continuousPlay;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const audioModeRef = useRef(audioMode);
  audioModeRef.current = audioMode;
  const narrationStyleRef = useRef(narrationStyle);
  narrationStyleRef.current = narrationStyle;
  const isManualStopRef = useRef(false);

  const pages = lesson.pages && lesson.pages.length > 0
    ? lesson.pages
    : [{ pageNumber: 1, text: 'No text extracted from this lesson.' }];
  const totalPages = pages.length;
  const currentPage = pages[currentPageIndex] || pages[0];

  // Current page explanatory audio details
  const currentExplanatory = buildExplanatoryPageAudioText(
    currentPage.pageNumber,
    totalPages,
    currentPage.text,
    lesson.title,
    lesson.subject
  );

  useEffect(() => {
    setIsSupported(speechController.isSupported());

    // Sync state periodically
    const interval = setInterval(() => {
      const activeId = speechController.getCurrentId();
      if (activeId) {
        setIsPlaying(speechController.isSpeaking());
        setIsPaused(speechController.isPaused());
      } else if (isPlaying) {
        setIsPlaying(false);
        setIsPaused(false);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Clean up on unmount or lesson change
  useEffect(() => {
    return () => {
      isManualStopRef.current = true;
      speechController.stop();
    };
  }, [lesson.id]);

  if (!isSupported) {
    return null;
  }

  const playFullPage = (index: number, overrideStyle?: 'explanatory' | 'verbatim') => {
    if (index < 0 || index >= pages.length) return;
    isManualStopRef.current = false;
    const pageToPlay = pages[index];
    const activeStyle = overrideStyle || narrationStyleRef.current;
    const pageSpeechText = buildPageAudioText(
      pageToPlay.pageNumber,
      totalPages,
      pageToPlay.text,
      activeStyle,
      lesson.title,
      lesson.subject
    );

    const speechId = `full-lesson-${lesson.id}-p${pageToPlay.pageNumber}-${activeStyle}`;

    speechController.speak(speechId, pageSpeechText, {
      rate: speedRef.current,
      onStart: () => {
        setIsPlaying(true);
        setIsPaused(false);
      },
      onEnd: () => {
        if (isManualStopRef.current) {
          isManualStopRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
          return;
        }

        // Auto-advance to next page if continuous play is enabled
        if (audioModeRef.current === 'full' && continuousPlayRef.current) {
          if (currentPageIndexRef.current < pages.length - 1) {
            const nextIdx = currentPageIndexRef.current + 1;
            setCurrentPageIndex(nextIdx);
            setTimeout(() => {
              playFullPage(nextIdx, activeStyle);
            }, 500);
          } else {
            setIsPlaying(false);
            setIsPaused(false);
          }
        } else {
          setIsPlaying(false);
          setIsPaused(false);
        }
      },
      onPause: () => {
        setIsPlaying(false);
        setIsPaused(true);
      },
      onResume: () => {
        setIsPlaying(true);
        setIsPaused(false);
      },
      onError: () => {
        setIsPlaying(false);
        setIsPaused(false);
      },
    });
  };

  const playSummaryAudio = () => {
    isManualStopRef.current = false;
    const summaryScript = buildLessonAudioScript(
      lesson.title,
      lesson.subject,
      summary,
      lesson.pages
    );
    const speechId = `summary-lesson-${lesson.id}`;

    speechController.speak(speechId, summaryScript, {
      rate: speedRef.current,
      onStart: () => {
        setIsPlaying(true);
        setIsPaused(false);
      },
      onEnd: () => {
        setIsPlaying(false);
        setIsPaused(false);
      },
      onPause: () => {
        setIsPlaying(false);
        setIsPaused(true);
      },
      onResume: () => {
        setIsPlaying(true);
        setIsPaused(false);
      },
      onError: () => {
        setIsPlaying(false);
        setIsPaused(false);
      },
    });
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      speechController.pause();
      setIsPaused(true);
      setIsPlaying(false);
    } else if (isPaused) {
      speechController.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      if (audioMode === 'full') {
        playFullPage(currentPageIndex);
      } else {
        playSummaryAudio();
      }
    }
  };

  const handleStop = () => {
    isManualStopRef.current = true;
    speechController.stop();
    setIsPlaying(false);
    setIsPaused(false);
  };

  const handleNextPage = () => {
    if (currentPageIndex < pages.length - 1) {
      const nextIdx = currentPageIndex + 1;
      setCurrentPageIndex(nextIdx);
      if (isPlaying || isPaused) {
        playFullPage(nextIdx);
      }
    }
  };

  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      const prevIdx = currentPageIndex - 1;
      setCurrentPageIndex(prevIdx);
      if (isPlaying || isPaused) {
        playFullPage(prevIdx);
      }
    }
  };

  const handleSelectPage = (index: number) => {
    setCurrentPageIndex(index);
    if (isPlaying || isPaused) {
      playFullPage(index);
    }
  };

  const handleSwitchMode = (mode: 'full' | 'summary') => {
    if (mode === audioMode) return;
    handleStop();
    setAudioMode(mode);
  };

  const handleSwitchNarrationStyle = (style: 'explanatory' | 'verbatim') => {
    if (style === narrationStyle) return;
    setNarrationStyle(style);
    narrationStyleRef.current = style;
    if (isPlaying) {
      handleStop();
      setTimeout(() => {
        playFullPage(currentPageIndex, style);
      }, 100);
    }
  };

  const handleCycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.8];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    speedRef.current = nextSpeed;
    speechController.setRate(nextSpeed);
  };

  const progressPercent = Math.min(
    100,
    Math.round(((currentPageIndex + 1) / totalPages) * 100)
  );

  return (
    <div className="bg-gradient-to-br from-slate-900 via-sky-950 to-indigo-950 rounded-2xl p-5 sm:p-6 text-white shadow-lg border border-sky-400/25 relative overflow-hidden">
      {/* Decorative ambient background glows */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/15 rounded-full blur-2xl pointer-events-none" />

      <div className="relative z-10 space-y-4">
        {/* Top bar: Mode Switcher & Hands-free badge */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-xl shrink-0">
              {isPlaying ? (
                <Volume2 className="w-5 h-5 text-sky-300 animate-pulse" />
              ) : (
                <Headphones className="w-5 h-5 text-sky-300" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider bg-sky-400/20 text-sky-200 border border-sky-400/30 px-2.5 py-0.5 rounded-full">
                  Audio Learning Center
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-0.5" />
                  <span>Work-Shift Friendly</span>
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white mt-0.5">
                {audioMode === 'full'
                  ? `Full Audio Narration: ${lesson.title}`
                  : `Audio Summary Lecture: ${lesson.title}`}
              </h3>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center p-1 bg-black/40 rounded-xl border border-white/10 shrink-0 self-start sm:self-center">
            <button
              type="button"
              onClick={() => handleSwitchMode('full')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                audioMode === 'full'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow-xs'
                  : 'text-sky-200/80 hover:text-white'
              }`}
              title="Listen to the full uploaded material across all pages"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Full Lesson Audio ({totalPages} Pages)</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('summary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                audioMode === 'summary'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow-xs'
                  : 'text-sky-200/80 hover:text-white'
              }`}
              title="Listen to concise high-yield summary and definitions"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Audio Summary</span>
            </button>
          </div>
        </div>

        {/* Narration Tone & Style Selector (when Full Audio is chosen) */}
        {audioMode === 'full' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-black/30 border border-sky-400/20 rounded-xl px-3.5 py-2.5 gap-2">
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
                Spoken Style:
              </span>
              <div className="flex items-center p-0.5 bg-black/50 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => handleSwitchNarrationStyle('explanatory')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    narrationStyle === 'explanatory'
                      ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-sky-200 hover:text-white'
                  }`}
                  title="Natural conversational speaker that explains unexplained portions, formulas, and jargon"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Natural & Explanatory (Recommended)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchNarrationStyle('verbatim')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    narrationStyle === 'verbatim'
                      ? 'bg-white text-slate-950 font-bold shadow-xs'
                      : 'text-sky-200 hover:text-white'
                  }`}
                  title="Direct word-for-word reading of page text"
                >
                  <FileText className="w-3 h-3" />
                  <span>Direct Verbatim Reading</span>
                </button>
              </div>
            </div>

            <span className="text-[11px] text-sky-200/90 italic">
              {narrationStyle === 'explanatory'
                ? '✨ Natural professor tone with plain-English explanations for complex concepts'
                : '📄 Direct word-for-word page reading'}
            </span>
          </div>
        )}

        {/* Active Explanations Callout Badge if concepts are explained on current page */}
        {audioMode === 'full' && narrationStyle === 'explanatory' && currentExplanatory.explainedConcepts.length > 0 && (
          <div className="bg-amber-400/10 border border-amber-400/30 rounded-xl p-3 text-xs flex items-start space-x-2.5 text-amber-200">
            <Lightbulb className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-200">
                Natural Explanations Active on Page {currentPage.pageNumber}:
              </span>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {currentExplanatory.explainedConcepts.map((c, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 bg-amber-400/20 text-amber-100 rounded-md text-[11px] font-semibold border border-amber-400/30"
                    title={c.explanation}
                  >
                    💡 {c.term}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-amber-300/80 pt-0.5">
                The narrator pauses to explain these dense or unexplained portions in plain English with everyday analogies so you can easily understand while working.
              </p>
            </div>
          </div>
        )}

        {/* Subtitle / Mode explanation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-sky-200/80 gap-2">
          {audioMode === 'full' ? (
            <p>
              🎧 <strong className="text-white">Full Material Narration:</strong> Hear every page of your uploaded file read aloud with natural conversational explanation. Plug in your earphones and absorb the entire lesson while working.
            </p>
          ) : (
            <p>
              ⚡ <strong className="text-white">High-Yield Summary:</strong> Fast 2-minute overview covering core concepts, essential definitions, and key exam takeaways.
            </p>
          )}

          {/* Status badge */}
          <div className="flex items-center space-x-2 shrink-0">
            {isPlaying && (
              <span className="text-[11px] font-bold text-emerald-300 flex items-center space-x-1.5 bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-0.5 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>
                  Playing {audioMode === 'full' ? `Page ${currentPageIndex + 1} of ${totalPages}` : 'Summary'}
                </span>
              </span>
            )}
            {isPaused && (
              <span className="text-[11px] font-bold text-amber-300 bg-amber-500/20 border border-amber-400/30 px-2.5 py-0.5 rounded-lg">
                Paused
              </span>
            )}
          </div>
        </div>

        {/* Full Audio Mode: Page Progress and Quick Jumper */}
        {audioMode === 'full' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white">
                  Page {currentPageIndex + 1} of {totalPages}
                </span>
                <span className="text-sky-300/80 font-mono text-[11px]">
                  ({progressPercent}% of document completed)
                </span>
              </div>
              <label className="flex items-center space-x-2 text-[11px] text-sky-200/90 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={continuousPlay}
                  onChange={(e) => setContinuousPlay(e.target.checked)}
                  className="rounded border-sky-400 text-sky-600 focus:ring-sky-500"
                />
                <span>Continuous Autoplay</span>
              </label>
            </div>

            {/* Visual Progress Bar */}
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-sky-400 to-indigo-400 h-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Quick Page Jump Pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
              <span className="text-[10px] font-bold text-sky-300/70 uppercase tracking-wider shrink-0 mr-1">
                Jump to:
              </span>
              {pages.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectPage(idx)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold shrink-0 transition-colors cursor-pointer ${
                    currentPageIndex === idx
                      ? 'bg-sky-400 text-slate-950 font-bold shadow-xs'
                      : 'bg-white/10 hover:bg-white/20 text-sky-100'
                  }`}
                  title={`Jump to Page ${p.pageNumber}`}
                >
                  Page {p.pageNumber}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main Audio Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Left: Previous / Play / Next / Stop */}
          <div className="flex items-center space-x-2">
            {/* Prev Page Button (in Full mode) */}
            {audioMode === 'full' && (
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={currentPageIndex === 0}
                className="p-2.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white rounded-xl transition-colors cursor-pointer"
                title="Previous Page"
              >
                <SkipBack className="w-4 h-4" />
              </button>
            )}

            {/* Main Play / Pause Button */}
            <button
              type="button"
              onClick={handleTogglePlay}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center space-x-2 transition-all shadow-md cursor-pointer ${
                isPlaying
                  ? 'bg-amber-400 hover:bg-amber-500 text-slate-950'
                  : 'bg-sky-400 hover:bg-sky-300 text-slate-950'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-slate-950" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>
                    {isPaused
                      ? 'Resume'
                      : audioMode === 'full'
                      ? `Play Page ${currentPageIndex + 1}`
                      : 'Play Summary'}
                  </span>
                </>
              )}
            </button>

            {/* Next Page Button (in Full mode) */}
            {audioMode === 'full' && (
              <button
                type="button"
                onClick={handleNextPage}
                disabled={currentPageIndex >= pages.length - 1}
                className="p-2.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white rounded-xl transition-colors cursor-pointer"
                title="Next Page"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            {/* Stop Button */}
            {(isPlaying || isPaused) && (
              <button
                type="button"
                onClick={handleStop}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors cursor-pointer"
                title="Stop Audio"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            )}

            {/* Animated sound wave bars when active */}
            {isPlaying && (
              <div className="flex items-center space-x-1 bg-white/10 px-3 py-2.5 rounded-xl">
                <span className="w-1 h-3.5 bg-sky-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-5 bg-sky-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-2 bg-sky-400 rounded-full animate-bounce [animation-delay:300ms]" />
                <span className="w-1 h-4 bg-sky-400 rounded-full animate-bounce [animation-delay:100ms]" />
              </div>
            )}
          </div>

          {/* Right: Speed & Transcript toggle */}
          <div className="flex items-center space-x-2">
            {/* Speed Selector Button */}
            <button
              type="button"
              onClick={handleCycleSpeed}
              className="px-3 py-2 bg-white/10 hover:bg-white/20 text-sky-200 border border-white/10 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Change speech rate"
            >
              <Gauge className="w-3.5 h-3.5 text-sky-300" />
              <span>{speed}x Speed</span>
            </button>

            {/* Read-Along Transcript Toggle (Full mode) */}
            {audioMode === 'full' && (
              <button
                type="button"
                onClick={() => setShowTranscript((prev) => !prev)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer border ${
                  showTranscript
                    ? 'bg-sky-500/20 text-sky-200 border-sky-400/40'
                    : 'bg-white/10 hover:bg-white/20 text-white/80 border-white/10'
                }`}
                title="View text of current page"
              >
                <FileText className="w-3.5 h-3.5 text-sky-300" />
                <span>{showTranscript ? 'Hide Read-Along' : 'Read-Along'}</span>
                {showTranscript ? (
                  <ChevronUp className="w-3 h-3 text-sky-300" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-sky-300" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Read-Along Drawer (shows text & explanatory breakdown of current page) */}
        {audioMode === 'full' && showTranscript && (
          <div className="bg-black/50 border border-white/15 rounded-xl p-4 text-xs space-y-3 mt-2 max-h-72 overflow-y-auto font-sans leading-relaxed">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold text-sky-300">
                  Page {currentPage.pageNumber} Read-Along:
                </span>
                <div className="flex items-center p-0.5 bg-white/10 rounded-lg text-[10px]">
                  <button
                    type="button"
                    onClick={() => setTranscriptTab('explanatory')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      transcriptTab === 'explanatory'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    🎙️ Spoken Explanatory Lecture
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptTab('raw')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      transcriptTab === 'raw'
                        ? 'bg-sky-400 text-slate-950 font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    📄 Original Page Text
                  </button>
                </div>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {currentPage.text.length} chars
              </span>
            </div>

            {transcriptTab === 'explanatory' ? (
              <div className="space-y-3">
                {currentExplanatory.explainedConcepts.length > 0 && (
                  <div className="space-y-2 bg-amber-400/10 border border-amber-400/25 rounded-lg p-2.5">
                    <span className="text-[11px] font-bold text-amber-200 block">
                      💡 Natural Concept Explanations Narrated on this Page:
                    </span>
                    <div className="grid grid-cols-1 gap-1.5">
                      {currentExplanatory.explainedConcepts.map((c, i) => (
                        <div key={i} className="text-[11px] text-amber-100 bg-black/40 rounded p-1.5 border border-amber-400/20">
                          <strong className="text-amber-300">{c.term}:</strong> {c.explanation}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-[10px] uppercase font-bold text-sky-300 block mb-1">
                    Spoken Script:
                  </span>
                  <p className="text-slate-200 whitespace-pre-wrap leading-relaxed select-text">
                    {currentExplanatory.spokenText}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-slate-200 whitespace-pre-wrap leading-relaxed select-text">
                {currentPage.text || 'No textual content on this page.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

