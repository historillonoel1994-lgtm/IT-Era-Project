import { UserProfile, WorkScheduleItem, ClassScheduleItem, SchoolTaskItem, TodayPlanItem, StudentProgress } from '../types';

export const DEFAULT_USER: UserProfile = {
  id: 'usr-working-student-01',
  fullName: 'Juan Dela Cruz',
  email: 'juan.delacruz@student.univ.edu',
  degree: 'BS Business Administration (Major in Marketing)',
  jobTitle: 'Retail Sales Associate (Part-Time, 24 hrs/wk)',
  institution: 'State Metropolitan University',
  avatarSeed: 'juan-studybuddy',
};

export const DEFAULT_WORK_SCHEDULE: WorkScheduleItem[] = [
  {
    id: 'work-1',
    day: 'Monday',
    startTime: '08:00',
    endTime: '13:00',
    jobRole: 'Morning Store Opening & Inventory',
  },
  {
    id: 'work-2',
    day: 'Wednesday',
    startTime: '08:00',
    endTime: '13:00',
    jobRole: 'Cashier & Customer Service Shift',
  },
  {
    id: 'work-3',
    day: 'Friday',
    startTime: '13:00',
    endTime: '18:00',
    jobRole: 'Inventory Restock & POS Audit',
  },
  {
    id: 'work-4',
    day: 'Saturday',
    startTime: '09:00',
    endTime: '17:00',
    jobRole: 'Weekend Weekend Retail Associate Shift',
  },
];

export const DEFAULT_CLASS_SCHEDULE: ClassScheduleItem[] = [
  {
    id: 'cls-1',
    subject: 'Intro to Business Management',
    day: 'Monday',
    startTime: '14:30',
    endTime: '17:30',
    roomOrLink: 'Hall B - Room 204',
  },
  {
    id: 'cls-2',
    subject: 'Economics of Education',
    day: 'Tuesday',
    startTime: '10:00',
    endTime: '13:00',
    roomOrLink: 'Online Lecture (Zoom)',
  },
  {
    id: 'cls-3',
    subject: 'Intro to Business Management',
    day: 'Wednesday',
    startTime: '14:30',
    endTime: '17:30',
    roomOrLink: 'Hall B - Room 204',
  },
  {
    id: 'cls-4',
    subject: 'Business Analytics & Ethics',
    day: 'Thursday',
    startTime: '13:00',
    endTime: '16:00',
    roomOrLink: 'Computer Lab 3',
  },
];

export const DEFAULT_SCHOOL_TASKS: SchoolTaskItem[] = [
  {
    id: 'tsk-1',
    task: 'Read Chapter 5: Entrepreneurship & Note Schumpeter definitions',
    subject: 'Intro to Business Management',
    dueDate: '2026-09-28',
    priority: 'High',
    completed: false,
  },
  {
    id: 'tsk-2',
    task: 'Submit Chapter 5 Quiz practice score to professor portal',
    subject: 'Intro to Business Management',
    dueDate: '2026-09-29',
    priority: 'High',
    completed: false,
  },
  {
    id: 'tsk-3',
    task: 'Prepare 1-page reflection on Working Student Opportunity Costs',
    subject: 'Economics of Education',
    dueDate: '2026-10-02',
    priority: 'Medium',
    completed: false,
  },
  {
    id: 'tsk-4',
    task: 'Group Discussion on AI Ethics in Business Strategy',
    subject: 'Business Analytics & Ethics',
    dueDate: '2026-10-05',
    priority: 'Low',
    completed: true,
  },
];

export const DEFAULT_TODAY_PLAN: TodayPlanItem[] = [
  {
    id: 'tp-1',
    title: 'Work Shift: Retail Store Opening',
    timeSlot: '08:00 - 13:00',
    category: 'work',
    description: 'Morning floor supervision, stocking shelves, customer counter.',
    completed: true,
  },
  {
    id: 'tp-2',
    title: 'Rest & Lunch Buffer (Do not study, recharge brain)',
    timeSlot: '13:00 - 14:00',
    category: 'break',
    description: 'Mandatory decompression time after standing on feet for 5 hours.',
    completed: true,
  },
  {
    id: 'tp-3',
    title: 'Class: Intro to Business Management',
    timeSlot: '14:30 - 17:30',
    category: 'class',
    description: 'Hall B Room 204. Professor discussing Chapter 5 Entrepreneurship.',
    completed: false,
  },
  {
    id: 'tp-4',
    title: 'Study Session: Summarize Chapter 5 with Study Buddy AI',
    timeSlot: '18:15 - 18:45',
    category: 'study',
    description: 'Review Key Ideas, Schumpeter creative destruction, Lean MVP concept.',
    completed: false,
    subject: 'Intro to Business Management',
  },
  {
    id: 'tp-5',
    title: 'Quick 10-Question Quiz Review on Lesson 5',
    timeSlot: '19:00 - 19:25',
    category: 'quiz_review',
    description: 'Test retention before evening dinner to cement concepts in long-term memory.',
    completed: false,
    subject: 'Intro to Business Management',
  },
  {
    id: 'tp-6',
    title: 'Assignment: Finalize Chapter 5 review notes',
    timeSlot: '19:45 - 20:30',
    category: 'assignment',
    description: 'Verify page citations in original PDF textbook.',
    completed: false,
    subject: 'Intro to Business Management',
  },
];

export const DEFAULT_PROGRESS: StudentProgress = {
  totalStudyMinutes: 185,
  lessonsReviewed: 3,
  quizzesCompleted: 4,
  averageQuizScore: 88,
  tasksCompleted: 7,
  verifiedCitationsCount: 12,
  topicsStudied: [
    'Entrepreneurship & Creative Destruction',
    'Opportunity Recognition & Market Need',
    'Lean Startup & Minimum Viable Product',
    'SDG 4: Human Capital Theory',
    'Responsible AI & Verification Safeguards',
  ],
};
