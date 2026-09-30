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

export interface ExplanatoryNarrationResult {
  spokenText: string;
  explainedConcepts: { term: string; explanation: string }[];
}

export const KNOWN_CONCEPT_EXPLANATIONS: Record<string, { term: string; explanation: string }> = {
  'creative destruction': {
    term: 'Creative Destruction',
    explanation:
      'Think of how streaming apps replaced DVD video stores: the old technology faded, but higher value, convenience, and new tech jobs were created. That disruption and economic renewal is creative destruction in action.',
  },
  'msme': {
    term: 'MSMEs (Micro, Small & Medium Enterprises)',
    explanation:
      'This refers to small neighborhood businesses, retail counters, and local enterprises where many working students are employed.',
  },
  'factors of production': {
    term: 'Four Factors of Production',
    explanation:
      'In economics, you need four key inputs to build anything: Land for natural resources, Labor for human effort, Capital for machinery and tools, and Entrepreneurship to organize them into a viable business.',
  },
  'opportunity recognition': {
    term: 'Opportunity vs. Raw Idea',
    explanation:
      'A raw idea is just a mental thought. An opportunity is when real customers have an acute problem or pain point they are actively willing to pay you to solve.',
  },
  'lean startup': {
    term: 'Lean Startup Method',
    explanation:
      'Instead of spending your life savings building a full product in secret, you release a small version, test real customer reactions, and adjust quickly to avoid wasting money.',
  },
  'minimum viable product': {
    term: 'Minimum Viable Product (MVP)',
    explanation:
      'The simplest version of your product that genuinely works and solves the core problem, built to learn what users actually want before spending thousands on extra features.',
  },
  'mvp': {
    term: 'MVP (Minimum Viable Product)',
    explanation:
      'The simplest functional release that allows you to collect validated user feedback with the least effort and financial risk.',
  },
  'bootstrapping': {
    term: 'Bootstrapping',
    explanation:
      'Starting and funding your business strictly with your own personal savings, sweat equity, and customer cash flow without taking outside loans or giving away equity.',
  },
  'break-even volume': {
    term: 'Break-Even Volume Formula',
    explanation:
      'This calculates the exact number of items you must sell just to cover fixed rent and salaries so your net profit is zero. Every sale beyond this point is pure profit.',
  },
  'cash runway': {
    term: 'Cash Runway',
    explanation:
      'Your financial survival clock: total liquid cash divided by how much cash you lose each month. It tells you exactly how many months you have to reach profitability or secure funding.',
  },
  'triple bottom line': {
    term: 'Triple Bottom Line (People, Planet, Profit)',
    explanation:
      'A modern business principle where success is measured not just by dollars, but by how fairly you treat workers (People), how you protect the environment (Planet), and financial longevity (Profit).',
  },
  'human capital': {
    term: 'Human Capital Theory',
    explanation:
      'Your education, technical skills, and health are economic assets. When you spend time studying after work, you are increasing your human capital, leading to higher lifetime earnings.',
  },
  'opportunity cost': {
    term: 'Opportunity Cost',
    explanation:
      'The hidden cost of what you give up when you choose one option over another. For a working student, taking an extra 4-hour retail shift means giving up 4 hours of study or sleep.',
  },
  'time poverty': {
    term: 'Time Poverty',
    explanation:
      'When your combined job shifts, commuting, and classes leave you with almost zero free hours for deep focus or sleep, resulting in physical exhaustion and elevated stress.',
  },
  'positive externalities': {
    term: 'Positive Externalities',
    explanation:
      'Benefits that spill over to the entire community when individuals get educated, such as lower crime, higher civic participation, and faster economic modernization.',
  },
  'hallucination': {
    term: 'AI Hallucinations',
    explanation:
      'Large language models predict words based on statistical probability rather than conscious fact-checking. When they encounter gaps, they generate confident, persuasive text that is completely fabricated.',
  },
  'grounding': {
    term: 'Grounding & Citation Traceability',
    explanation:
      'Restricting the AI to act like an open-book test—it must verify every assertion against the uploaded textbook page and refuse to answer if the evidence is missing.',
  },
  'human-in-the-loop': {
    term: 'Human-in-the-Loop (HITL)',
    explanation:
      'You, the human student, remain the critical auditor who verifies citations and definitions before exams, treating AI as a study buddy rather than a replacement for thinking.',
  },
  'accrual accounting': {
    term: 'Accrual Accounting vs. Cash Flow',
    explanation:
      'Under accrual rules, revenue is recorded when you deliver a service, even if the client pays 60 days later. That is why a business can show paper profit while having an empty bank account.',
  },
  'contribution margin': {
    term: 'Unit Contribution Margin',
    explanation:
      'Selling price minus direct variable costs. It represents the exact dollar amount each sale contributes toward paying your monthly rent and generating net profit.',
  },
  'margin of safety': {
    term: 'Margin of Safety',
    explanation:
      'The sales cushion above your break-even point. A larger margin of safety protects your business if sales drop unexpectedly during slow months.',
  },
  'working capital': {
    term: 'Working Capital',
    explanation:
      'Current assets minus current liabilities. It measures the short-term cash cushion you have to pay upcoming bills, supplier invoices, and payroll.',
  },
};

/**
 * Builds a natural, conversational audio narration for a lesson page,
 * explicitly inserting student-friendly explanations for unexplained/complex portions.
 */
export function buildExplanatoryPageAudioText(
  pageNumber: number | string,
  totalPages: number,
  pageText: string,
  lessonTitle?: string,
  subject?: string
): ExplanatoryNarrationResult {
  const clean = cleanTextForSpeech(pageText);
  if (!clean) {
    return {
      spokenText: `Page ${pageNumber} of ${totalPages}. There is no readable text extracted from this page.`,
      explainedConcepts: [],
    };
  }

  const explainedConcepts: { term: string; explanation: string }[] = [];
  const lowerText = clean.toLowerCase();

  // Check which concepts in this page need conversational explanation
  for (const [key, concept] of Object.entries(KNOWN_CONCEPT_EXPLANATIONS)) {
    if (lowerText.includes(key)) {
      if (!explainedConcepts.some((c) => c.term === concept.term)) {
        explainedConcepts.push(concept);
      }
    }
  }

  // Build conversational natural speech script
  const parts: string[] = [];

  // 1. Natural warm intro
  const titleHint = lessonTitle ? ` on ${lessonTitle}` : '';
  parts.push(
    `Welcome to page ${pageNumber} of ${totalPages}${titleHint}. Let's walk through this material together so you can absorb it naturally while you work.`
  );

  // 2. Format paragraphs into natural spoken delivery
  // Convert dry section headers
  let conversationalBody = clean
    .replace(/^Section\s+(\d+\.\d+)[:\s]+(.*)$/gim, 'Now looking at Section $1: $2.')
    .replace(/^CHAPTER\s+(\d+)[:\s]+(.*)$/gim, 'Chapter $1: $2.')
    .replace(/Break-Even Volume\s*=\s*Total Fixed Costs\s*\/\s*\(([^)]+)\)/gi, 
      'Break-even volume is calculated as: total fixed costs, divided by $1.')
    .replace(/Cash Runway\s*\(in Months\)\s*=\s*([^.]+)\./gi,
      'Cash runway in months equals $1.')
    .replace(/\bCOGS\b/g, 'Cost of Goods Sold')
    .replace(/\bGDP\b/g, 'Gross Domestic Product')
    .replace(/\bCSR\b/g, 'Corporate Social Responsibility')
    .replace(/\bBEP\b/g, 'Break-Even Point');

  parts.push(conversationalBody);

  // 3. Insert plain-English explanations for unexplained concepts found in this page
  if (explainedConcepts.length > 0) {
    parts.push(
      `Now, let's pause for a moment to explain the key concepts on this page in everyday plain English so there are no confusing gaps.`
    );

    explainedConcepts.slice(0, 3).forEach((item, idx) => {
      parts.push(
        `Concept ${idx + 1}: ${item.term}. Here is what this means: ${item.explanation}`
      );
    });

    parts.push(
      `Keep these intuitive examples in mind as you review for your upcoming quizzes and assignments.`
    );
  }

  // 4. Closing transition
  if (Number(pageNumber) < totalPages) {
    parts.push(`That covers page ${pageNumber}. Let's advance to the next page.`);
  } else {
    parts.push(
      `That concludes the narration for page ${pageNumber} and the full lesson. Great job staying focused during your study session!`
    );
  }

  return {
    spokenText: parts.join(' '),
    explainedConcepts,
  };
}

/**
 * Prepares page text for full-lesson audio narration
 * Supports either natural explanatory lecture (with explanations for unexplained concepts)
 * or exact verbatim reading.
 */
export function buildPageAudioText(
  pageNumber: number | string,
  totalPages: number,
  pageText: string,
  mode: 'explanatory' | 'verbatim' = 'explanatory',
  lessonTitle?: string,
  subject?: string
): string {
  if (mode === 'explanatory') {
    const result = buildExplanatoryPageAudioText(pageNumber, totalPages, pageText, lessonTitle, subject);
    return result.spokenText;
  }

  const clean = cleanTextForSpeech(pageText);
  if (!clean) {
    return `Page ${pageNumber} of ${totalPages}. No readable text on this page.`;
  }
  return `Page ${pageNumber} of ${totalPages}. ${clean}`;
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

  public stop(triggerEndCallback = false): void {
    if (!this.isSupported()) return;
    const endCb = this.currentOptions.onEnd;
    this.queue = [];
    this.currentId = null;
    this.isCurrentlyPaused = false;
    this.currentOptions = {};
    window.speechSynthesis.cancel();
    if (triggerEndCallback) {
      endCb?.();
    }
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
