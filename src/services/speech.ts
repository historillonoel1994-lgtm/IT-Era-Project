/**
 * Audio Teaching Service using Web Speech API
 * Provides student-friendly voice teaching for uploaded materials and AI tutor responses.
 */

import { LessonSummary } from '../types';

export interface SpeechOptions {
  rate?: number; // 0.8 to 1.5 (default: 1.0)
  pitch?: number; // 0.8 to 1.2 (default: 1.0)
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onError?: (err: any) => void;
}

// Cleans markdown markup, hashtags, links, and bold text for clean speech synthesis
export function cleanTextForSpeech(rawText: string): string {
  if (!rawText) return '';

  return rawText
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove citation tags like [Source: Page 2] -> "from page 2"
    .replace(/\[Source:\s*Page\s*(\d+)\]/gi, 'from page $1')
    // Remove general citations [Page 2] -> "page 2"
    .replace(/\[Page\s*(\d+)\]/gi, 'page $1')
    // Remove bold and italic markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove bullet points
    .replace(/^\s*[-*•]\s+/gm, '')
    // Remove numbered lists markers
    .replace(/^\s*\d+\.\s+/gm, '')
    // Remove backticks / code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '')
    // Convert multiple whitespace/newlines to single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds an engaging, conversational audio lecture for an uploaded learning material
 */
export function buildLessonAudioScript(
  lessonTitle: string,
  subject: string,
  summary?: Partial<LessonSummary> | null,
  rawPages?: { pageNumber: number; text: string }[]
): string {
  const parts: string[] = [];

  parts.push(`Welcome to your audio study session on ${lessonTitle}, in ${subject}.`);

  if (summary?.simpleExplanation) {
    parts.push(`Here is the core overview: ${summary.simpleExplanation}`);
  } else if (rawPages && rawPages.length > 0) {
    // Fallback to first page excerpts
    const sample = rawPages[0].text.slice(0, 300);
    parts.push(`Overview from page one: ${sample}`);
  }

  if (summary?.keyIdeas && summary.keyIdeas.length > 0) {
    parts.push(`Let's explore the key concepts.`);
    summary.keyIdeas.slice(0, 4).forEach((k, idx) => {
      parts.push(`Point ${idx + 1}: ${k.idea}.`);
    });
  }

  if (summary?.importantTerms && summary.importantTerms.length > 0) {
    parts.push(`Here are essential terms to remember.`);
    summary.importantTerms.slice(0, 3).forEach((item) => {
      parts.push(`${item.term}: defined as ${item.definition}.`);
    });
  }

  if (summary?.keyTakeaways && summary.keyTakeaways.length > 0) {
    parts.push(`Finally, your key takeaway: ${summary.keyTakeaways[0].takeaway}`);
  }

  parts.push(`That concludes your audio summary for ${lessonTitle}. Feel free to ask Study Buddy any follow-up questions!`);

  return parts.join(' ');
}

class AudioTeachingController {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isCurrentlyPaused = false;
  private currentId: string | null = null;
  private activeRate = 1.0;
  private queue: string[] = [];
  private currentOptions: SpeechOptions = {};

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) return [];
    return window.speechSynthesis.getVoices();
  }

  private pickBestVoice(): SpeechSynthesisVoice | null {
    const voices = this.getVoices();
    if (!voices.length) return null;

    // Prefer fluent English natural voices
    const preferred = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') ||
          v.name.includes('Google') ||
          v.name.includes('Samantha') ||
          v.name.includes('Daniel') ||
          v.name.includes('Karen') ||
          v.name.includes('Arthur'))
    );

    if (preferred) return preferred;

    // Fallback to any English voice
    const englishVoice = voices.find((v) => v.lang.startsWith('en'));
    return englishVoice || voices[0];
  }

  public speak(
    id: string,
    rawText: string,
    options: SpeechOptions = {}
  ): void {
    if (!this.isSupported()) {
      options.onError?.(new Error('Speech synthesis not supported in this browser.'));
      return;
    }

    this.stop();

    const cleanText = cleanTextForSpeech(rawText);
    if (!cleanText) return;

    this.currentId = id;
    this.activeRate = options.rate || 1.0;
    this.currentOptions = options;
    this.isCurrentlyPaused = false;

    // Break text into sentences to prevent Chrome 15s pause bug
    const sentences = cleanText.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [cleanText];
    this.queue = sentences.map((s) => s.trim()).filter((s) => s.length > 0);

    options.onStart?.();
    this.speakNextChunk();
  }

  private speakNextChunk(): void {
    if (!this.queue.length) {
      this.currentId = null;
      this.isCurrentlyPaused = false;
      this.currentOptions.onEnd?.();
      return;
    }

    const chunk = this.queue.shift();
    if (!chunk) {
      this.speakNextChunk();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = this.activeRate;
    utterance.pitch = this.currentOptions.pitch || 1.0;

    const voice = this.pickBestVoice();
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      if (this.currentId) {
        this.speakNextChunk();
      }
    };

    utterance.onerror = (e) => {
      // In case user cancelled intentionally, ignore 'interrupted' or 'canceled'
      if (e.error === 'interrupted' || e.error === 'canceled') {
        return;
      }
      console.warn('SpeechSynthesis error:', e);
      this.currentOptions.onError?.(e);
      this.currentId = null;
      this.isCurrentlyPaused = false;
    };

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  public pause(): void {
    if (!this.isSupported()) return;
    if (window.speechSynthesis.speaking && !this.isCurrentlyPaused) {
      window.speechSynthesis.pause();
      this.isCurrentlyPaused = true;
      this.currentOptions.onPause?.();
    }
  }

  public resume(): void {
    if (!this.isSupported()) return;
    if (this.isCurrentlyPaused) {
      window.speechSynthesis.resume();
      this.isCurrentlyPaused = false;
      this.currentOptions.onResume?.();
    }
  }

  public stop(): void {
    if (!this.isSupported()) return;
    this.queue = [];
    this.currentId = null;
    this.isCurrentlyPaused = false;
    window.speechSynthesis.cancel();
    this.currentOptions.onEnd?.();
  }

  public isSpeaking(id?: string): boolean {
    if (!this.isSupported()) return false;
    if (!window.speechSynthesis.speaking) return false;
    if (id) {
      return this.currentId === id && !this.isCurrentlyPaused;
    }
    return !this.isCurrentlyPaused;
  }

  public isPaused(id?: string): boolean {
    if (!this.isSupported()) return false;
    if (id) {
      return this.currentId === id && this.isCurrentlyPaused;
    }
    return this.isCurrentlyPaused;
  }

  public getCurrentId(): string | null {
    return this.currentId;
  }

  public setRate(rate: number): void {
    this.activeRate = rate;
    if (this.currentUtterance) {
      this.currentUtterance.rate = rate;
    }
  }
}

export const speechController = new AudioTeachingController();
