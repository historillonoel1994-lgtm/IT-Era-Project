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

export interface LessonSummary {
  mainTopic: string;
  simpleExplanation: string;
  keyIdeas: KeyIdea[];
  importantTerms: ImportantTerm[];
  keyTakeaways: KeyTakeaway[];
  quickReviewNotes: QuickReviewNote[];
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
  sourcePage?: number | string;
  citationExcerpt?: string;
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
