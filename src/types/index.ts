export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  degree: string;
  jobTitle: string;
  institution?: string;
  avatarSeed: string;
}

export interface LessonPage {
  pageNumber: number;
  text: string;
}

export interface LessonDocument {
  id: string;
  title: string;
  subject: string;
  totalPages: number;
  uploadedAt: string;
  pages: LessonPage[];
  isSample?: boolean;
  fileType?: 'pdf' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'csv' | 'txt' | 'other' | string;
  fileName?: string;
  filePath?: string;
  chunks?: DocumentChunk[];
}

export interface KeyIdea {
  idea: string;
  sourcePage: number | string;
  citationExcerpt?: string;
}

export interface ImportantTerm {
  term: string;
  definition: string;
  sourcePage: number | string;
}

export interface KeyTakeaway {
  takeaway: string;
  sourcePage: number | string;
}

export interface QuickReviewNote {
  heading: string;
  bulletPoints: string[];
  sourcePage: number | string;
}

export interface StudyPointer {
  pointer: string;
  sourcePage?: number | string;
  category?: 'quiz' | 'recitation' | 'exam' | 'concept' | string;
}

export interface DocumentChunk {
  chunkId: string;
  pageNumber: number | string;
  text: string;
  keywords?: string[];
  charCount?: number;
}

export interface LessonSummary {
  mainTopic: string;
  simpleExplanation: string;
  summary?: string;
  keyIdeas: KeyIdea[];
  keyPoints?: KeyIdea[];
  importantTerms: ImportantTerm[];
  studyPointers?: StudyPointer[];
  relationshipsBetweenTopics?: string[];
  processesOrProcedures?: string[];
  namesAndDates?: string[];
  keyTakeaways: KeyTakeaway[];
  quickReviewNotes: QuickReviewNote[];
  importantDetails?: string[];
  generatedAt: string;
}

export interface QuizQuestion {
  id: string;
  type: 'multiple_choice' | 'true_false';
  question: string;
  options: string[]; // 4 options for MC, 2 options (['True', 'False']) for TF
  correctAnswer: string;
  explanation: string;
  sourcePage: number | string;
  citationExcerpt?: string;
  topic?: string;
}

export interface QuizUserAnswer {
  questionId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
  sourcePage: number | string;
  topic?: string;
}

export interface QuizResult {
  id: string;
  lessonId: string;
  lessonTitle: string;
  completedAt: string;
  totalQuestions: number;
  score: number;
  percentage: number;
  answers: QuizUserAnswer[];
  questionsToReview: QuizUserAnswer[];
  topicsToReview: string[];
}

export interface WorkScheduleItem {
  id: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  startTime: string; // e.g. "08:00"
  endTime: string;   // e.g. "16:00"
  jobRole?: string;
}

export interface ClassScheduleItem {
  id: string;
  subject: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  startTime: string; // e.g. "17:30"
  endTime: string;   // e.g. "20:30"
  roomOrLink?: string;
}

export interface SchoolTaskItem {
  id: string;
  task: string;
  subject: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'High' | 'Medium' | 'Low';
  completed: boolean;
}

export interface TodayPlanItem {
  id: string;
  title: string;
  timeSlot: string; // e.g. "08:00 - 16:00"
  category: 'work' | 'class' | 'study' | 'quiz_review' | 'break' | 'assignment';
  description?: string;
  completed: boolean;
  subject?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'tutor';
  text: string;
  sourceType?: 'material' | 'gemini';
  sourceLabel?: string;
  sourceNotice?: string;
  lessonTitle?: string;
  mode?: 'materials' | 'feynman' | 'general' | 'lesson';
  answerLabel?: string;
  generalReminder?: string;
  sourcePage?: number | string;
  sourceSection?: string;
  citationExcerpt?: string;
  directAnswer?: string;
  explanation?: string;
  basedOnMaterial?: string;
  keyPointToRemember?: string;
  example?: string;
  timestamp: string;
  isSafeguardNotice?: boolean;
}

export interface StudentProgress {
  totalStudyMinutes: number;
  lessonsReviewed: number;
  quizzesCompleted: number;
  averageQuizScore: number;
  tasksCompleted: number;
  verifiedCitationsCount: number;
  topicsStudied: string[];
}

export interface AskTutorLog {
  id?: string;
  user_id: string;
  question: string;
  answer: string;
  source_type: 'uploaded_material' | 'gemini';
  material_title?: string | null;
  page_reference?: string | number | null;
  created_at?: string;
}

// ==========================================
// INTELLIGENT AUDIO LESSON SESSION TYPES
// ==========================================

export interface AudioSessionProgress {
  studentId: string;
  documentId: string;
  documentTitle: string;
  currentPage: number;
  hasIntroduced: boolean;
  completedPages: number[];
  playbackRate: number;
  lastAccessedAt: string;
  isComplete: boolean;
}

// ==========================================
// COMPLETE SELF-REVIEWER SYSTEM TYPES
// ==========================================

export interface DocumentChapter {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  topics: string[];
  summaryPreview?: string;
}

export type ReviewerDifficulty = 'easy' | 'medium' | 'hard' | 'professor';

export type ReviewerQuestionType =
  | 'mixed'
  | 'multiple_choice'
  | 'fill_in_the_blank'
  | 'identification'
  | 'true_false'
  | 'concept_contrasts'
  | 'scenario'
  | 'short_answer';

export interface ReviewerQuestion {
  id: string;
  type: ReviewerQuestionType;
  difficulty: ReviewerDifficulty;
  question: string;
  options?: string[]; // For multiple choice & true/false
  correctAnswer: string;
  explanation: string;
  sourcePage: number | string;
  chapterOrSection?: string;
  citationExcerpt?: string;
  isSupplementary?: boolean; // Clearly labeled if supplementary explanation
  rubricCriteria?: string[]; // For short answer / scenario evaluation
  topic?: string;
}

export interface ReviewerUserAnswer {
  questionId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
  sourcePage: number | string;
  chapterOrSection?: string;
  citationExcerpt?: string;
  isSupplementary?: boolean;
}

export interface ReviewerAttempt {
  id: string;
  userId?: string;
  lessonId: string;
  lessonTitle: string;
  chapterOrSection?: string;
  difficulty: ReviewerDifficulty;
  mode: 'practice' | 'exam';
  questionCount: number;
  score: number;
  percentage: number;
  completedAt: string;
  answers: ReviewerUserAnswer[];
  questionsToReview: ReviewerUserAnswer[];
  topicsToReview: string[];
}

export interface FlashcardItem {
  id: string;
  term: string;
  definition: string;
  sourcePage: number | string;
  chapter?: string;
  status?: 'mastered' | 'learning' | 'review_again';
  isSupplementary?: boolean;
}

export interface ConceptContrastItem {
  id: string;
  conceptA: {
    name: string;
    definition: string;
    sourcePage: number | string;
  };
  conceptB: {
    name: string;
    definition: string;
    sourcePage: number | string;
  };
  mainDifferences: string[];
  similarities: string[];
  practicalExamples: string;
  commonMisconceptions: string;
  isSupplementary?: boolean;
}

export interface MemorizationLevelProgress {
  level1_terms: number; // 0 - 100
  level2_definitions: number; // 0 - 100
  level3_own_words: number; // 0 - 100
  level4_application: number; // 0 - 100
  level5_mastery: number; // 0 - 100
  recommendations: string[];
}
