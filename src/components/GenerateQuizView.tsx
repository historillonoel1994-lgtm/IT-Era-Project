import React, { useState, useRef } from 'react';
import {
  HelpCircle,
  Sparkles,
  CheckCircle2,
  XCircle,
  RotateCcw,
  BookOpen,
  Award,
  ChevronRight,
  AlertCircle,
  ExternalLink,
  Sliders,
  TrendingUp,
  BookmarkCheck,
  Check,
  Loader2,
} from 'lucide-react';
import { LessonDocument, QuizQuestion, QuizResult, QuizUserAnswer } from '../types';
import { generateQuiz } from '../services/api';
import { saveQuizResult } from '../services/storage';
import {
  supabase,
  checkIsConfigured,
  getCurrentLearningMaterialId,
  toValidUuidOrNull,
  updateStudyProgressInSupabase,
  notifyDataChanged,
} from '../lib/supabase';
import { ResponsibleAiBanner } from './ResponsibleAiBanner';
import { CitationModal } from './CitationModal';

interface GenerateQuizViewProps {
  lesson: LessonDocument;
  onNavigateToSummary: () => void;
  onOpenUpload: () => void;
  onNavigateToProgress: () => void;
}

export const GenerateQuizView: React.FC<GenerateQuizViewProps> = ({
  lesson,
  onNavigateToSummary,
  onOpenUpload,
  onNavigateToProgress,
}) => {
  const isSavingQuizRef = useRef(false);
  // Quiz configuration
  const [questionCount, setQuestionCount] = useState<5 | 10 | 15>(5);
  const [quizType, setQuizType] = useState<'multiple_choice' | 'true_false' | 'mixed'>('mixed');
  const [quizFormat, setQuizFormat] = useState<'practice' | 'active_recall'>('practice');

  // Quiz state
  const [stage, setStage] = useState<'setup' | 'loading' | 'active' | 'completed'>('setup');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [userAnswers, setUserAnswers] = useState<QuizUserAnswer[]>([]);
  const [finalResult, setFinalResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quizSavedStatus, setQuizSavedStatus] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'unauthenticated'>('idle');
  const [quizSaveError, setQuizSaveError] = useState<string | null>(null);

  // Citation inspector modal
  const [inspectPage, setInspectPage] = useState<number | string | null>(null);
  const [inspectExcerpt, setInspectExcerpt] = useState<string | undefined>(undefined);

  const openInspector = (pageNumber: number | string, excerpt?: string) => {
    setInspectPage(pageNumber);
    setInspectExcerpt(excerpt);
  };

  const handleStartQuiz = async () => {
    setStage('loading');
    setError(null);
    try {
      const generated = await generateQuiz({
        pages: lesson.pages,
        lessonTitle: lesson.title,
        questionCount,
        quizType,
      });

      if (!generated || generated.length === 0) {
        throw new Error('No questions could be generated from the current material.');
      }

      setQuestions(generated);
      setCurrentIdx(0);
      setUserAnswers([]);
      setSelectedOption(null);
      setIsAnswerSubmitted(false);
      setStage('active');
    } catch (err: any) {
      console.error('Quiz generation error:', err);
      setError(err.message || 'Failed to generate quiz. Please try again.');
      setStage('setup');
    }
  };

  const handleOptionSelect = (option: string) => {
    if (isAnswerSubmitted) return;
    setSelectedOption(option);
  };

  const handleSubmitAnswer = () => {
    if (!selectedOption) return;
    const currentQ = questions[currentIdx];
    const isCorrect = selectedOption.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase();

    const record: QuizUserAnswer = {
      questionId: currentQ.id || `q-${currentIdx}`,
      question: currentQ.question,
      userAnswer: selectedOption,
      correctAnswer: currentQ.correctAnswer,
      isCorrect,
      explanation: currentQ.explanation,
      sourcePage: currentQ.sourcePage,
      topic: currentQ.topic || 'Lesson Concept',
    };

    const nextAnswers = [...userAnswers, record];
    setUserAnswers(nextAnswers);
    setIsAnswerSubmitted(true);
  };

  const handleNextQuestion = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelectedOption(null);
      setIsAnswerSubmitted(false);
    } else {
      // Complete Quiz
      finishQuiz(userAnswers);
    }
  };

  const finishQuiz = async (answers: QuizUserAnswer[]) => {
    if (isSavingQuizRef.current) return;
    isSavingQuizRef.current = true;

    const total = answers.length;
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const percentage = Math.round((correctCount / total) * 100);
    const questionsToReview = answers.filter((a) => !a.isCorrect);

    // Identify topics to review
    const topicSet = new Set<string>();
    questionsToReview.forEach((q) => {
      if (q.topic) topicSet.add(q.topic);
    });
    const topicsToReview = Array.from(topicSet);

    const result: QuizResult = {
      id: `quiz-result-${Date.now()}`,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      completedAt: new Date().toISOString(),
      totalQuestions: total,
      score: correctCount,
      percentage,
      answers,
      questionsToReview,
      topicsToReview,
    };

    saveQuizResult(result);
    setFinalResult(result);
    setStage('completed');
    setQuizSavedStatus('saving');
    setQuizSaveError(null);

    // 1. AUTHENTICATED USER
    if (!checkIsConfigured()) {
      setQuizSavedStatus('unauthenticated');
      setQuizSaveError('Please sign in to save your activity.');
      isSavingQuizRef.current = false;
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!user) {
      console.warn('Quiz DB error: User not authenticated', userError);
      setQuizSavedStatus('unauthenticated');
      setQuizSaveError('Please sign in to save your activity.');
      isSavingQuizRef.current = false;
      return;
    }

    // 4. QUIZ ATTEMPTS: Insert real row into quiz_attempts
    // Use: user_id, learning_material_id, score, total_questions
    let currentLearningMaterialId =
      toValidUuidOrNull(lesson.id) || toValidUuidOrNull(getCurrentLearningMaterialId());

    // If current learning material id is not a direct UUID, check if user has existing learning_materials
    if (!currentLearningMaterialId && user?.id) {
      try {
        const { data: mats } = await supabase
          .from('learning_materials')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (mats && mats.length > 0) {
          currentLearningMaterialId = mats[0].id;
        }
      } catch {
        // Continue with null if not found
      }
    }

    let { data: attempt, error: quizError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: user.id,
        learning_material_id: currentLearningMaterialId || null,
        score: correctCount,
        total_questions: total,
      })
      .select()
      .single();

    // If foreign key constraint failed on learning_material_id, retry with null
    if (quizError && (quizError.message?.includes('foreign key') || quizError.message?.includes('violates foreign key constraint') || quizError.code === '23503')) {
      console.warn('Retrying quiz_attempts insert with null learning_material_id...');
      const retry = await supabase
        .from('quiz_attempts')
        .insert({
          user_id: user.id,
          learning_material_id: null,
          score: correctCount,
          total_questions: total,
        })
        .select()
        .single();
      attempt = retry.data;
      quizError = retry.error;
    }

    if (quizError) {
      console.error('Quiz save failed:', quizError);
      console.error('Quiz DB error:', quizError);
      setQuizSavedStatus('failed');
      setQuizSaveError(quizError.message || 'Quiz database save failed');
      isSavingQuizRef.current = false;
      // DO NOT display "Saved".
    } else {
      // Only show the Saved badge after Supabase confirms success.
      setQuizSavedStatus('saved');
      setQuizSaveError(null);
      isSavingQuizRef.current = false;

      // Increment tasks_completed in study_progress
      updateStudyProgressInSupabase({ tasksCompletedDelta: 1 }).catch((err) =>
        console.error('Progress DB error:', err)
      );

      // Notify other views that Supabase data has been updated
      notifyDataChanged();
    }
  };

  const handleRetake = () => {
    isSavingQuizRef.current = false;
    setStage('setup');
    setSelectedOption(null);
    setIsAnswerSubmitted(false);
    setFinalResult(null);
    setUserAnswers([]);
    setQuizSavedStatus('idle');
    setQuizSaveError(null);
  };

  const currentQ = questions[currentIdx];
  const lastRecordedAnswer = userAnswers[currentIdx];

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-sky-600 to-indigo-800 text-white rounded-xl shadow-sm shrink-0">
              <HelpCircle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2.5 py-0.5 rounded-full">
                  Feature 2 • Generate Quiz
                </span>
                <span className="text-xs text-slate-400">Strictly grounded in lesson</span>
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
              onClick={onNavigateToSummary}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              View Lesson Summary
            </button>
            <button
              onClick={onOpenUpload}
              className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors"
            >
              Change Lesson
            </button>
          </div>
        </div>
      </div>

      <ResponsibleAiBanner />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-sm text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Quiz Error:</span>
            <p className="text-xs text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* SETUP STAGE */}
      {stage === 'setup' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-6 max-w-2xl mx-auto">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-indigo-50 text-indigo-700 rounded-2xl">
              <Sliders className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Custom Quiz Configuration</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Configure your practice test. Questions are generated exclusively from your uploaded lesson pages to test genuine retention without extraneous fluff.
            </p>
          </div>

          {/* Quiz Mode: Practice Quiz vs Active Recall Quiz */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Quiz Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setQuizFormat('practice')}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  quizFormat === 'practice'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-sm ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" />
                  <span className="text-xs font-bold text-slate-900">Practice Quiz</span>
                </div>
                <span className="text-[11px] text-slate-500 block mt-1">
                  Comprehensive test across all uploaded document sections.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setQuizFormat('active_recall')}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  quizFormat === 'active_recall'
                    ? 'border-purple-600 bg-purple-50/80 text-purple-950 shadow-sm ring-2 ring-purple-500/20'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-600" />
                  <span className="text-xs font-bold text-slate-900">Active Recall Quiz</span>
                </div>
                <span className="text-[11px] text-slate-500 block mt-1">
                  High-yield recall testing key terms, definitions & exam pointers.
                </span>
              </button>
            </div>
          </div>

          {/* Question Count */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Number of Questions
            </label>
            <div className="grid grid-cols-3 gap-3">
              {([5, 10, 15] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setQuestionCount(cnt)}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    questionCount === cnt
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 font-bold shadow-sm ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg block font-extrabold">{cnt}</span>
                  <span className="text-[11px] text-slate-500 font-medium">Questions</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quiz Type */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Quiz Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: 'multiple_choice', title: 'Multiple Choice', desc: '4 distinct options' },
                { id: 'true_false', title: 'True or False', desc: 'Binary verification' },
                { id: 'mixed', title: 'Mixed', desc: 'MC & T/F combined' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setQuizType(t.id as any)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    quizType === t.id
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-sm ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs font-bold block text-slate-900">{t.title}</span>
                  <span className="text-[11px] text-slate-500">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* AI Dilemma Safeguard Note */}
          <div className="p-4 bg-sky-50/80 border border-sky-200/70 rounded-xl text-xs text-sky-900 space-y-1">
            <div className="font-bold flex items-center space-x-1.5 text-sky-800">
              <Sparkles className="w-4 h-4 text-sky-600" />
              <span>Grounded AI Guarantee</span>
            </div>
            <p className="text-slate-600">
              Every question cites its authentic source page number. You can verify every answer immediately against the original lesson text.
            </p>
          </div>

          <button
            onClick={handleStartQuiz}
            className="w-full py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 text-sm"
          >
            <span>Generate & Start Quiz</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* LOADING STAGE */}
      {stage === 'loading' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-sm space-y-4">
          <div className="inline-flex p-4 bg-indigo-50 text-indigo-600 rounded-2xl animate-pulse">
            <Sparkles className="w-8 h-8 animate-spin" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900">
              Generating Grounded Questions...
            </h3>
            <p className="text-xs text-slate-500">
              Extracting facts from {lesson.title} ({questionCount} {quizType} questions with verified source pages).
            </p>
          </div>
        </div>
      )}

      {/* ACTIVE QUIZ STAGE */}
      {stage === 'active' && currentQ && (
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Progress bar */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-bold text-slate-400">
                Question {currentIdx + 1} of {questions.length}
              </span>
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full uppercase">
                {currentQ.type === 'true_false' ? 'True / False' : 'Multiple Choice'}
              </span>
            </div>

            <div className="w-32 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-6">
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Question {currentIdx + 1}
              </span>
              <h3 className="text-lg font-bold text-slate-900 leading-snug">
                {currentQ.question}
              </h3>
            </div>

            {/* Options */}
            <div className="space-y-2.5">
              {currentQ.options.map((option, optIdx) => {
                const isSelected = selectedOption === option;
                let optionStyle =
                  'border-slate-200 hover:border-sky-300 hover:bg-slate-50 text-slate-700';

                if (isAnswerSubmitted) {
                  const isCorrectAnswer =
                    option.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase();
                  if (isCorrectAnswer) {
                    optionStyle = 'border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold ring-2 ring-emerald-500/20';
                  } else if (isSelected && !isCorrectAnswer) {
                    optionStyle = 'border-red-400 bg-red-50 text-red-950';
                  } else {
                    optionStyle = 'border-slate-100 opacity-60 text-slate-400';
                  }
                } else if (isSelected) {
                  optionStyle =
                    'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold ring-2 ring-indigo-500/20';
                }

                return (
                  <button
                    key={optIdx}
                    type="button"
                    disabled={isAnswerSubmitted}
                    onClick={() => handleOptionSelect(option)}
                    className={`w-full p-4 rounded-xl border text-left flex items-center justify-between transition-all ${optionStyle}`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 rounded-full border border-current text-xs font-bold flex items-center justify-center shrink-0">
                        {String.fromCharCode(65 + optIdx)}
                      </span>
                      <span className="text-sm">{option}</span>
                    </div>

                    {isAnswerSubmitted && (
                      <div>
                        {option.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase() ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        ) : isSelected ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : null}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Answer Feedback Display */}
            {isAnswerSubmitted && lastRecordedAnswer && (
              <div
                className={`p-4 rounded-xl border space-y-2.5 animate-fadeIn ${
                  lastRecordedAnswer.isCorrect
                    ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                    : 'bg-red-50/90 border-red-200 text-red-950'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {lastRecordedAnswer.isCorrect ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span className="font-bold text-sm text-emerald-800">
                          Correct! Excellent retention.
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-5 h-5 text-red-600" />
                        <span className="font-bold text-sm text-red-800">
                          Incorrect. Correct answer: {currentQ.correctAnswer}
                        </span>
                      </>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      openInspector(currentQ.sourcePage, currentQ.citationExcerpt || currentQ.explanation)
                    }
                    className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-bold bg-white rounded-full shadow-sm hover:bg-slate-50 transition-colors text-slate-800 border border-slate-200"
                  >
                    <span>Source: Page {currentQ.sourcePage}</span>
                    <ExternalLink className="w-3 h-3 text-sky-600" />
                  </button>
                </div>

                <div className="text-xs leading-relaxed text-slate-700 bg-white/70 p-3 rounded-lg border border-slate-200/50">
                  <strong>Explanation:</strong> {currentQ.explanation}
                </div>

                {currentQ.citationExcerpt && (
                  <div className="text-[11px] text-slate-500 italic font-serif">
                    Lesson Quote: "{currentQ.citationExcerpt}"
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end space-x-3">
              {!isAnswerSubmitted ? (
                <button
                  onClick={handleSubmitAnswer}
                  disabled={!selectedOption}
                  className="px-6 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition-all"
                >
                  Submit Answer
                </button>
              ) : (
                <button
                  onClick={handleNextQuestion}
                  className="px-6 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm transition-all flex items-center space-x-1.5"
                >
                  <span>
                    {currentIdx < questions.length - 1 ? 'Next Question' : 'View Results'}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* COMPLETED RESULT STAGE */}
      {stage === 'completed' && finalResult && (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Result Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm text-center space-y-4">
            <div className="inline-flex p-4 bg-emerald-50 text-emerald-600 rounded-3xl">
              <Award className="w-10 h-10" />
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Quiz Result Completed
                </span>
                {quizSavedStatus === 'saved' && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Saved</span>
                  </span>
                )}
                {quizSavedStatus === 'saving' && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                    <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
                    <span>Saving...</span>
                  </span>
                )}
                {quizSavedStatus === 'unauthenticated' && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    <span>Please sign in to save your activity.</span>
                  </span>
                )}
                {quizSavedStatus === 'failed' && (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                    <AlertCircle className="w-3 h-3 text-red-600" />
                    <span>Save failed: {quizSaveError}</span>
                  </span>
                )}
              </div>
              <h3 className="text-3xl font-extrabold text-slate-900 mt-1">
                {finalResult.score} / {finalResult.totalQuestions} ({finalResult.percentage}%)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {finalResult.percentage >= 80
                  ? '🎉 Outstanding! You have mastered the key concepts in this lesson.'
                  : finalResult.percentage >= 60
                  ? '👍 Good progress! Review the flagged questions below before your exam.'
                  : '💡 Keep going! Take 10 minutes to review the lesson summary notes below.'}
              </p>
            </div>

            {/* Result stats row */}
            <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto pt-2">
              <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl">
                <span className="text-xs text-emerald-800 font-semibold block">Correct Answers</span>
                <span className="text-xl font-extrabold text-emerald-700">{finalResult.score}</span>
              </div>
              <div className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl">
                <span className="text-xs text-amber-800 font-semibold block">To Review</span>
                <span className="text-xl font-extrabold text-amber-700">
                  {finalResult.questionsToReview.length}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-center space-x-3 pt-3">
              <button
                onClick={handleRetake}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center space-x-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retake Quiz</span>
              </button>
              <button
                onClick={onNavigateToProgress}
                className="px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl flex items-center space-x-1.5 transition-colors"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>View in My Progress</span>
              </button>
            </div>
          </div>

          {/* Topics to Review */}
          {finalResult.topicsToReview.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
              <div className="flex items-center space-x-2">
                <span className="p-1 bg-amber-100 text-amber-800 rounded-md">
                  <BookmarkCheck className="w-4 h-4" />
                </span>
                <h4 className="text-sm font-bold text-slate-900">Topics to Review</h4>
              </div>
              <p className="text-xs text-slate-500">
                Focus on these subtopics during your next quick study session:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {finalResult.topicsToReview.map((topic, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg text-xs font-semibold"
                  >
                    • {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Questions to Review */}
          {finalResult.questionsToReview.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Questions to Review</h4>
                  <p className="text-xs text-slate-500">
                    Review why these answers are correct and check their textbook page
                  </p>
                </div>
                <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {finalResult.questionsToReview.length} Questions
                </span>
              </div>

              <div className="space-y-3">
                {finalResult.questionsToReview.map((rev, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-slate-800 text-sm">
                        {idx + 1}. {rev.question}
                      </span>
                      <button
                        onClick={() => openInspector(rev.sourcePage, rev.explanation)}
                        className="text-[11px] font-bold text-sky-700 hover:underline shrink-0"
                      >
                        Page {rev.sourcePage}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                      <div className="p-2 bg-red-50 border border-red-100 rounded text-red-900">
                        <span className="font-semibold block">Your Answer:</span>
                        {rev.userAnswer}
                      </div>
                      <div className="p-2 bg-emerald-50 border border-emerald-100 rounded text-emerald-900">
                        <span className="font-semibold block">Correct Answer:</span>
                        {rev.correctAnswer}
                      </div>
                    </div>

                    <p className="text-slate-600 bg-white p-2.5 rounded border border-slate-200/60 leading-relaxed">
                      <strong>Explanation:</strong> {rev.explanation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
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
