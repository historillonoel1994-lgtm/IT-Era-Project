import React, { useState, useEffect, useRef } from 'react';
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  CheckCircle2,
  Flame,
  Award,
} from 'lucide-react';
import { addStudyTimeMinutes } from '../services/storage';

interface FocusTimerViewProps {
  onNavigateToProgress: () => void;
  onNavigateToQuiz: () => void;
}

const PRESET_DURATIONS = [
  { label: '15 Minutes', minutes: 15, tag: 'Power Break / Quick Revision' },
  { label: '25 Minutes', minutes: 25, tag: 'Classic Pomodoro Focus' },
  { label: '45 Minutes', minutes: 45, tag: 'Deep Work Session' },
  { label: '60 Minutes', minutes: 60, tag: 'Full Lesson Mastery' },
];

export const FocusTimerView: React.FC<FocusTimerViewProps> = ({
  onNavigateToProgress,
  onNavigateToQuiz,
}) => {
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);
  const [sessionCountToday, setSessionCountToday] = useState(1);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Web Audio synthesizer chime
  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.12 + 0.6);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + idx * 0.12);
        osc.stop(audioCtx.currentTime + idx * 0.12 + 0.7);
      });
    } catch (e) {
      console.log('Audio chime error:', e);
    }
  };

  useEffect(() => {
    if (isActive && secondsLeft > 0) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => prev - 1);
      }, 1000);
    } else if (secondsLeft === 0 && isActive) {
      setIsActive(false);
      if (timerRef.current) clearInterval(timerRef.current);
      playChime();
      addStudyTimeMinutes(selectedMinutes);
      setSessionCountToday((c) => c + 1);
      setCompletedNotice(
        `🎉 Great job! You focused for ${selectedMinutes} minutes. Recorded to My Progress!`
      );
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, secondsLeft, selectedMinutes]);

  const handleSelectDuration = (mins: number) => {
    setIsActive(false);
    setSelectedMinutes(mins);
    setSecondsLeft(mins * 60);
    setCompletedNotice(null);
  };

  const handleStart = () => {
    setIsActive(true);
    setCompletedNotice(null);
  };

  const handlePause = () => {
    setIsActive(false);
  };

  const handleReset = () => {
    setIsActive(false);
    setSecondsLeft(selectedMinutes * 60);
    setCompletedNotice(null);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const totalSeconds = selectedMinutes * 60;
  const progressPercent = ((totalSeconds - secondsLeft) / totalSeconds) * 100;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-indigo-600 to-sky-700 text-white rounded-xl shadow-sm shrink-0">
              <Timer className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2.5 py-0.5 rounded-full">
                  Supporting Feature 6 • Focus Timer
                </span>
                <span className="text-xs text-slate-400">Micro-Study Sessions</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Study Session Focus Timer
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Make high-impact study progress during short work breaks or post-shift windows.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
              title={soundEnabled ? 'Chime sound enabled' : 'Chime sound muted'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-sky-600" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={onNavigateToProgress}
              className="px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors"
            >
              View Tracked Time
            </button>
          </div>
        </div>
      </div>

      {completedNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900 animate-fadeIn">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-sm">{completedNotice}</span>
          </div>
          <button
            onClick={onNavigateToQuiz}
            className="text-xs font-bold underline text-emerald-800 hover:text-emerald-950 ml-3"
          >
            Take Quick Quiz Now &rarr;
          </button>
        </div>
      )}

      {/* Main Timer Display Card */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-8 shadow-sm max-w-xl mx-auto text-center space-y-6">
        {/* Preset Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PRESET_DURATIONS.map((preset) => (
            <button
              key={preset.minutes}
              onClick={() => handleSelectDuration(preset.minutes)}
              className={`p-3 rounded-2xl border text-center transition-all ${
                selectedMinutes === preset.minutes
                  ? 'border-sky-500 bg-sky-50/90 text-sky-950 font-bold ring-2 ring-sky-500/20 shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="text-base font-extrabold block">{preset.minutes}m</span>
              <span className="text-[10px] text-slate-500 leading-tight block">
                {preset.minutes <= 25 ? 'Quick Session' : 'Deep Study'}
              </span>
            </button>
          ))}
        </div>

        {/* Circular Countdown Gauge */}
        <div className="relative w-64 h-64 mx-auto flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background ring */}
            <circle
              cx="50"
              cy="50"
              r="44"
              className="text-slate-100"
              strokeWidth="6"
              stroke="currentColor"
              fill="transparent"
            />
            {/* Animated progress ring */}
            <circle
              cx="50"
              cy="50"
              r="44"
              className="text-sky-500 transition-all duration-1000 ease-linear"
              strokeWidth="6"
              strokeDasharray={276.46}
              strokeDashoffset={276.46 - (276.46 * progressPercent) / 100}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
            />
          </svg>

          {/* Time text centered */}
          <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
            <span className="text-5xl font-mono font-extrabold text-slate-900 tracking-tight">
              {formatTime(secondsLeft)}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isActive ? 'Focusing...' : secondsLeft === 0 ? 'Completed!' : 'Ready'}
            </span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-center space-x-3 pt-2">
          {!isActive ? (
            <button
              onClick={handleStart}
              className="px-8 py-3.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-extrabold rounded-2xl shadow-md hover:shadow-lg transition-all flex items-center space-x-2 text-sm cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>START</span>
            </button>
          ) : (
            <button
              onClick={handlePause}
              className="px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-2xl shadow-md transition-all flex items-center space-x-2 text-sm cursor-pointer"
            >
              <Pause className="w-5 h-5 fill-current" />
              <span>PAUSE</span>
            </button>
          )}

          <button
            onClick={handleReset}
            className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-colors flex items-center space-x-2 text-sm cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>RESET</span>
          </button>
        </div>

        {/* Motivation note */}
        <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-2xl flex items-center justify-center space-x-2 text-xs text-slate-600">
          <Flame className="w-4 h-4 text-amber-500" />
          <span>
            Working students who study in <strong>25-minute bursts</strong> retain 35% more knowledge before exams!
          </span>
        </div>
      </div>
    </div>
  );
};
