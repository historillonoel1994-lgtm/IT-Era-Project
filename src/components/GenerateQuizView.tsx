import React, { useState, useEffect, useRef } from 'react';
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
  Sliders,
  BookmarkCheck,
  Check,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Search,
  Flame,
  Scissors,
  Layers,
  Brain,
  Shuffle,
  ThumbsUp,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Send,
  FileText,
  Clock,
  GraduationCap,
  Target,
  FileQuestion,
} from 'lucide-react';
import {
  LessonDocument,
  ReviewerQuestion,
  ReviewerDifficulty,
  ReviewerQuestionType,
  ReviewerUserAnswer,
  ReviewerAttempt,
  DocumentChapter,
  FlashcardItem,
  ConceptContrastItem,
  MemorizationLevelProgress,
  QuizResult,
} from '../types';
import {
  generateSelfReviewer,
  analyzeDocumentChapters,
  generateFlashcards,
  generateConceptContrasts,
} from '../services/api';
import {
  saveReviewerAttempt,
  saveQuizResult,
  getFlashcardProgress,
  saveFlashcardProgress,
  getMemorizationProgress,
  saveMemorizationProgress,
  getStudentProgress,
} from '../services/storage';
import { SAMPLE_EXAM_TAKES } from '../data/precomputedData';
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
  lessons?: LessonDocument[];
  onSelectLesson?: (lesson: LessonDocument) => void;
  onNavigateToSummary: () => void;
  onOpenUpload: () => void;
  onNavigateToProgress: () => void;
}

export const GenerateQuizView: React.FC<GenerateQuizViewProps> = ({
  lesson,
  lessons = [],
  onSelectLesson,
  onNavigateToSummary,
  onOpenUpload,
  onNavigateToProgress,
}) => {
  const isSavingQuizRef = useRef(false);

  // Reviewer Sub-Navigation Tabs matching Screenshot 1:
  // ✂ Concept Contrasts | 📚 Flashcards | 🧠 Memorization (L1-L5) | ✨ Practice Exam
  const [activeReviewerTab, setActiveReviewerTab] = useState<
    'practice_exam' | 'flashcards' | 'contrasts' | 'memorization'
  >('practice_exam');

  // Search input state (Screenshot 1 top bar)
  const [searchQuery, setSearchQuery] = useState('');

  // 1. SELECT LEARNING MATERIAL
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(lesson.id);
  const [isMultiDocEnabled, setIsMultiDocEnabled] = useState<boolean>(false);
  const [selectedMultiDocIds, setSelectedMultiDocIds] = useState<string[]>([lesson.id]);

  // Active target lesson based on selection
  const currentTargetLesson =
    lessons.find((l) => l.id === selectedMaterialId) || lesson;

  // 2. SELECT CHAPTER SCOPE
  const [detectedChapters, setDetectedChapters] = useState<DocumentChapter[]>([]);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>(['all']);
  const [isAnalyzingChapters, setIsAnalyzingChapters] = useState<boolean>(false);

  // 3. NUMBER OF QUESTIONS (Default: 20 Questions)
  const [questionCount, setQuestionCount] = useState<10 | 20 | 30 | 50 | 100>(20);

  // 4. DIFFICULTY LEVEL (Default: Medium)
  const [difficulty, setDifficulty] = useState<ReviewerDifficulty>('medium');

  // 5. QUESTION TYPES (Default: Mixed)
  const [questionTypes, setQuestionTypes] = useState<ReviewerQuestionType>('mixed');

  // PRESERVED QUIZ MODES: Practice Quiz vs Active Recall Quiz
  const [quizMode, setQuizMode] = useState<'practice' | 'active_recall'>('practice');

  // Exam Taking & Review States
  const [stage, setStage] = useState<'setup' | 'loading' | 'active' | 'completed'>('setup');
  const [questions, setQuestions] = useState<ReviewerQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [userTextAnswer, setUserTextAnswer] = useState<string>('');
  const [showActiveRecallOptions, setShowActiveRecallOptions] = useState<boolean>(false);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState<boolean>(false);
  const [userAnswers, setUserAnswers] = useState<ReviewerUserAnswer[]>([]);
  const [finalResult, setFinalResult] = useState<ReviewerAttempt | null>(null);
  const [isPracticingMistakes, setIsPracticingMistakes] = useState<boolean>(false);

  // Status & Error
  const [error, setError] = useState<string | null>(null);
  const [insufficientNotice, setInsufficientNotice] = useState<string | null>(null);
  const [quizSavedStatus, setQuizSavedStatus] = useState<
    'idle' | 'saving' | 'saved' | 'failed' | 'unauthenticated'
  >('idle');
  const [quizSaveError, setQuizSaveError] = useState<string | null>(null);

  // Samples list display control (Limited to 4 with toggle)
  const [showAllSampleTakesList, setShowAllSampleTakesList] = useState<boolean>(false);
  const [showAllSampleTakesExpanded, setShowAllSampleTakesExpanded] = useState<boolean>(false);
  const [showAllReviewQuestions, setShowAllReviewQuestions] = useState<boolean>(false);
  const [expandedTakeId, setExpandedTakeId] = useState<string | null>(null);

  // Citation modal
  const [inspectPage, setInspectPage] = useState<number | string | null>(null);
  const [inspectExcerpt, setInspectExcerpt] = useState<string | undefined>(undefined);

  // TAB 2: FLASHCARDS STATE
  const [flashcards, setFlashcards] = useState<FlashcardItem[]>([]);
  const [currentFlashcardIdx, setCurrentFlashcardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [isLoadingFlashcards, setIsLoadingFlashcards] = useState(false);
  const [flashcardFilterChapter, setFlashcardFilterChapter] = useState<string>('all');
  const [cardStatusMap, setCardStatusMap] = useState<
    Record<string, 'mastered' | 'learning' | 'review_again'>
  >({});

  // TAB 3: CONCEPT CONTRASTS STATE
  const [contrasts, setContrasts] = useState<ConceptContrastItem[]>([]);
  const [isLoadingContrasts, setIsLoadingContrasts] = useState(false);

  // TAB 4: MEMORIZATION LEVELS STATE
  const [memorizationProgress, setMemorizationProgress] = useState<MemorizationLevelProgress>(
    getMemorizationProgress(lesson.id)
  );

  // Keep selectedMaterialId synced if prop changes
  useEffect(() => {
    setSelectedMaterialId(lesson.id);
  }, [lesson.id]);

  // Detect and populate chapters whenever target lesson changes
  useEffect(() => {
    let isMounted = true;

    const buildDefaultChapters = (doc: LessonDocument): DocumentChapter[] => {
      const isLunaBook =
        doc.title.toLowerCase().includes('lloyd') ||
        doc.title.toLowerCase().includes('ged 101') ||
        doc.subject.toLowerCase().includes('humanities') ||
        doc.totalPages >= 9;

      if (isLunaBook) {
        return [
          { id: 'ch-1', title: 'Chapter 1: Self-Awareness & Foundations', startPage: 1, endPage: 2, topics: ['Core Identity', 'Internal Drive', 'Self-Concept'] },
          { id: 'ch-2', title: 'Chapter 2: Strategic Goal Setting & Vision', startPage: 3, endPage: 4, topics: ['Long-term Vision', 'Milestones', 'Purpose'] },
          { id: 'ch-3', title: 'Chapter 3: Overcoming Barriers & Resilience', startPage: 5, endPage: 6, topics: ['Adversity Quotient', 'Grit', 'Mindset'] },
          { id: 'ch-4', title: 'Chapter 4: Emotional Intelligence & Empathy', startPage: 7, endPage: 8, topics: ['Self-Regulation', 'Active Empathy', 'Social Fluency'] },
          { id: 'ch-5', title: 'Chapter 5: Effective Communication Skills', startPage: 9, endPage: 10, topics: ['Verbal Articulation', 'Active Listening', 'Non-Verbal'] },
          { id: 'ch-6', title: 'Chapter 6: Leadership & Influence', startPage: 11, endPage: 12, topics: ['Ethical Influence', 'Leading by Example', 'Mentorship'] },
          { id: 'ch-7', title: 'Chapter 7: Collaborative Team Dynamics', startPage: 13, endPage: 14, topics: ['Synergy', 'Conflict Resolution', 'Accountability'] },
          { id: 'ch-8', title: 'Chapter 8: Time Mastery & Integration', startPage: 15, endPage: 16, topics: ['Prioritization', 'Work-Life Alignment', 'Focus'] },
          { id: 'ch-9', title: 'Chapter 9: Lifelong Learning & Mastery', startPage: 17, endPage: 18, topics: ['Continuous Improvement', 'Self-Audit', 'Legacy'] },
        ];
      }

      // Dynamic chapter slicing for any arbitrary document
      const pagesCount = doc.pages.length || doc.totalPages || 1;
      if (pagesCount <= 3) {
        return [
          { id: 'ch-1', title: 'Section 1: Core Fundamentals & Principles', startPage: 1, endPage: 1, topics: ['Terminology', 'Key Definitions'] },
          { id: 'ch-2', title: 'Section 2: Conceptual Frameworks & Models', startPage: Math.min(2, pagesCount), endPage: Math.min(2, pagesCount), topics: ['Frameworks', 'Mechanisms'] },
          { id: 'ch-3', title: 'Section 3: Applications & Exam Synthesis', startPage: pagesCount, endPage: pagesCount, topics: ['Case Analysis', 'Takeaways'] },
        ];
      }

      const numSections = Math.min(pagesCount, 6);
      const chapters: DocumentChapter[] = [];
      const step = Math.ceil(pagesCount / numSections);
      for (let i = 0; i < numSections; i++) {
        const start = i * step + 1;
        const end = Math.min((i + 1) * step, pagesCount);
        chapters.push({
          id: `ch-${i + 1}`,
          title: `Chapter ${i + 1}: Pages ${start}–${end}`,
          startPage: start,
          endPage: end,
          topics: [`Section ${i + 1} Concepts`, 'Key Terms', 'Analysis'],
        });
      }
      return chapters;
    };

    const initialChapters = buildDefaultChapters(currentTargetLesson);
    setDetectedChapters(initialChapters);
    setSelectedChapterIds(['all']);

    // Attempt AI-driven chapter analysis in background to extract refined syllabus titles
    const fetchChapters = async () => {
      if (!currentTargetLesson.pages || currentTargetLesson.pages.length === 0) return;
      setIsAnalyzingChapters(true);
      try {
        const analyzed = await analyzeDocumentChapters({
          pages: currentTargetLesson.pages,
          lessonTitle: currentTargetLesson.title,
        });
        if (isMounted && analyzed && analyzed.length > 0) {
          setDetectedChapters(analyzed);
        }
      } catch (err) {
        // Fallback remains active
      } finally {
        if (isMounted) setIsAnalyzingChapters(false);
      }
    };

    fetchChapters();

    // Load persisted flashcard and memorization records
    setCardStatusMap(getFlashcardProgress(currentTargetLesson.id));
    setMemorizationProgress(getMemorizationProgress(currentTargetLesson.id));

    return () => {
      isMounted = false;
    };
  }, [currentTargetLesson.id]);

  // Load flashcards when Flashcards tab is opened
  useEffect(() => {
    if (activeReviewerTab === 'flashcards' && flashcards.length === 0) {
      let isMounted = true;
      setIsLoadingFlashcards(true);
      generateFlashcards({
        pages: currentTargetLesson.pages,
        lessonTitle: currentTargetLesson.title,
      })
        .then((cards) => {
          if (isMounted && cards && cards.length > 0) {
            setFlashcards(cards);
          }
        })
        .catch(() => {
          // Keep default fallback cards
        })
        .finally(() => {
          if (isMounted) setIsLoadingFlashcards(false);
        });
      return () => {
        isMounted = false;
      };
    }
  }, [activeReviewerTab, currentTargetLesson.id]);

  // Load concept contrasts when Contrasts tab is opened
  useEffect(() => {
    if (activeReviewerTab === 'contrasts' && contrasts.length === 0) {
      let isMounted = true;
      setIsLoadingContrasts(true);
      generateConceptContrasts({
        pages: currentTargetLesson.pages,
        lessonTitle: currentTargetLesson.title,
      })
        .then((items) => {
          if (isMounted && items && items.length > 0) {
            setContrasts(items);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isMounted) setIsLoadingContrasts(false);
        });
      return () => {
        isMounted = false;
      };
    }
  }, [activeReviewerTab, currentTargetLesson.id]);

  // Citation inspection
  const openInspector = (pageNumber: number | string, excerpt?: string) => {
    setInspectPage(pageNumber);
    setInspectExcerpt(excerpt);
  };

  // Switch learning material
  const handleMaterialChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const chosen = lessons.find((l) => l.id === matId);
    if (chosen && onSelectLesson) {
      onSelectLesson(chosen);
    }
    // Reset generation state
    setStage('setup');
    setError(null);
    setInsufficientNotice(null);
    setQuestions([]);
    setFlashcards([]);
    setContrasts([]);
  };

  // Chapter Scope Selection Handler
  const handleToggleChapter = (chapterId: string) => {
    if (chapterId === 'all') {
      setSelectedChapterIds(['all']);
      return;
    }

    if (selectedChapterIds.includes('all')) {
      setSelectedChapterIds([chapterId]);
    } else {
      if (selectedChapterIds.includes(chapterId)) {
        const filtered = selectedChapterIds.filter((id) => id !== chapterId);
        setSelectedChapterIds(filtered.length === 0 ? ['all'] : filtered);
      } else {
        setSelectedChapterIds([...selectedChapterIds, chapterId]);
      }
    }
  };

  // GENERATE & START QUIZ HANDLER
  const handleStartQuiz = async () => {
    setStage('loading');
    setError(null);
    setInsufficientNotice(null);

    try {
      // Gather pages from target lesson (or multi-doc if enabled)
      let targetPages = currentTargetLesson.pages;
      if (isMultiDocEnabled && selectedMultiDocIds.length > 1) {
        targetPages = lessons
          .filter((l) => selectedMultiDocIds.includes(l.id))
          .flatMap((l) => l.pages);
      }

      // Filter pages by chapter range if not "all"
      let startPage: number | undefined;
      let endPage: number | undefined;
      if (!selectedChapterIds.includes('all') && selectedChapterIds.length > 0) {
        const chosen = detectedChapters.filter((c) => selectedChapterIds.includes(c.id));
        if (chosen.length > 0) {
          startPage = Math.min(...chosen.map((c) => c.startPage));
          endPage = Math.max(...chosen.map((c) => c.endPage));
        }
      }

      const chapterScopeLabel = selectedChapterIds.includes('all')
        ? 'All Chapters'
        : selectedChapterIds
            .map((id) => detectedChapters.find((c) => c.id === id)?.title || id)
            .join(', ');

      const res = await generateSelfReviewer({
        pages: targetPages,
        lessonTitle: currentTargetLesson.title,
        chapterId: chapterScopeLabel,
        startPage,
        endPage,
        questionCount,
        difficulty,
        questionTypes,
      });

      if (!res.success && res.insufficient) {
        setInsufficientNotice(
          res.message ||
            `Insufficient content in selected section for ${questionCount} questions. Please select more chapters or reduce the question count.`
        );
        setStage('setup');
        return;
      }

      if (!res.questions || res.questions.length === 0) {
        throw new Error('No questions could be generated from the selected scope.');
      }

      setQuestions(res.questions);
      setCurrentIdx(0);
      setUserAnswers([]);
      setSelectedOption(null);
      setUserTextAnswer('');
      setShowActiveRecallOptions(false);
      setIsAnswerSubmitted(false);
      setIsPracticingMistakes(false);
      setStage('active');
    } catch (err: any) {
      console.error('Quiz generation error:', err);
      setError(err.message || 'Failed to generate quiz. Please check your connection and try again.');
      setStage('setup');
    }
  };

  // Submit answer for active question
  const handleSubmitAnswer = () => {
    const currentQ = questions[currentIdx];
    let submittedAnswer = '';

    if (currentQ.type === 'multiple_choice' || currentQ.type === 'true_false') {
      if (!selectedOption) return;
      submittedAnswer = selectedOption.trim();
    } else {
      if (!userTextAnswer.trim()) return;
      submittedAnswer = userTextAnswer.trim();
    }

    const normSubmitted = submittedAnswer.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normCorrect = (currentQ.correctAnswer || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    let isCorrect = false;
    if (currentQ.type === 'multiple_choice' || currentQ.type === 'true_false') {
      isCorrect = submittedAnswer.toLowerCase() === currentQ.correctAnswer.toLowerCase();
    } else if (currentQ.type === 'short_answer') {
      // Short answer assesses meaning: check keywords or core concept match
      const words = normCorrect.split(/\s+/).filter((w) => w.length > 3);
      const matched = words.filter((w) => normSubmitted.includes(w));
      isCorrect = matched.length >= Math.min(2, words.length) || normSubmitted.includes(normCorrect) || normCorrect.includes(normSubmitted);
    } else {
      // Identification / Fill in the blank: exact or core substring match
      isCorrect = normSubmitted === normCorrect || normSubmitted.includes(normCorrect) || normCorrect.includes(normSubmitted);
    }

    const record: ReviewerUserAnswer = {
      questionId: currentQ.id || `q-${currentIdx}`,
      question: currentQ.question,
      userAnswer: submittedAnswer,
      correctAnswer: currentQ.correctAnswer,
      isCorrect,
      explanation: currentQ.explanation,
      sourcePage: currentQ.sourcePage,
      chapterOrSection: currentQ.chapterOrSection,
      citationExcerpt: currentQ.citationExcerpt,
      isSupplementary: currentQ.isSupplementary,
    };

    setUserAnswers([...userAnswers, record]);
    setIsAnswerSubmitted(true);
  };

  // Move to next question or complete exam
  const handleNextQuestion = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelectedOption(null);
      setUserTextAnswer('');
      setShowActiveRecallOptions(false);
      setIsAnswerSubmitted(false);
    } else {
      finishExam(userAnswers);
    }
  };

  // Complete exam and record in Supabase
  const finishExam = async (completedAnswers: ReviewerUserAnswer[]) => {
    if (isSavingQuizRef.current) return;
    isSavingQuizRef.current = true;

    const total = completedAnswers.length;
    const correctCount = completedAnswers.filter((a) => a.isCorrect).length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const questionsToReview = completedAnswers.filter((a) => !a.isCorrect);

    const topicSet = new Set<string>();
    questionsToReview.forEach((q) => {
      if (q.chapterOrSection) topicSet.add(q.chapterOrSection);
    });
    const topicsToReview = Array.from(topicSet);

    const attempt: ReviewerAttempt = {
      id: `reviewer-attempt-${Date.now()}`,
      lessonId: currentTargetLesson.id,
      lessonTitle: currentTargetLesson.title,
      chapterOrSection: selectedChapterIds.join(', '),
      difficulty,
      mode: quizMode === 'active_recall' ? 'practice' : 'exam',
      questionCount: total,
      score: correctCount,
      percentage,
      completedAt: new Date().toISOString(),
      answers: completedAnswers,
      questionsToReview,
      topicsToReview,
    };

    // Save locally
    saveReviewerAttempt(attempt);

    // Also sync to standard QuizResult
    const quizResult: QuizResult = {
      id: attempt.id,
      lessonId: attempt.lessonId,
      lessonTitle: attempt.lessonTitle,
      completedAt: attempt.completedAt,
      totalQuestions: attempt.questionCount,
      score: attempt.score,
      percentage: attempt.percentage,
      answers: completedAnswers.map((a) => ({
        ...a,
        topic: a.chapterOrSection || 'Lesson Concept',
      })),
      questionsToReview: questionsToReview.map((a) => ({
        ...a,
        topic: a.chapterOrSection || 'Lesson Concept',
      })),
      topicsToReview,
    };
    saveQuizResult(quizResult);

    setFinalResult(attempt);
    setStage('completed');
    setQuizSavedStatus('saving');
    setQuizSaveError(null);

    // Supabase database persistence
    if (!checkIsConfigured()) {
      setQuizSavedStatus('unauthenticated');
      setQuizSaveError('Sign in with Supabase to persist your attempts across devices.');
      isSavingQuizRef.current = false;
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user) {
        setQuizSavedStatus('unauthenticated');
        setQuizSaveError('Sign in to save your score to your permanent student record.');
        isSavingQuizRef.current = false;
        return;
      }

      let validMaterialId =
        toValidUuidOrNull(currentTargetLesson.id) ||
        toValidUuidOrNull(getCurrentLearningMaterialId());

      if (!validMaterialId) {
        const { data: mats } = await supabase
          .from('learning_materials')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (mats && mats.length > 0) {
          validMaterialId = mats[0].id;
        }
      }

      const { error: quizError } = await supabase.from('quiz_attempts').insert({
        user_id: user.id,
        learning_material_id: validMaterialId || null,
        score: correctCount,
        total_questions: total,
      });

      if (quizError) {
        console.warn('Supabase quiz insert error, retrying without fk:', quizError);
        await supabase.from('quiz_attempts').insert({
          user_id: user.id,
          learning_material_id: null,
          score: correctCount,
          total_questions: total,
        });
      }

      // Update study progress in Supabase
      await updateStudyProgressInSupabase({
        tasksCompletedDelta: 1,
        verifiedPagesDelta: completedAnswers.length,
      });

      notifyDataChanged();
      setQuizSavedStatus('saved');
    } catch (err: any) {
      console.error('Supabase persistence error:', err);
      setQuizSavedStatus('failed');
      setQuizSaveError(err.message || 'Failed to save to database');
    } finally {
      isSavingQuizRef.current = false;
    }
  };

  // Practice incorrect questions only
  const handlePracticeIncorrectAnswers = () => {
    if (!finalResult || finalResult.questionsToReview.length === 0) return;

    const mistakeQuestions: ReviewerQuestion[] = finalResult.questionsToReview.map((rev) => {
      const original = questions.find((q) => q.question === rev.question);
      return {
        id: `retry-${rev.questionId}`,
        type: original?.type || 'mixed',
        difficulty,
        question: rev.question,
        options: original?.options || ['Option A', 'Option B', 'Option C', 'Option D'],
        correctAnswer: rev.correctAnswer,
        explanation: rev.explanation,
        sourcePage: rev.sourcePage,
        chapterOrSection: rev.chapterOrSection,
        citationExcerpt: rev.citationExcerpt,
      };
    });

    setQuestions(mistakeQuestions);
    setCurrentIdx(0);
    setUserAnswers([]);
    setSelectedOption(null);
    setUserTextAnswer('');
    setShowActiveRecallOptions(false);
    setIsAnswerSubmitted(false);
    setIsPracticingMistakes(true);
    setStage('active');
  };

  // Retake entire exam
  const handleRetakeExam = () => {
    setCurrentIdx(0);
    setUserAnswers([]);
    setSelectedOption(null);
    setUserTextAnswer('');
    setShowActiveRecallOptions(false);
    setIsAnswerSubmitted(false);
    setIsPracticingMistakes(false);
    setStage('active');
  };

  // Flashcards handlers
  const handleFlashcardStatus = (status: 'mastered' | 'learning' | 'review_again') => {
    const card = flashcards[currentFlashcardIdx];
    if (!card) return;
    const nextMap = { ...cardStatusMap, [card.id]: status };
    setCardStatusMap(nextMap);
    saveFlashcardProgress(currentTargetLesson.id, nextMap);
    if (currentFlashcardIdx < flashcards.length - 1) {
      setCurrentFlashcardIdx(currentFlashcardIdx + 1);
      setIsCardFlipped(false);
    }
  };

  const handleShuffleFlashcards = () => {
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5);
    setFlashcards(shuffled);
    setCurrentFlashcardIdx(0);
    setIsCardFlipped(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & METADATA BAR (Matching Screenshot 1) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-800 bg-sky-100 border border-sky-200/60 px-2.5 py-0.5 rounded-full">
                Self-Reviewer & Practice Exam
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {currentTargetLesson.totalPages}{' '}
                {currentTargetLesson.fileType === 'pptx' ? 'Slides' : 'Pages'} Extracted
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {currentTargetLesson.title}
            </h2>
            <p className="text-xs text-slate-500">
              GED 101 • CH. 1–{detectedChapters.length || 9} • Grounded in original student material
            </p>
          </div>

          {/* Search bar & streak indicator (Screenshot 1 top right) */}
          <div className="flex items-center space-x-3 shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search terms, definitions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 w-48 sm:w-64"
              />
            </div>

            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200/80 text-amber-800 rounded-xl text-xs font-bold shrink-0">
              <Flame className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span>1 day</span>
            </div>
          </div>
        </div>

        {/* REVIEWER SUB-NAVIGATION TABS (Screenshot 1 Order) */}
        <div className="flex items-center space-x-2 border-t border-slate-100 pt-3 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveReviewerTab('contrasts')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeReviewerTab === 'contrasts'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Concept Contrasts</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReviewerTab('flashcards')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeReviewerTab === 'flashcards'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Flashcards</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReviewerTab('memorization')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeReviewerTab === 'memorization'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span>Memorization (L1–L5)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveReviewerTab('practice_exam')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center space-x-2 transition-all cursor-pointer shrink-0 ${
              activeReviewerTab === 'practice_exam'
                ? 'bg-red-800 text-white shadow-md ring-2 ring-red-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Practice Exam</span>
          </button>
        </div>
      </div>

      <ResponsibleAiBanner />

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-sm text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Reviewer Notice:</span>
            <p className="text-xs text-red-700">{error}</p>
          </div>
        </div>
      )}

      {insufficientNotice && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-3 text-sm text-amber-900">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">Content Validation Notice:</span>
            <p className="text-xs text-amber-800">{insufficientNotice}</p>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: PRACTICE EXAM (THE COMPLETE QUIZ CONFIGURATION) */}
      {/* ============================================================== */}
      {activeReviewerTab === 'practice_exam' && (
        <>
          {stage === 'setup' && (
            <div className="space-y-6">
              {/* QUIZ MODE SWITCHER (ABOVE THE CONFIGURATION AS REQUESTED) */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-4 h-4 text-slate-700" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Quiz Mode
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-semibold">
                    CHOOSE STUDY DELIVERY
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setQuizMode('practice')}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      quizMode === 'practice'
                        ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-sm ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                      <span className="text-sm font-bold text-slate-900">Practice Quiz</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Comprehensive test across all selected document sections with immediate feedback.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQuizMode('active_recall')}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      quizMode === 'active_recall'
                        ? 'border-purple-600 bg-purple-50/80 text-purple-950 shadow-sm ring-2 ring-purple-500/20'
                        : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                      <span className="text-sm font-bold text-slate-900">Active Recall Quiz</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      High-yield recall testing key terms, definitions & exam pointers without visible answers.
                    </p>
                  </button>
                </div>
              </div>

              {/* MAIN CONFIGURATION CARD - EXACT ORDER SPECIFIED */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-8">
                {/* -------------------------------------------------------- */}
                {/* SECTION 1: SELECT LEARNING MATERIAL */}
                {/* -------------------------------------------------------- */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
                      <span className="text-sky-700">1.</span>
                      <span>SELECT LEARNING MATERIAL</span>
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      CHOOSE COURSE DOCUMENT
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="lg:col-span-2 space-y-2">
                      <select
                        value={selectedMaterialId}
                        onChange={(e) => handleMaterialChange(e.target.value)}
                        className="w-full p-3.5 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer shadow-2xs"
                      >
                        {lessons.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} ({item.totalPages}{' '}
                            {item.fileType === 'pptx' ? 'Slides' : 'Pages'}) • {item.subject}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center justify-between text-xs px-1 text-slate-500">
                        <span>
                          Current: <strong className="text-slate-800">{currentTargetLesson.title}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={onOpenUpload}
                          className="text-sky-700 font-bold hover:underline cursor-pointer"
                        >
                          + Upload Another File
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700">Multi-Document Review:</span>
                        <input
                          type="checkbox"
                          id="multi-doc-toggle"
                          checked={isMultiDocEnabled}
                          onChange={(e) => setIsMultiDocEnabled(e.target.checked)}
                          className="w-4 h-4 text-sky-600 rounded cursor-pointer"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">
                        {isMultiDocEnabled
                          ? 'Combine multiple uploaded materials into one comprehensive examination.'
                          : 'Disabled: All questions generated exclusively from selected document.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* SECTION 2: SELECT CHAPTER SCOPE (Exact Screenshot 1 design) */}
                {/* -------------------------------------------------------- */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
                      <span className="text-sky-700">2.</span>
                      <span>SELECT CHAPTER SCOPE</span>
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      ALL {detectedChapters.length || 9} CHAPTERS OR INDIVIDUAL
                    </span>
                  </div>

                  <p className="text-xs text-slate-500">
                    Automatically extracted from your document. Select one chapter, multiple chapters, or all chapters:
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                    {/* All Chapters Button (Screenshot 1 bold crimson button) */}
                    <button
                      type="button"
                      onClick={() => handleToggleChapter('all')}
                      className={`p-3 rounded-2xl text-center text-xs font-bold transition-all cursor-pointer shadow-xs ${
                        selectedChapterIds.includes('all')
                          ? 'bg-red-800 text-white shadow-md ring-2 ring-red-700/50'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      }`}
                    >
                      <span className="block font-black">All Chapters</span>
                      <span className="text-[10px] opacity-80 font-normal">
                        (1–{detectedChapters.length || 9})
                      </span>
                    </button>

                    {/* Individual Chapter Buttons */}
                    {detectedChapters.map((ch, idx) => {
                      const isSelected =
                        !selectedChapterIds.includes('all') &&
                        selectedChapterIds.includes(ch.id);

                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => handleToggleChapter(ch.id)}
                          className={`p-3 rounded-2xl text-center text-xs font-semibold transition-all cursor-pointer truncate ${
                            isSelected
                              ? 'bg-slate-900 text-white font-bold shadow-md ring-2 ring-slate-800'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                          }`}
                          title={ch.title}
                        >
                          <span className="block truncate font-bold">
                            Chapter {idx + 1}
                          </span>
                          <span className="text-[10px] opacity-70 block truncate">
                            p.{ch.startPage}–{ch.endPage}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* SECTION 3: NUMBER OF QUESTIONS (Exact Screenshot 1 design) */}
                {/* -------------------------------------------------------- */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
                      <span className="text-sky-700">3.</span>
                      <span>QUESTION COUNT</span>
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      FROM QUICK QUIZ TO FULL MOCK
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    {([10, 20, 30, 50, 100] as const).map((cnt) => {
                      const isSelected = questionCount === cnt;
                      return (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setQuestionCount(cnt)}
                          className={`p-3.5 rounded-2xl text-center transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-slate-900 text-white font-black shadow-md ring-2 ring-slate-900'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                          }`}
                        >
                          <span className="text-base block font-black">{cnt} Questions</span>
                          {cnt === 100 ? (
                            <span className="text-[10px] text-amber-300 font-bold block">
                              Ultimate Mock
                            </span>
                          ) : (
                            <span className="text-[10px] opacity-70 block font-medium">
                              Standard Review
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* SECTION 4: DIFFICULTY LEVEL (Exact Screenshot 1 design) */}
                {/* -------------------------------------------------------- */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
                      <span className="text-sky-700">4.</span>
                      <span>DIFFICULTY LEVEL</span>
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      ACADEMIC TONE & CHALLENGE
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                    {[
                      {
                        id: 'easy' as const,
                        title: 'Easy',
                        desc: 'Direct recall',
                        detail: 'Direct recall of facts & definitions.',
                      },
                      {
                        id: 'medium' as const,
                        title: 'Medium',
                        desc: 'Concepts & definitions',
                        detail: 'Conceptual understanding & application.',
                      },
                      {
                        id: 'hard' as const,
                        title: 'Hard',
                        desc: 'Contrasts & tricky terms',
                        detail: 'Comparisons, trade-offs & analytical thinking.',
                      },
                      {
                        id: 'professor' as const,
                        title: 'Professor Mode',
                        desc: '🏛 College-level exams',
                        detail: 'Challenging scenarios & critical analysis.',
                      },
                    ].map((lvl) => {
                      const isSelected = difficulty === lvl.id;
                      const isProfessor = lvl.id === 'professor';

                      return (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() => setDifficulty(lvl.id)}
                          className={`p-4 rounded-2xl text-left transition-all cursor-pointer space-y-1 ${
                            isSelected
                              ? isProfessor
                                ? 'bg-red-900 text-white font-bold shadow-md ring-2 ring-red-800'
                                : 'bg-slate-900 text-white font-bold shadow-md ring-2 ring-slate-900'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black block">{lvl.title}</span>
                            {isSelected && <Check className="w-4 h-4 text-emerald-300" />}
                          </div>
                          <span className="text-xs block font-semibold opacity-90">
                            {lvl.desc}
                          </span>
                          <p className="text-[11px] opacity-75 leading-tight pt-1">
                            {lvl.detail}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* SECTION 5: QUESTION TYPES (Exact 8 options from Screenshot 1) */}
                {/* -------------------------------------------------------- */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
                      <span className="text-sky-700">5.</span>
                      <span>QUESTION TYPES</span>
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      CHOOSE FORMAT
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { id: 'mixed' as const, title: 'Mixed (Recommended)', desc: 'Balanced combination' },
                      { id: 'multiple_choice' as const, title: 'Multiple Choice', desc: '4 plausible options' },
                      { id: 'fill_in_the_blank' as const, title: 'Fill in the Blank', desc: 'Missing exact term' },
                      { id: 'identification' as const, title: 'Identification', desc: 'Identify concept or law' },
                      { id: 'true_false' as const, title: 'True or False', desc: 'Binary verification' },
                      { id: 'concept_contrasts' as const, title: 'Concept Contrasts', desc: 'Compare distinctions' },
                      { id: 'scenario' as const, title: 'Scenario Questions', desc: 'Realistic situations' },
                      { id: 'short_answer' as const, title: 'Short Answer', desc: 'Conceptual explanation' },
                    ].map((fmt) => {
                      const isSelected = questionTypes === fmt.id;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() => setQuestionTypes(fmt.id)}
                          className={`p-3.5 rounded-2xl text-left transition-all cursor-pointer space-y-0.5 ${
                            isSelected
                              ? 'bg-slate-900 text-white font-bold shadow-md ring-2 ring-slate-900'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                          }`}
                        >
                          <span className="text-xs font-black block">{fmt.title}</span>
                          <span className="text-[10px] opacity-70 block">{fmt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* GENERATE AND START QUIZ BUTTON */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleStartQuiz}
                    className="w-full py-4 bg-gradient-to-r from-red-800 via-slate-900 to-indigo-900 hover:from-red-900 hover:to-indigo-950 text-white font-black rounded-2xl shadow-lg transition-all flex items-center justify-center space-x-2.5 text-base cursor-pointer transform hover:-translate-y-0.5"
                  >
                    <Sparkles className="w-5 h-5 text-amber-300" />
                    <span>Generate & Start Quiz</span>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* PRE-COMPLETED EXAM TAKES HISTORY (Preserved 4-result limit with full toggle) */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                      <Award className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full">
                          Verified Mastery History
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {SAMPLE_EXAM_TAKES.length > 4 && !showAllSampleTakesList
                            ? `Showing 4 of ${SAMPLE_EXAM_TAKES.length} Exam Takes`
                            : '4 Samples Available'}
                        </span>
                      </div>
                      <h4 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                        Sample Exam Takes & Mastery Breakdown
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {SAMPLE_EXAM_TAKES.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setShowAllSampleTakesList((prev) => !prev)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
                      >
                        {showAllSampleTakesList ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>Limit to 4 Results</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>Open to View Full List ({SAMPLE_EXAM_TAKES.length})</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowAllSampleTakesExpanded((prev) => !prev)}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-xs cursor-pointer"
                    >
                      {showAllSampleTakesExpanded ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Collapse All</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Open All Exam Takes</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {(showAllSampleTakesList ? SAMPLE_EXAM_TAKES : SAMPLE_EXAM_TAKES.slice(0, 4)).map(
                    (take, idx) => (
                      <div
                        key={take.id}
                        className="border border-slate-200/90 rounded-2xl bg-slate-50/70 p-4 space-y-2 hover:border-indigo-300 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded mr-2">
                              Take {idx + 1}
                            </span>
                            <span className="font-bold text-slate-800 text-sm">
                              {take.lessonTitle}
                            </span>
                            <span className="text-slate-400 block text-[11px]">
                              {new Date(take.completedAt).toLocaleDateString()} • {take.totalQuestions}{' '}
                              Questions
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-base font-extrabold text-emerald-600 block">
                              {take.percentage}%
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {take.score} / {take.totalQuestions}
                            </span>
                          </div>
                        </div>

                        {showAllSampleTakesExpanded && (
                          <div className="pt-2 border-t border-slate-200 space-y-1.5 text-xs">
                            <span className="font-bold text-slate-700 block text-[11px]">
                              Question Breakdown:
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {take.answers.slice(0, 4).map((ans, qIdx) => (
                                <div
                                  key={qIdx}
                                  className="bg-white p-2 rounded-xl border border-slate-200 text-[11px] space-y-0.5"
                                >
                                  <div className="flex items-center justify-between font-semibold">
                                    <span className="truncate max-w-[200px]">
                                      Q{qIdx + 1}: {ans.question}
                                    </span>
                                    <span
                                      className={
                                        ans.isCorrect
                                          ? 'text-emerald-700 font-bold'
                                          : 'text-red-700 font-bold'
                                      }
                                    >
                                      {ans.isCorrect ? '✓' : '✗'}
                                    </span>
                                  </div>
                                  <p className="text-slate-500 truncate">Ans: {ans.userAnswer}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {/* LOADING STAGE */}
          {stage === 'loading' && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-sm space-y-4 max-w-xl mx-auto">
              <div className="inline-flex p-4 bg-sky-50 text-sky-700 rounded-3xl animate-spin">
                <Loader2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-slate-900">
                  Synthesizing {questionCount} College-Level Questions
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Strictly indexing {currentTargetLesson.title} across Chapter Scope. Verifying textbook page citations and generating explanations.
                </p>
              </div>
            </div>
          )}

          {/* ACTIVE EXAM TAKING STAGE */}
          {stage === 'active' && questions.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6 max-w-3xl mx-auto">
              {/* Progress & Chapter Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full">
                      Question {currentIdx + 1} of {questions.length}
                    </span>
                    <span className="text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded">
                      {questions[currentIdx].difficulty?.toUpperCase()}
                    </span>
                    {isPracticingMistakes && (
                      <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                        Targeted Revision
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 block pt-0.5">
                    {questions[currentIdx].chapterOrSection || 'Lesson Concept'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    openInspector(
                      questions[currentIdx].sourcePage,
                      questions[currentIdx].citationExcerpt
                    )
                  }
                  className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Page {questions[currentIdx].sourcePage}</span>
                </button>
              </div>

              {/* Question Text */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  FORMAT: {questions[currentIdx].type?.replace('_', ' ').toUpperCase()}
                </span>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                  {questions[currentIdx].question}
                </h3>
              </div>

              {/* INTERACTIVE INPUT BY QUESTION TYPE */}
              {/* 1. Multiple Choice / True or False */}
              {(questions[currentIdx].type === 'multiple_choice' ||
                questions[currentIdx].type === 'true_false' ||
                (questions[currentIdx].options && questions[currentIdx].options!.length > 0)) && (
                <div className="space-y-3">
                  {quizMode === 'active_recall' && !showActiveRecallOptions && !isAnswerSubmitted ? (
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-2xl text-center space-y-3">
                      <span className="text-xs font-bold text-purple-900 block">
                        🧠 Active Recall Shield Active
                      </span>
                      <p className="text-xs text-purple-700">
                        Recall the answer mentally or write it down first before revealing the choices:
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowActiveRecallOptions(true)}
                        className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                      >
                        Reveal Answer Choices
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2.5">
                      {questions[currentIdx].options?.map((opt, optIdx) => {
                        const letter = String.fromCharCode(65 + optIdx);
                        const isSelected = selectedOption === opt;
                        const isCorrectOption =
                          opt.trim().toLowerCase() ===
                          questions[currentIdx].correctAnswer.trim().toLowerCase();

                        let buttonStyle =
                          'border-slate-200 hover:border-slate-300 bg-white text-slate-800';
                        if (isAnswerSubmitted) {
                          if (isCorrectOption) {
                            buttonStyle =
                              'border-emerald-500 bg-emerald-50/90 text-emerald-950 font-bold';
                          } else if (isSelected) {
                            buttonStyle = 'border-red-500 bg-red-50/90 text-red-950 font-bold';
                          } else {
                            buttonStyle = 'border-slate-200 bg-slate-50 text-slate-400 opacity-60';
                          }
                        } else if (isSelected) {
                          buttonStyle =
                            'border-slate-900 bg-slate-900 text-white font-bold shadow-md';
                        }

                        return (
                          <button
                            key={optIdx}
                            type="button"
                            disabled={isAnswerSubmitted}
                            onClick={() => setSelectedOption(opt)}
                            className={`p-3.5 rounded-2xl border text-left flex items-start space-x-3 transition-all cursor-pointer ${buttonStyle}`}
                          >
                            <span
                              className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0 ${
                                isSelected && !isAnswerSubmitted
                                  ? 'bg-white text-slate-900'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {letter}
                            </span>
                            <span className="text-xs sm:text-sm font-medium leading-relaxed pt-0.5">
                              {opt}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 2. Fill in the Blank / Identification / Short Answer */}
              {questions[currentIdx].type !== 'multiple_choice' &&
                questions[currentIdx].type !== 'true_false' &&
                (!questions[currentIdx].options || questions[currentIdx].options!.length === 0) && (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Your Answer:
                    </label>
                    <input
                      type="text"
                      disabled={isAnswerSubmitted}
                      value={userTextAnswer}
                      onChange={(e) => setUserTextAnswer(e.target.value)}
                      placeholder="Type the exact academic term, definition, or concept..."
                      className="w-full p-4 bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                )}

              {/* POST-SUBMISSION EXPLANATION & CITATION */}
              {isAnswerSubmitted && (
                <div
                  className={`p-5 rounded-2xl border space-y-3 text-xs ${
                    userAnswers[userAnswers.length - 1]?.isCorrect
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      : 'bg-red-50/80 border-red-200 text-red-950'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-bold text-sm">
                    {userAnswers[userAnswers.length - 1]?.isCorrect ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span className="text-emerald-900">Correct! Excellent recall.</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-5 h-5 text-red-600" />
                        <span className="text-red-900">Incorrect. Review the lesson below:</span>
                      </>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="font-bold text-slate-800">Correct Answer:</span>
                    <p className="font-mono font-bold text-slate-900 bg-white/70 p-2 rounded-xl border border-slate-200/60">
                      {questions[currentIdx].correctAnswer}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="font-bold text-slate-800">Academic Explanation:</span>
                    <p className="leading-relaxed text-slate-700">
                      {questions[currentIdx].explanation}
                    </p>
                  </div>

                  {questions[currentIdx].citationExcerpt && (
                    <div className="pt-1 text-[11px] text-slate-500 italic">
                      Verbatim textbook citation: "{questions[currentIdx].citationExcerpt}" (Page{' '}
                      {questions[currentIdx].sourcePage})
                    </div>
                  )}
                </div>
              )}

              {/* ACTION BUTTONS: SUBMIT OR NEXT */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStage('setup')}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Cancel Exam
                </button>

                {!isAnswerSubmitted ? (
                  <button
                    type="button"
                    onClick={handleSubmitAnswer}
                    disabled={
                      (questions[currentIdx].type === 'multiple_choice' ||
                        questions[currentIdx].type === 'true_false')
                        ? !selectedOption
                        : !userTextAnswer.trim()
                    }
                    className="px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>Submit Answer</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNextQuestion}
                    className="px-6 py-3 bg-gradient-to-r from-red-800 to-indigo-900 hover:from-red-900 hover:to-indigo-950 text-white text-xs font-black rounded-xl shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>
                      {currentIdx < questions.length - 1 ? 'Next Question' : 'Complete Exam'}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* COMPLETED EXAM RESULTS STAGE */}
          {stage === 'completed' && finalResult && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6 max-w-3xl mx-auto">
              <div className="text-center space-y-2 border-b border-slate-100 pb-5">
                <div className="inline-flex p-3 bg-emerald-50 text-emerald-700 rounded-2xl mb-1">
                  <Award className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-black text-slate-900">Examination Completed</h3>
                <p className="text-xs text-slate-500">
                  {finalResult.lessonTitle} • {finalResult.questionCount} Questions Tested
                </p>
              </div>

              {/* SCORE CARDS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/70">
                  <span className="text-2xl font-black text-slate-900">{finalResult.questionCount}</span>
                  <span className="text-[11px] text-slate-500 font-bold block uppercase tracking-wider">
                    Total Questions
                  </span>
                </div>
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <span className="text-2xl font-black text-emerald-700">{finalResult.score}</span>
                  <span className="text-[11px] text-emerald-800 font-bold block uppercase tracking-wider">
                    Correct Answers
                  </span>
                </div>
                <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                  <span className="text-2xl font-black text-red-700">
                    {finalResult.questionCount - finalResult.score}
                  </span>
                  <span className="text-[11px] text-red-800 font-bold block uppercase tracking-wider">
                    Incorrect Answers
                  </span>
                </div>
                <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                  <span className="text-2xl font-black text-indigo-700">{finalResult.percentage}%</span>
                  <span className="text-[11px] text-indigo-800 font-bold block uppercase tracking-wider">
                    Final Score
                  </span>
                </div>
              </div>

              {/* ACTION BUTTONS (EXACT ORDER REQUESTED) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllReviewQuestions((prev) => !prev)}
                  className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  {showAllReviewQuestions ? 'Hide Answers' : 'Review Answers'}
                </button>

                <button
                  type="button"
                  onClick={handleRetakeExam}
                  className="p-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Retake Exam
                </button>

                {finalResult.questionsToReview.length > 0 && (
                  <button
                    type="button"
                    onClick={handlePracticeIncorrectAnswers}
                    className="p-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                  >
                    Practice Incorrect
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setStage('setup')}
                  className="p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Return to Reviewer
                </button>
              </div>

              {/* QUESTION-BY-QUESTION REVIEW SECTION */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900">
                    Question Breakdown & Explanations ({finalResult.answers.length})
                  </h4>
                  <span className="text-xs text-slate-500">
                    {finalResult.questionsToReview.length > 4 && !showAllReviewQuestions
                      ? 'Showing 4 Questions (Use Review Answers to expand)'
                      : 'All Explanations'}
                  </span>
                </div>

                <div className="space-y-3">
                  {(showAllReviewQuestions
                    ? finalResult.answers
                    : finalResult.answers.slice(0, 4)
                  ).map((ans, aIdx) => (
                    <div
                      key={aIdx}
                      className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {aIdx + 1}. {ans.question}
                        </span>
                        <button
                          type="button"
                          onClick={() => openInspector(ans.sourcePage, ans.citationExcerpt)}
                          className="text-[11px] font-bold text-sky-700 hover:underline shrink-0"
                        >
                          Page {ans.sourcePage}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                        <div
                          className={`p-2.5 rounded-xl border ${
                            ans.isCorrect
                              ? 'bg-emerald-50 border-emerald-100 text-emerald-950'
                              : 'bg-red-50 border-red-100 text-red-950'
                          }`}
                        >
                          <span className="font-bold block">Your Answer:</span>
                          <p>{ans.userAnswer}</p>
                        </div>

                        <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-900">
                          <span className="font-bold block text-emerald-700">Correct Answer:</span>
                          <p>{ans.correctAnswer}</p>
                        </div>
                      </div>

                      <div className="text-slate-600 pt-1 leading-relaxed">
                        <strong className="text-slate-800">Explanation: </strong>
                        {ans.explanation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============================================================== */}
      {/* TAB 2: FLASHCARDS (INTERACTIVE FLIP CARDS) */}
      {/* ============================================================== */}
      {activeReviewerTab === 'flashcards' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6 max-w-2xl mx-auto">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Interactive Study Flashcards
              </h3>
              <p className="text-xs text-slate-500">
                Grounded in {currentTargetLesson.title}
              </p>
            </div>

            <button
              type="button"
              onClick={handleShuffleFlashcards}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Shuffle Cards</span>
            </button>
          </div>

          {isLoadingFlashcards ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-sky-600" />
              <p className="text-xs text-slate-500">Generating flashcards from document pages...</p>
            </div>
          ) : flashcards.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No flashcards extracted yet. Switch chapters or refresh.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500 font-bold">
                <span>
                  Card {currentFlashcardIdx + 1} of {flashcards.length}
                </span>
                <span className="text-sky-700 font-bold">
                  {flashcards[currentFlashcardIdx].sourcePage
                    ? `Source Page ${flashcards[currentFlashcardIdx].sourcePage}`
                    : 'Textbook Grounded'}
                </span>
              </div>

              {/* 3D Interactive Flip Card */}
              <div
                onClick={() => setIsCardFlipped((prev) => !prev)}
                className="min-h-56 p-8 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl shadow-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all transform hover:scale-[1.01] select-none"
              >
                {!isCardFlipped ? (
                  <div className="space-y-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-sky-500/20 text-sky-300 px-3 py-1 rounded-full border border-sky-400/30">
                      FRONT • CONCEPT / TERM
                    </span>
                    <h3 className="text-xl sm:text-2xl font-black text-white">
                      {flashcards[currentFlashcardIdx].term}
                    </h3>
                    <p className="text-xs text-slate-400">Click to flip and inspect definition</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full border border-emerald-400/30">
                      BACK • DEFINITION & MEANING
                    </span>
                    <p className="text-sm sm:text-base font-medium text-slate-100 leading-relaxed max-w-md">
                      {flashcards[currentFlashcardIdx].definition}
                    </p>
                    <span className="text-xs text-sky-300 font-semibold block">
                      Page {flashcards[currentFlashcardIdx].sourcePage} Citation
                    </span>
                  </div>
                )}
              </div>

              {/* Card Controls */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={currentFlashcardIdx === 0}
                  onClick={() => {
                    setCurrentFlashcardIdx((prev) => Math.max(0, prev - 1));
                    setIsCardFlipped(false);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleFlashcardStatus('mastered')}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mastered</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleFlashcardStatus('review_again')}
                    className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer shadow-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Review Again</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={currentFlashcardIdx === flashcards.length - 1}
                  onClick={() => {
                    setCurrentFlashcardIdx((prev) => Math.min(flashcards.length - 1, prev + 1));
                    setIsCardFlipped(false);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: CONCEPT CONTRASTS (SIDE-BY-SIDE COMPARISONS) */}
      {/* ============================================================== */}
      {activeReviewerTab === 'contrasts' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6 max-w-4xl mx-auto">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-black text-slate-900">
              Concept Contrasts & Analytical Distinctions
            </h3>
            <p className="text-xs text-slate-500">
              Comparing related ideas from {currentTargetLesson.title} to prepare for exam trick questions.
            </p>
          </div>

          {isLoadingContrasts ? (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-600" />
              <p className="text-xs text-slate-500">Synthesizing concept distinctions...</p>
            </div>
          ) : contrasts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No contrasting pairs generated yet. Click refresh to index document pairs.
            </div>
          ) : (
            <div className="space-y-6">
              {contrasts.map((c) => (
                <div
                  key={c.id}
                  className="border border-slate-200/90 rounded-3xl p-5 bg-slate-50/70 space-y-4"
                >
                  {/* Pair Heading */}
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div className="flex items-center space-x-2">
                      <Scissors className="w-4 h-4 text-amber-600" />
                      <h4 className="text-sm sm:text-base font-black text-slate-900">
                        {c.conceptA.name} <span className="text-slate-400 font-normal">versus</span>{' '}
                        {c.conceptB.name}
                      </h4>
                    </div>
                    <span className="text-xs font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded">
                      Page {c.conceptA.sourcePage || 1} & {c.conceptB.sourcePage || 2}
                    </span>
                  </div>

                  {/* Two Definitions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 space-y-1">
                      <span className="font-extrabold text-indigo-900 block">{c.conceptA.name}</span>
                      <p className="text-slate-600 leading-relaxed">{c.conceptA.definition}</p>
                    </div>

                    <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 space-y-1">
                      <span className="font-extrabold text-purple-900 block">{c.conceptB.name}</span>
                      <p className="text-slate-600 leading-relaxed">{c.conceptB.definition}</p>
                    </div>
                  </div>

                  {/* Main Differences */}
                  <div className="p-3.5 bg-amber-50/70 border border-amber-200/70 rounded-2xl space-y-2 text-xs text-amber-950">
                    <span className="font-bold block uppercase tracking-wider text-[10px]">
                      Key Contrasts & Differences:
                    </span>
                    <ul className="space-y-1 list-disc list-inside">
                      {c.mainDifferences.map((diff, dIdx) => (
                        <li key={dIdx} className="leading-snug">
                          {diff}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Real World Example & Common Misconceptions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white rounded-xl border border-slate-200/70 space-y-1">
                      <span className="font-bold text-slate-800 block text-[11px]">
                        Practical Example:
                      </span>
                      <p className="text-slate-600 leading-snug">{c.practicalExamples}</p>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-slate-200/70 space-y-1">
                      <span className="font-bold text-red-800 block text-[11px]">
                        Common Exam Trap:
                      </span>
                      <p className="text-slate-600 leading-snug">{c.commonMisconceptions}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 4: MEMORIZATION LEVELS (5 PROGRESSIVE COGNITIVE TIERS) */}
      {/* ============================================================== */}
      {activeReviewerTab === 'memorization' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6 max-w-3xl mx-auto">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-black text-slate-900">
              5 Memorization & Cognitive Mastery Levels
            </h3>
            <p className="text-xs text-slate-500">
              Bloom's taxonomy tracking your progressive understanding from term recognition to analytical evaluation.
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                lvl: 1,
                name: 'Level 1: Term Recognition',
                desc: 'Recognize important terms and vocabulary when seen.',
                pct: memorizationProgress.level1_terms,
                color: 'bg-sky-500',
              },
              {
                lvl: 2,
                name: 'Level 2: Definition Recall',
                desc: 'Recall accurate academic definitions without visible hints.',
                pct: memorizationProgress.level2_definitions,
                color: 'bg-emerald-500',
              },
              {
                lvl: 3,
                name: 'Level 3: Concept Understanding',
                desc: 'Explain concepts in your own words and teach them to peers.',
                pct: memorizationProgress.level3_own_words,
                color: 'bg-amber-500',
              },
              {
                lvl: 4,
                name: 'Level 4: Practical Application',
                desc: 'Apply concepts to real-world workplace and academic situations.',
                pct: memorizationProgress.level4_application,
                color: 'bg-indigo-500',
              },
              {
                lvl: 5,
                name: 'Level 5: Analytical Mastery',
                desc: 'Demonstrate synthesis, contrast trade-offs, and solve professor-level problems.',
                pct: memorizationProgress.level5_mastery,
                color: 'bg-purple-600',
              },
            ].map((m) => (
              <div
                key={m.lvl}
                className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-extrabold text-slate-900">{m.name}</h4>
                    <p className="text-slate-500 text-[11px]">{m.desc}</p>
                  </div>
                  <span className="font-black text-sm text-slate-800">{m.pct}%</span>
                </div>

                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div className={`h-full ${m.color}`} style={{ width: `${m.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Recommendations box */}
          <div className="p-4 bg-indigo-50 border border-indigo-200/80 rounded-2xl space-y-2 text-xs text-indigo-950">
            <span className="font-extrabold block uppercase tracking-wider text-[11px]">
              Personalized Recommendations:
            </span>
            <ul className="space-y-1 list-disc list-inside text-slate-700">
              {memorizationProgress.recommendations?.map((rec, rIdx) => (
                <li key={rIdx}>{rec}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* CITATION MODAL FOR STRICT DOCUMENT INSPECTION */}
      <CitationModal
        isOpen={inspectPage !== null}
        onClose={() => {
          setInspectPage(null);
          setInspectExcerpt(undefined);
        }}
        pageNumber={inspectPage || 1}
        lesson={currentTargetLesson}
        highlightExcerpt={inspectExcerpt}
      />
    </div>
  );
};
