import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Play, Pause, Square, Headphones, Gauge } from 'lucide-react';
import { speechController } from '../services/speech';

interface AudioTeachingPlayerProps {
  id: string;
  title: string;
  subtitle?: string;
  textToSpeak: string;
  variant?: 'card' | 'compact' | 'inline';
}

export const AudioTeachingPlayer: React.FC<AudioTeachingPlayerProps> = ({
  id,
  title,
  subtitle,
  textToSpeak,
  variant = 'card',
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    setIsSupported(speechController.isSupported());

    // Sync state periodically in case speech ended or another audio started
    const interval = setInterval(() => {
      const activeId = speechController.getCurrentId();
      if (activeId === id) {
        setIsPlaying(speechController.isSpeaking(id));
        setIsPaused(speechController.isPaused(id));
      } else if (isPlaying) {
        setIsPlaying(false);
        setIsPaused(false);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [id, isPlaying]);

  if (!isSupported) {
    return null;
  }

  const handleTogglePlay = () => {
    if (isPlaying) {
      speechController.pause();
      setIsPaused(true);
      setIsPlaying(false);
    } else if (isPaused && speechController.getCurrentId() === id) {
      speechController.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      speechController.speak(id, textToSpeak, {
        rate: speed,
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
    }
  };

  const handleStop = () => {
    speechController.stop();
    setIsPlaying(false);
    setIsPaused(false);
  };

  const handleCycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 0.9];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    speechController.setRate(nextSpeed);
  };

  // Inline / Minimal variant (for chat action bars)
  if (variant === 'inline') {
    return (
      <div className="inline-flex items-center space-x-1.5 bg-slate-100/90 hover:bg-slate-200/80 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 transition-colors">
        <button
          type="button"
          onClick={handleTogglePlay}
          className="flex items-center space-x-1 text-sky-800 hover:text-sky-950 cursor-pointer"
          title={isPlaying ? 'Pause Audio Teaching' : 'Listen to Audio Teaching'}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5 fill-sky-700 text-sky-700" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-sky-700 text-sky-700" />
          )}
          <span>{isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'}</span>
        </button>

        {isPlaying && (
          <div className="flex items-center space-x-0.5 px-1">
            <span className="w-0.5 h-2.5 bg-sky-600 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-0.5 h-3.5 bg-sky-600 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-0.5 h-2 bg-sky-600 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        )}

        {(isPlaying || isPaused) && (
          <button
            type="button"
            onClick={handleStop}
            className="p-0.5 text-slate-500 hover:text-slate-700 cursor-pointer"
            title="Stop Audio"
          >
            <Square className="w-3 h-3 fill-slate-500" />
          </button>
        )}

        <button
          type="button"
          onClick={handleCycleSpeed}
          className="text-[10px] text-slate-500 hover:text-slate-800 font-mono pl-1 border-l border-slate-300"
          title="Change playback speed"
        >
          {speed}x
        </button>
      </div>
    );
  }

  // Compact variant
  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200/80 rounded-xl text-xs">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
            <Headphones className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="font-bold text-slate-900 block truncate">{title}</span>
            {subtitle && <span className="text-[10px] text-slate-500 truncate block">{subtitle}</span>}
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
          {isPlaying && (
            <div className="flex items-center space-x-0.5 mr-1">
              <span className="w-1 h-3 bg-sky-600 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-4 bg-sky-600 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-2 bg-sky-600 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}

          <button
            type="button"
            onClick={handleTogglePlay}
            className="p-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg transition-colors cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play Audio Teaching'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-white" /> : <Play className="w-3.5 h-3.5 fill-white" />}
          </button>

          {(isPlaying || isPaused) && (
            <button
              type="button"
              onClick={handleStop}
              className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-colors cursor-pointer"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5 fill-slate-700" />
            </button>
          )}

          <button
            type="button"
            onClick={handleCycleSpeed}
            className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-mono font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            title="Speed"
          >
            {speed}x
          </button>
        </div>
      </div>
    );
  }

  // Full Card Player (Used on SummarizeLessonView for uploaded materials)
  return (
    <div className="bg-gradient-to-r from-sky-900 via-slate-900 to-indigo-950 rounded-2xl p-4 sm:p-5 text-white shadow-md border border-sky-400/20 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-48 h-48 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Title and Audio Indicator */}
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-sky-500/20 text-sky-300 border border-sky-400/30 rounded-xl shrink-0 flex items-center justify-center">
            {isPlaying ? (
              <Volume2 className="w-6 h-6 text-sky-300 animate-pulse" />
            ) : (
              <Headphones className="w-6 h-6 text-sky-300" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider bg-sky-400/20 text-sky-300 border border-sky-400/30 px-2 py-0.5 rounded-full">
                Audio Teaching Mode
              </span>
              {isPlaying && (
                <span className="text-[11px] font-semibold text-emerald-400 flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-0.5" />
                  <span>Now Playing</span>
                </span>
              )}
              {isPaused && (
                <span className="text-[11px] font-semibold text-amber-300">
                  Paused
                </span>
              )}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mt-1">
              {title}
            </h3>
            <p className="text-xs text-sky-200/80 mt-0.5">
              {subtitle || 'Listen to an AI audio lecture of your uploaded material — ideal while commuting or resting your eyes.'}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-2.5 shrink-0 self-end sm:self-center">
          {/* Animated sound wave bars when active */}
          {isPlaying && (
            <div className="hidden sm:flex items-center space-x-1 bg-white/10 px-3 py-2 rounded-xl mr-1">
              <span className="w-1 h-3.5 bg-sky-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-5 bg-sky-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-2.5 bg-sky-400 rounded-full animate-bounce [animation-delay:300ms]" />
              <span className="w-1 h-4 bg-sky-400 rounded-full animate-bounce [animation-delay:100ms]" />
            </div>
          )}

          {/* Play / Pause Toggle Button */}
          <button
            type="button"
            onClick={handleTogglePlay}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-sm cursor-pointer ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
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
                <span>{isPaused ? 'Resume Audio' : 'Start Audio Teaching'}</span>
              </>
            )}
          </button>

          {/* Stop Button */}
          {(isPlaying || isPaused) && (
            <button
              type="button"
              onClick={handleStop}
              className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors cursor-pointer"
              title="Stop audio"
            >
              <Square className="w-4 h-4 fill-white" />
            </button>
          )}

          {/* Speed Selector Pill */}
          <button
            type="button"
            onClick={handleCycleSpeed}
            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-sky-200 border border-white/10 rounded-xl text-xs font-mono font-bold flex items-center space-x-1 transition-colors cursor-pointer"
            title="Cycle playback speed"
          >
            <Gauge className="w-3.5 h-3.5 text-sky-300" />
            <span>{speed}x</span>
          </button>
        </div>
      </div>
    </div>
  );
};
