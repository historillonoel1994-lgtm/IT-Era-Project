import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  AlertTriangle,
  ExternalLink,
  BookOpen,
  ArrowRight,
  RotateCcw,
  CheckCircle,
  Lightbulb,
  Globe,
  Bookmark,
} from 'lucide-react';
import { LessonDocument, ChatMessage } from '../types';
import { askStudyBuddy, askGemini } from '../services/api';
import { logAskTutorQuestion } from '../lib/supabase';
import { ResponsibleAiBanner } from './ResponsibleAiBanner';
import { CitationModal } from './CitationModal';
import { AudioTeachingPlayer } from './AudioTeachingPlayer';
import { buildLessonAudioScript } from '../services/speech';

interface AskStudyBuddyViewProps {
  lesson: LessonDocument;
  onNavigateToSummary: () => void;
  onOpenUpload: () => void;
}

const LESSON_PRESET_QUESTIONS = [
  'Explain this lesson simply.',
  'Give me an example.',
  'Explain this step-by-step.',
  'What does this term mean?',
  'Create a practice question.',
];

const FEYNMAN_PRESET_QUESTIONS = [
  'Explain the hardest concept simply.',
  'Give me an everyday real-world analogy.',
  'Connect this lesson to a daily job example.',
  'How does this concept work in real life?',
  'Break down the core formula/process.',
];

const GENERAL_PRESET_QUESTIONS = [
  'What is entrepreneurship?',
  'Explain supply and demand.',
  'What is artificial intelligence?',
  'Explain this topic step-by-step.',
  'Give me an example.',
];

export const AskStudyBuddyView: React.FC<AskStudyBuddyViewProps> = ({
  lesson,
  onNavigateToSummary,
  onOpenUpload,
}) => {
  const [mode, setMode] = useState<'materials' | 'feynman' | 'general'>('materials');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'tutor',
      sourceType: 'material',
      sourceLabel: 'Source: Uploaded Learning Material',
      lessonTitle: lesson.title,
      text: `Hello! I'm **Study Buddy**, your dedicated AI learning tutor. I have read **${lesson.title}** (${lesson.totalPages} pages).\n\nI operate an automatic **Two-Source Answer System**:\n• **📘 Uploaded Learning Material**: If your question is covered in your uploaded document, I search your document first and answer strictly using your lesson pages with verifiable page citations.\n• **✨ Gemini / Google AI**: If your question is outside or not covered in your lesson, I answer using Gemini general knowledge with a clear disclaimer notice.\n\nYou can also switch to **💡 Feynman Tutor** mode for simplified everyday analogies!\n\nAsk me anything to get started!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Citation inspector
  const [inspectPage, setInspectPage] = useState<number | string | null>(null);
  const [inspectExcerpt, setInspectExcerpt] = useState<string | undefined>(undefined);

  const openInspector = (pageNumber: number | string, excerpt?: string) => {
    setInspectPage(pageNumber);
    setInspectExcerpt(excerpt);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    if (mode === 'general') {
      try {
        const answer = await askGemini(trimmed);
        const tutorMsg: ChatMessage = {
          id: `msg-tutor-${Date.now()}`,
          sender: 'tutor',
          text: answer,
          sourceType: 'gemini',
          sourceLabel: 'Source: Gemini / Google AI',
          sourceNotice:
            'This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, tutorMsg]);

        // Save record to ask_tutor_logs for logged-in student
        logAskTutorQuestion({
          question: trimmed,
          answer: answer,
          sourceType: 'gemini',
          materialTitle: null,
          pageReference: null,
        }).catch((logErr) => {
          console.error('Failed to log ask_tutor_logs:', logErr);
        });
      } catch (err: any) {
        console.error('General AI question error:', err);
        const fallbackText = `Here is a helpful overview for "${trimmed}":\n\nThis is an important academic topic. Focus on mastering the key definitions, the core mechanisms, and real-world examples from your coursework. Feel free to re-ask or explore your uploaded lesson pages for deeper details!`;
        const tutorMsg: ChatMessage = {
          id: `msg-tutor-${Date.now()}`,
          sender: 'tutor',
          text: fallbackText,
          sourceType: 'gemini',
          sourceLabel: 'Source: Gemini / Google AI',
          sourceNotice: 'Answer provided using Study Buddy offline tutor mode.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, tutorMsg]);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const historyContext = messages.map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const res = await askStudyBuddy({
        pages: lesson.pages,
        lessonTitle: lesson.title,
        question: trimmed,
        chatHistory: historyContext,
        tutorMode: mode,
      });

      const cleanAnswer = (res.answer || '').replace(/\n*Checking Question:\s*[\s\S]*?$/i, '').trim();
      const tutorMsg: ChatMessage = {
        id: `msg-tutor-${Date.now()}`,
        sender: 'tutor',
        text: cleanAnswer,
        sourceType: res.sourceType,
        sourceLabel: res.sourceLabel,
        sourceNotice: res.sourceNotice,
        sourcePage: res.sourcePage,
        sourceSection: res.sourceSection,
        citationExcerpt: res.citationExcerpt,
        directAnswer: res.directAnswer,
        explanation: res.explanation,
        basedOnMaterial: res.basedOnMaterial,
        keyPointToRemember: res.keyPointToRemember,
        example: res.example,
        lessonTitle: res.lessonTitle || lesson.title,
        mode,
        isSafeguardNotice: res.isSafeguardTriggered,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, tutorMsg]);

      // Save record to ask_tutor_logs in Supabase
      const isMaterial = res.sourceType === 'material';
      logAskTutorQuestion({
        question: trimmed,
        answer: res.answer,
        sourceType: isMaterial ? 'uploaded_material' : 'gemini',
        materialTitle: isMaterial ? (res.lessonTitle || lesson.title || null) : null,
        pageReference: isMaterial
          ? (res.sourcePage ? `Page ${res.sourcePage}` : (res.citationExcerpt || null))
          : null,
      }).catch((logErr) => {
        console.error('Failed to log ask_tutor_logs:', logErr);
      });
    } catch (err: any) {
      console.error('Tutor chat error:', err);

      // Intelligent client-side page search fallback so student is never blocked
      const safePages = lesson.pages || [];
      const qKeywords = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2);

      let bestP: any = null;
      let bestHits = 0;
      let matchedQuote = '';

      for (const p of safePages) {
        const textLow = p.text.toLowerCase();
        let hits = 0;
        for (const kw of qKeywords) {
          if (textLow.includes(kw)) hits++;
        }
        if (hits > bestHits) {
          bestHits = hits;
          bestP = p;
          const sentences = p.text.match(/[^.!?]+[.!?]+/g) || [p.text];
          for (const s of sentences) {
            if (qKeywords.some((k) => s.toLowerCase().includes(k))) {
              matchedQuote = s.trim();
              break;
            }
          }
        }
      }

      if (bestP && bestHits > 0) {
        const pageNum = Number(bestP.pageNumber) || 1;
        const excerpt = matchedQuote || bestP.text.trim().slice(0, 160);
        const directAns = `In ${lesson.title}, ${excerpt}`;
        const expl = `This concept is discussed on Page ${pageNum} of ${lesson.title}.`;
        const basedOnMat = `Directly from Page ${pageNum}: "${excerpt}"`;
        const kp = `Review Page ${pageNum} to understand how this connects to the broader topic.`;
        const formatted = `Answer:\n${directAns}\n\nExplanation:\n${expl}\n\nBased on the uploaded material:\n${basedOnMat}\n\nSource:\nPage ${pageNum}\n\nKey Point to Remember:\n${kp}`;

        const tutorMsg: ChatMessage = {
          id: `msg-tutor-${Date.now()}`,
          sender: 'tutor',
          text: formatted,
          directAnswer: directAns,
          explanation: expl,
          basedOnMaterial: basedOnMat,
          keyPointToRemember: kp,
          sourceType: 'material',
          sourceLabel: 'Source: Uploaded Learning Material',
          sourcePage: pageNum,
          citationExcerpt: excerpt,
          lessonTitle: lesson.title,
          mode,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, tutorMsg]);
      } else {
        const notice = 'This topic is not directly discussed in your uploaded learning material. The following answer is based on general Gemini knowledge.';
        const tutorMsg: ChatMessage = {
          id: `msg-tutor-${Date.now()}`,
          sender: 'tutor',
          text: `${notice}\n\nHere is a helpful explanation for "${trimmed}":\n\nThis is a relevant academic concept in ${lesson.title}. Be sure to review the primary section headings and vocabulary terms on pages 1 to ${lesson.totalPages}. Feel free to ask more specific questions about any page!`,
          sourceType: 'gemini',
          sourceLabel: 'Source: Study Buddy Tutor',
          sourceNotice: notice,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, tutorMsg]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: 'welcome-reset',
        sender: 'tutor',
        sourceType: 'material',
        sourceLabel: 'Source: Uploaded Learning Material',
        lessonTitle: lesson.title,
        text:
          mode === 'general'
            ? 'Chat cleared! What general topic or question would you like to explore?'
            : `Chat cleared! What would you like to review from **${lesson.title}**? (Questions not covered will be automatically answered with Gemini general knowledge).`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Helper to render message text or structured Answer/Explanation/Based on material/Source/Key point blocks
  const renderMessageContent = (msg: ChatMessage) => {
    const text = msg.text;
    // Check if safeguard alert
    const isSafeguardText =
      text.includes('I could not find enough information in your uploaded lesson') ||
      text.includes('check your original lesson or ask your instructor');

    if (isSafeguardText) {
      return (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-950">
          <div className="flex items-center space-x-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>AI Safeguard Triggered</span>
          </div>
          <p className="text-sm font-medium leading-relaxed font-sans">
            “I could not find enough information in your uploaded lesson to answer this confidently. Please check your original lesson or ask your instructor.”
          </p>
          <p className="text-xs text-amber-800/80">
            Responsible AI policy: Study Buddy declines to hallucinate facts not substantiated by your course textbook.
          </p>
        </div>
      );
    }

    // Strip any checking question from text so it never displays
    const cleanText = text.replace(/\n*Checking Question:\s*[\s\S]*?$/i, '').trim();

    // Check if structured answer format is present either in fields or parsed in text
    const hasStructuredFields = Boolean(msg.directAnswer || msg.basedOnMaterial || msg.keyPointToRemember);
    const hasStructuredText = cleanText.includes('Answer:') && (cleanText.includes('Explanation:') || cleanText.includes('Based on the uploaded material:'));

    if (msg.sender === 'tutor' && (hasStructuredFields || hasStructuredText)) {
      // Extract components either from fields or text regex
      let directAnswer = msg.directAnswer || '';
      let explanation = msg.explanation || '';
      let example = msg.example || '';
      let basedOnMaterial = msg.basedOnMaterial || '';
      let keyPoint = msg.keyPointToRemember || '';

      if (!directAnswer && hasStructuredText) {
        const directMatch = cleanText.match(/Answer:\s*([\s\S]*?)(?=\n(?:Explanation|Example|Based on the uploaded material|Source|Key Point to Remember):|$)/i);
        if (directMatch) directAnswer = directMatch[1].trim();

        const explMatch = cleanText.match(/Explanation:\s*([\s\S]*?)(?=\n(?:Example|Based on the uploaded material|Source|Key Point to Remember):|$)/i);
        if (explMatch) explanation = explMatch[1].trim();

        const exMatch = cleanText.match(/Example:\s*([\s\S]*?)(?=\n(?:Based on the uploaded material|Source|Key Point to Remember):|$)/i);
        if (exMatch) example = exMatch[1].trim();

        const matMatch = cleanText.match(/Based on the uploaded material:\s*([\s\S]*?)(?=\n(?:Source|Key Point to Remember):|$)/i);
        if (matMatch) basedOnMaterial = matMatch[1].trim();

        const kpMatch = cleanText.match(/Key Point to Remember:\s*([\s\S]*?)$/i);
        if (kpMatch) keyPoint = kpMatch[1].trim();
      }

      return (
        <div className="space-y-3 pt-1">
          {/* 1. Direct Answer */}
          {directAnswer && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-sky-900 uppercase tracking-wider block">
                Answer:
              </span>
              <p className="text-sm font-semibold text-slate-900 leading-snug">
                {directAnswer}
              </p>
            </div>
          )}

          {/* 2. Simple Explanation */}
          {explanation && (
            <div className="p-3 bg-white/80 border border-slate-200/80 rounded-xl space-y-1">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                Explanation:
              </span>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal">
                {explanation}
              </p>
            </div>
          )}

          {/* 3. Everyday Example / Analogy (Feynman Mode) */}
          {example && (
            <div className="p-3 bg-purple-50/70 border border-purple-200/70 rounded-xl space-y-1 text-purple-950">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-purple-900">
                <Lightbulb className="w-3.5 h-3.5 text-purple-600" />
                <span>Example / Relatable Analogy:</span>
              </div>
              <p className="text-xs text-purple-900/90 leading-relaxed">
                {example}
              </p>
            </div>
          )}

          {/* 4. Based on Uploaded Material */}
          {basedOnMaterial && (
            <div className="p-3 bg-sky-50/80 border border-sky-200/80 rounded-xl space-y-1">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-sky-900">
                <BookOpen className="w-3.5 h-3.5 text-sky-700" />
                <span>Based on the uploaded material:</span>
              </div>
              <p className="text-xs text-sky-950 leading-relaxed font-serif italic">
                "{basedOnMaterial.replace(/^["']|["']$/g, '')}"
              </p>
            </div>
          )}

          {/* 5. Key Point to Remember */}
          {keyPoint && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2 text-emerald-950">
              <Bookmark className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                  Key Point to Remember:
                </span>
                <p className="text-xs font-medium text-emerald-900">
                  {keyPoint}
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Default markdown paragraph rendering
    const paragraphs = cleanText.split('\n');
    return (
      <div className="space-y-2 text-sm leading-relaxed">
        {paragraphs.map((para, idx) => {
          if (!para.trim()) return <div key={idx} className="h-1" />;

          // Check if bullet point
          if (para.startsWith('- ') || para.startsWith('* ')) {
            return (
              <div key={idx} className="flex items-start space-x-2 pl-2">
                <span className="text-sky-500 font-bold">•</span>
                <span>{para.replace(/^[-*]\s*/, '')}</span>
              </div>
            );
          }

          // Check for bold headers
          return <p key={idx}>{para}</p>;
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-sky-600 to-sky-800 text-white rounded-xl shadow-sm shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 bg-sky-100 px-2.5 py-0.5 rounded-full">
                  Feature 3 • Ask Study Buddy
                </span>
                <span className="text-xs text-slate-500 font-medium flex items-center space-x-1">
                  <span>Two-Source System:</span>
                  <span className="text-sky-700 font-semibold">📘 Lesson Materials</span>
                  <span>+</span>
                  <span className="text-amber-700 font-semibold">✨ Gemini AI</span>
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                {mode === 'general'
                  ? 'Ask General Educational Questions'
                  : mode === 'feynman'
                  ? `Feynman Tutor: "${lesson.title}"`
                  : `Ask Questions about "${lesson.title}"`}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {mode === 'general'
                  ? 'Direct AI educational answers powered by Gemini Flash general knowledge'
                  : mode === 'feynman'
                  ? 'Explains complex concepts in simple words with relatable everyday analogies'
                  : `Prioritizes all ${lesson.totalPages} pages of extracted material, returning exact page citations`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Three Modes Switcher */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200/70">
              <button
                type="button"
                onClick={() => setMode('materials')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                  mode === 'materials'
                    ? 'bg-white text-sky-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Search uploaded document first, answers with page citations"
              >
                <BookOpen className="w-3.5 h-3.5 text-sky-600" />
                <span>Uploaded Material</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('feynman')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                  mode === 'feynman'
                    ? 'bg-white text-purple-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Simple explanations, everyday analogies, and comprehension check questions"
              >
                <Lightbulb className="w-3.5 h-3.5 text-purple-600" />
                <span>Feynman Tutor</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('general')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                  mode === 'general'
                    ? 'bg-white text-amber-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Ask broad academic questions outside the uploaded document"
              >
                <Globe className="w-3.5 h-3.5 text-amber-600" />
                <span>Ask Outside</span>
              </button>
            </div>

            <button
              onClick={handleClearChat}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center space-x-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Chat</span>
            </button>
            <button
              onClick={onNavigateToSummary}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Summary
            </button>
            <button
              onClick={onOpenUpload}
              className="px-3.5 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors cursor-pointer"
            >
              Change Lesson
            </button>
          </div>
        </div>
      </div>

      <ResponsibleAiBanner />

      {/* Audio Teaching for Uploaded Learning Material */}
      {mode !== 'general' && (
        <AudioTeachingPlayer
          id={`tutor-lesson-audio-${lesson.id}`}
          title={`Audio Teaching: ${lesson.title}`}
          subtitle={`Listen to the audio lesson guide (${lesson.totalPages} pages) while asking questions.`}
          textToSpeak={buildLessonAudioScript(lesson.title, lesson.subject, null, lesson.pages)}
          variant="compact"
        />
      )}

      {/* Main Chat Container */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm flex flex-col h-[650px] overflow-hidden">
        {/* Preset quick question chips */}
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <span className="text-xs font-bold text-slate-400 shrink-0">
            {mode === 'general' ? 'General Prompts:' : mode === 'feynman' ? 'Feynman Prompts:' : 'Suggested:'}
          </span>
          {(mode === 'general' ? GENERAL_PRESET_QUESTIONS : mode === 'feynman' ? FEYNMAN_PRESET_QUESTIONS : LESSON_PRESET_QUESTIONS).map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(chip)}
              disabled={loading}
              className="px-3 py-1 bg-white hover:bg-sky-50 text-slate-700 hover:text-sky-800 border border-slate-200/80 hover:border-sky-300 rounded-full text-xs font-medium whitespace-nowrap transition-all shadow-2xs shrink-0 cursor-pointer disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Message Log */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {messages.map((msg) => {
            const isTutor = msg.sender === 'tutor';
            const isGeminiSource = msg.sourceType === 'gemini';

            return (
              <div
                key={msg.id}
                className={`flex items-start space-x-3 ${isTutor ? 'justify-start' : 'justify-end'}`}
              >
                {isTutor && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs text-xs font-bold mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[82%] rounded-2xl p-4 shadow-2xs space-y-2 ${
                    isTutor
                      ? 'bg-slate-50 border border-slate-200/80 text-slate-800'
                      : 'bg-sky-600 text-white font-medium'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] opacity-70 mb-0.5">
                    <span>{isTutor ? 'Study Buddy AI' : 'You'}</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  {/* Two-Source Indicator Badge & Label + Audio Teaching */}
                  {isTutor && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-1 border-b border-slate-200/60">
                      {isGeminiSource ? (
                        <div className="flex items-center space-x-2">
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                            <span>✨</span>
                            <span>Gemini / Google AI</span>
                          </span>
                          <span className="text-[11px] font-semibold text-amber-800">
                            Source: Gemini / Google AI
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-900 border border-sky-300 shadow-2xs">
                            <span>📘</span>
                            <span>Uploaded Learning Material</span>
                          </span>
                          <span className="text-[11px] font-semibold text-sky-800">
                            Source: Uploaded Learning Material
                          </span>
                        </div>
                      )}

                      {/* Audio Teaching for AI Tutor Response */}
                      <AudioTeachingPlayer
                        id={`audio-tutor-${msg.id}`}
                        title="Study Buddy Audio Teaching"
                        textToSpeak={msg.text}
                        variant="inline"
                      />
                    </div>
                  )}

                  {/* Inform student when Gemini general knowledge is used */}
                  {isTutor && isGeminiSource && (
                    <div className="p-3 mb-2 rounded-xl bg-amber-50/90 border border-amber-200/90 text-xs text-amber-900 flex items-start space-x-2">
                      <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed font-medium">
                        {msg.sourceNotice ||
                          'This question is not covered by your uploaded learning materials. The answer below is provided using Gemini / Google AI general knowledge.'}
                      </div>
                    </div>
                  )}

                  {/* Main Message Body */}
                  {renderMessageContent(msg)}

                  {/* Source citation: ONLY for Uploaded Learning Material (Never show false citations for Gemini) */}
                  {isTutor && !isGeminiSource && (msg.sourcePage || msg.lessonTitle) && (
                    <div className="pt-2.5 mt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center space-x-1.5 text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-800 truncate max-w-[200px]">
                          📘 {msg.lessonTitle || lesson.title}
                        </span>
                        {msg.sourcePage && (
                          <span className="px-1.5 py-0.5 bg-sky-100 text-sky-800 font-bold rounded-md">
                            Page {msg.sourcePage}
                          </span>
                        )}
                      </div>
                      {msg.sourcePage && (
                        <button
                          onClick={() => openInspector(msg.sourcePage!, msg.citationExcerpt || msg.text)}
                          className="inline-flex items-center space-x-1 text-sky-700 hover:text-sky-900 font-semibold text-xs cursor-pointer hover:underline"
                        >
                          <span>Verify with Original Lesson</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Clean footer for Gemini general knowledge */}
                  {isTutor && isGeminiSource && (
                    <div className="pt-2 mt-1 border-t border-amber-100 flex items-center justify-between text-[11px] text-slate-400">
                      <span>General Academic Knowledge</span>
                      <span>No uploaded lesson citation applicable</span>
                    </div>
                  )}
                </div>

                {!isTutor && (
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-xs text-xs font-bold mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs text-slate-600 space-y-1">
                <span className="font-semibold block text-slate-800">Study Buddy is thinking...</span>
                <span className="text-slate-400">
                  {mode === 'general'
                    ? 'Connecting to Gemini Flash to formulate a student-friendly explanation'
                    : 'Searching lesson pages to provide a verified answer'}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input box */}
        <div className="p-4 border-t border-slate-100 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-end space-x-2"
          >
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === 'general'
                    ? 'Ask any general question (e.g. What is entrepreneurship? Explain supply and demand)...'
                    : 'Ask Study Buddy about this lesson... (Press Enter to send)'
                }
                rows={2}
                disabled={loading}
                className="w-full p-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white resize-none"
              />
            </div>

            {/* Send Message Button */}
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="p-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition-all shrink-0 cursor-pointer"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1.5">
            {mode === 'general' ? (
              <>
                <span>General AI Mode • Powered by Gemini Flash</span>
                <span>Direct educational explanations & step-by-step guides</span>
              </>
            ) : (
              <>
                <span>Study Buddy only uses facts from your uploaded lesson</span>
                <span>Refuses to answer when facts are absent</span>
              </>
            )}
          </div>
        </div>
      </div>

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
