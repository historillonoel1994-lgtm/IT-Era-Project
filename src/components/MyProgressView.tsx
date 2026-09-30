import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Clock,
  BookOpen,
  CheckCircle,
  Award,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  BarChart3,
  Calendar,
  Layers,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  getStudentProgress,
  getUserProfile,
} from '../services/storage';
import { SAMPLE_EXAM_TAKES } from '../data/precomputedData';
import {
  fetchStudyProgressFromSupabase,
  fetchStudentQuizAttempts,
  checkIsConfigured,
  RawQuizAttemptRow,
  DATA_UPDATED_EVENT,
} from '../lib/supabase';
import { StudentProgress } from '../types';

interface MyProgressViewProps {
  onNavigateToQuiz: () => void;
  onNavigateToSummary: () => void;
  onNavigateToTimer: () => void;
}

export const MyProgressView: React.FC<MyProgressViewProps> = ({
  onNavigateToQuiz,
  onNavigateToSummary,
  onNavigateToTimer,
}) => {
  const [progress, setProgress] = useState<StudentProgress>(getStudentProgress());
  const [dbQuizzes, setDbQuizzes] = useState<RawQuizAttemptRow[]>([]);
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);
  const [showAllTakesExpanded, setShowAllTakesExpanded] = useState<boolean>(false);
  const [showAllHistoryList, setShowAllHistoryList] = useState<boolean>(false);
  const user = getUserProfile();

  useEffect(() => {
    const refreshData = () => {
      if (checkIsConfigured()) {
        fetchStudyProgressFromSupabase().then((res) => {
          if (res.error) {
            console.error('Progress DB error:', res.error);
            setDbErrorMessage((prev) => prev || res.error);
          } else if (res.progress) {
            setProgress(res.progress);
          }
        });
        fetchStudentQuizAttempts().then((res) => {
          if (res.error) {
            console.error('Quiz DB error:', res.error);
            setDbErrorMessage((prev) => prev || res.error);
          } else if (res.attempts) {
            setDbQuizzes(res.attempts);
          }
        });
      }
    };

    refreshData();
    window.addEventListener(DATA_UPDATED_EVENT, refreshData);
    window.addEventListener('focus', refreshData);
    return () => {
      window.removeEventListener(DATA_UPDATED_EVENT, refreshData);
      window.removeEventListener('focus', refreshData);
    };
  }, [user.id]);

  const studyHours = (progress.totalStudyMinutes / 60).toFixed(1);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Friendly DB notification if any */}
      {dbErrorMessage && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs flex items-center space-x-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <span className="font-bold">Database notification: </span>
            <span>{dbErrorMessage}</span>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-indigo-600 to-sky-700 text-white rounded-xl shadow-sm shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2.5 py-0.5 rounded-full">
                  Supporting Feature 7 • My Progress
                </span>
                <span className="text-xs text-slate-400">Academic & Work Balance</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Learning Milestones & Performance
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Student: <span className="text-slate-800 font-bold">{user.fullName}</span> ({user.jobTitle})
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={onNavigateToQuiz}
              className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors"
            >
              Take Practice Quiz
            </button>
            <button
              onClick={onNavigateToTimer}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Start Focus Session
            </button>
          </div>
        </div>
      </div>

      {/* High-level Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Metric 1: Quiz Average */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quiz Scores</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-700 rounded-lg">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-3xl font-extrabold text-slate-900">{progress.averageQuizScore}%</span>
            <p className="text-[11px] text-slate-500 font-medium">{progress.quizzesCompleted} quizzes taken</p>
          </div>
        </div>

        {/* Metric 2: Study Time */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Study Time</span>
            <div className="p-1.5 bg-sky-50 text-sky-700 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-3xl font-extrabold text-slate-900">{studyHours} hrs</span>
            <p className="text-[11px] text-slate-500 font-medium">{progress.totalStudyMinutes} minutes focused</p>
          </div>
        </div>

        {/* Metric 3: Lessons Reviewed */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lessons</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-700 rounded-lg">
              <BookOpen className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-3xl font-extrabold text-slate-900">{progress.lessonsReviewed}</span>
            <p className="text-[11px] text-slate-500 font-medium">materials analyzed</p>
          </div>
        </div>

        {/* Metric 4: Tasks Completed */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tasks</span>
            <div className="p-1.5 bg-amber-50 text-amber-700 rounded-lg">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-3xl font-extrabold text-slate-900">{progress.tasksCompleted}</span>
            <p className="text-[11px] text-slate-500 font-medium">completed this week</p>
          </div>
        </div>

        {/* Metric 5: Responsible AI Audits */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-2 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Verified Citations</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-700 rounded-lg">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-3xl font-extrabold text-emerald-700">
              {progress.verifiedCitationsCount ?? 0}
            </span>
            <p className="text-[11px] text-slate-500 font-medium">citations checked with original</p>
          </div>
        </div>
      </div>

      {/* Two Columns: Quiz History & Topics Studied */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quiz Scores & History */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Quiz History & Exam Takes</h3>
                <span className="text-[11px] text-slate-400">
                  {(() => {
                    const allItems = dbQuizzes.length > 0 ? dbQuizzes : SAMPLE_EXAM_TAKES;
                    if (allItems.length > 4 && !showAllHistoryList) {
                      return `Showing 4 of ${allItems.length} Attempts`;
                    }
                    return dbQuizzes.length > 0 ? `${dbQuizzes.length} Attempts in Cloud` : '4 Sample Exam Takes Available';
                  })()}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {(() => {
                const allItems = dbQuizzes.length > 0 ? dbQuizzes : SAMPLE_EXAM_TAKES;
                return allItems.length > 4 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllHistoryList((prev) => !prev)}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
                  >
                    {showAllHistoryList ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>Limit to 4 Results</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Open to View Full List ({allItems.length})</span>
                      </>
                    )}
                  </button>
                ) : null;
              })()}

              <button
                type="button"
                onClick={() => setShowAllTakesExpanded((prev) => !prev)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shrink-0 shadow-xs cursor-pointer self-start sm:self-center"
              >
                {showAllTakesExpanded ? (
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

          {/* If there are live dbQuizzes, display them; otherwise display the 4 authentic SAMPLE_EXAM_TAKES */}
          <div className="space-y-3">
            {(() => {
              const allItems = dbQuizzes.length > 0 ? dbQuizzes : SAMPLE_EXAM_TAKES;
              const displayed = showAllHistoryList ? allItems : allItems.slice(0, 4);
              return displayed.map((item: any, idx) => {
              const isSample = !('total_questions' in item);
              const totalQ = isSample ? item.totalQuestions : item.total_questions;
              const score = item.score;
              const percentage = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;
              const title = isSample ? item.lessonTitle : (item.learning_materials?.title || 'Practice Quiz');
              const dateStr = item.created_at || item.completedAt ? new Date(item.created_at || item.completedAt).toLocaleDateString() : 'Recent';

              return (
                <div
                  key={item.id || idx}
                  className="bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden hover:border-indigo-200 transition-colors"
                >
                  <div className="p-3.5 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-2">
                        {isSample && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded">
                            Sample Take {idx + 1}
                          </span>
                        )}
                        <span className="font-bold text-slate-800 text-sm">{title}</span>
                      </div>
                      <span className="text-slate-400 text-[11px]">
                        {dateStr} • {totalQ} questions
                      </span>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-base font-extrabold ${
                          percentage >= 80
                            ? 'text-emerald-600'
                            : percentage >= 60
                            ? 'text-indigo-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {percentage}%
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {score} / {totalQ}
                      </span>
                    </div>
                  </div>

                  {/* Expanded question review when Open All is active */}
                  {showAllTakesExpanded && isSample && item.answers && (
                    <div className="px-3.5 py-2.5 bg-white border-t border-slate-200/80 space-y-2 text-xs">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        Question Breakdown ({item.answers.length} Questions):
                      </span>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {item.answers.map((ans: any, qIdx: number) => (
                          <div
                            key={qIdx}
                            className={`p-2 rounded-lg border text-[11px] ${
                              ans.isCorrect
                                ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                                : 'bg-red-50/60 border-red-200 text-red-950'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <span className="font-semibold">
                                {qIdx + 1}. {ans.question}
                              </span>
                              <span className="shrink-0 font-bold">
                                {ans.isCorrect ? '✓ Correct' : '✗ Missed'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-600 italic mt-0.5">
                              {ans.explanation} {ans.sourcePage && `[Source: Page ${ans.sourcePage}]`}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            });
            })()}
          </div>

          {(() => {
            const allItems = dbQuizzes.length > 0 ? dbQuizzes : SAMPLE_EXAM_TAKES;
            return allItems.length > 4 ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowAllHistoryList((prev) => !prev)}
                  className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors cursor-pointer shadow-xs"
                >
                  {showAllHistoryList ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      <span>Limit to 4 Results</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      <span>Open to View Full List ({allItems.length} Exam Takes)</span>
                    </>
                  )}
                </button>
              </div>
            ) : null;
          })()}
        </div>

        {/* Topics Studied & SDG 4 Impact */}
        <div className="space-y-6">
          {/* Topics Studied List */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-sky-100 text-sky-700 rounded-lg">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Topics Studied & Mastered</h3>
            </div>

            <div className="flex flex-wrap gap-2">
              {progress.topicsStudied.map((topic, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1.5 bg-sky-50 text-sky-900 border border-sky-200/70 rounded-xl text-xs font-semibold flex items-center space-x-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  <span>{topic}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Academic Integrity & Verified Learning Card */}
          <div className="bg-gradient-to-r from-sky-50 via-white to-emerald-50 border border-sky-200 rounded-2xl p-6 space-y-3">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
              </div>
              <h4 className="text-sm font-bold text-slate-900">
                Academic Integrity & Verified Learning
              </h4>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Study Buddy AI ensures working college students receive accessible and responsible academic support. By emphasizing verified page citations and refusing to hallucinate unsupported claims, Study Buddy AI upholds authentic scholarship and deep understanding.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
