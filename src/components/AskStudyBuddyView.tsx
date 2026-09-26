import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  BookOpen,
  ArrowRight,
  RotateCcw,
  CheckCircle,
} from 'lucide-react';
import { LessonDocument, ChatMessage } from '../types';
import { askStudyBuddy } from '../services/api';
import { ResponsibleAiBanner } from './ResponsibleAiBanner';
import { CitationModal } from './CitationModal';

interface AskStudyBuddyViewProps {
  lesson: LessonDocument;
  onNavigateToSummary: () => void;
  onOpenUpload: () => void;
}

const PRESET_QUESTIONS = [
  'Explain this lesson simply.',
  'Give me an example.',
  'Explain this step-by-step.',
  'What does this term mean?',
  'Create a practice question.',
];

export const AskStudyBuddyView: React.FC<AskStudyBuddyViewProps> = ({
  lesson,
  onNavigateToSummary,
  onOpenUpload,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'tutor',
      text: `Hello! I'm **Study Buddy**, your dedicated AI learning tutor. I have read **${lesson.title}** (${lesson.totalPages} pages).\n\nFeel free to ask me to break down difficult concepts, provide real-world examples, or create quick practice questions. Everything I share will be grounded strictly in your uploaded material with source citations!`,
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
      });

      const tutorMsg: ChatMessage = {
        id: `msg-tutor-${Date.now()}`,
        sender: 'tutor',
        text: res.answer,
        sourcePage: res.sourcePage,
        isSafeguardNotice: res.isSafeguardTriggered,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, tutorMsg]);
    } catch (err: any) {
      console.error('Tutor chat error:', err);
      const errorMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        sender: 'tutor',
        text: 'Sorry, I encountered a temporary connection issue. Please make sure your server is online and try asking again.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
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
        text: `Chat cleared! What would you like to review from **${lesson.title}**?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  // Helper to render message text with Markdown-style bold and bullet points
  const renderMessageContent = (text: string) => {
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

    // Split paragraphs and lines
    const paragraphs = text.split('\n');
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
                <span className="text-xs text-slate-400">Grounded AI Tutor</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Ask Questions about "{lesson.title}"
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Searching across {lesson.totalPages} pages of {lesson.subject}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5 shrink-0">
            <button
              onClick={handleClearChat}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Chat</span>
            </button>
            <button
              onClick={onNavigateToSummary}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Summary
            </button>
            <button
              onClick={onOpenUpload}
              className="px-3.5 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors"
            >
              Change Lesson
            </button>
          </div>
        </div>
      </div>

      <ResponsibleAiBanner />

      {/* Main Chat Container */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm flex flex-col h-[650px] overflow-hidden">
        {/* Preset quick question chips */}
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <span className="text-xs font-bold text-slate-400 shrink-0">Suggested:</span>
          {PRESET_QUESTIONS.map((chip, idx) => (
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

                  {renderMessageContent(msg.text)}

                  {/* If source page is cited, allow one-click verification */}
                  {msg.sourcePage && (
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-500">Source: Page {msg.sourcePage}</span>
                      <button
                        onClick={() => openInspector(msg.sourcePage!, msg.text)}
                        className="inline-flex items-center space-x-1 text-sky-700 hover:text-sky-900 font-semibold text-xs cursor-pointer hover:underline"
                      >
                        <span>Verify with Original Lesson</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
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
                <span className="text-slate-400">Searching lesson pages to provide a verified answer</span>
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
                placeholder="Ask Study Buddy about this lesson... (Press Enter to send)"
                rows={2}
                disabled={loading}
                className="w-full p-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white resize-none"
              />
            </div>
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
            <span>Study Buddy only uses facts from your uploaded lesson</span>
            <span>Refuses to answer when facts are absent</span>
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
