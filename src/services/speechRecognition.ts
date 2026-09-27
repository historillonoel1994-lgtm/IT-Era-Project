/**
 * Speech-to-Text (Voice Recognition) Service using Web Speech Recognition API
 * Allows students to dictate questions to Ask Study Buddy hands-free.
 */

export interface SpeechToTextCallbacks {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (errorMsg: string) => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export class SpeechToTextSession {
  private recognition: any = null;
  private isListening = false;
  private callbacks: SpeechToTextCallbacks | null = null;

  constructor() {
    if (isSpeechRecognitionSupported()) {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.callbacks?.onStart?.();
      };

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        const combined = finalTranscript || interimTranscript;
        if (combined.trim()) {
          this.callbacks?.onTranscript(combined, Boolean(finalTranscript));
        }
      };

      this.recognition.onerror = (event: any) => {
        const error = event.error;
        this.isListening = false;

        if (error === 'no-speech') {
          // Normal timeout when student pauses speaking
          this.callbacks?.onEnd?.();
          return;
        }

        let userFriendlyError = 'Could not access voice recognition.';
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          userFriendlyError = 'Microphone permission denied. Please allow microphone access in your browser settings.';
        } else if (error === 'audio-capture') {
          userFriendlyError = 'No microphone was found on your device.';
        } else if (error === 'network') {
          userFriendlyError = 'Voice recognition network error. Please try again.';
        }

        this.callbacks?.onError?.(userFriendlyError);
        this.callbacks?.onEnd?.();
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.callbacks?.onEnd?.();
      };
    }
  }

  public start(callbacks: SpeechToTextCallbacks): boolean {
    if (!this.recognition) {
      callbacks.onError?.('Speech recognition is not supported in this browser.');
      return false;
    }

    try {
      this.callbacks = callbacks;
      this.recognition.start();
      return true;
    } catch (err: any) {
      // If already started or transitioning, restart
      try {
        this.recognition.stop();
        setTimeout(() => {
          try {
            this.recognition.start();
          } catch {
            callbacks.onError?.('Could not activate microphone. Please try again.');
          }
        }, 100);
      } catch {
        callbacks.onError?.('Could not activate microphone. Please try again.');
      }
      return false;
    }
  }

  public stop(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.isListening = false;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }
}
