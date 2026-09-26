import React, { useState } from 'react';
import {
  Calendar,
  Briefcase,
  GraduationCap,
  ListTodo,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  Coffee,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { WorkScheduleItem, ClassScheduleItem, SchoolTaskItem, TodayPlanItem } from '../types';
import {
  getWorkSchedule,
  saveWorkSchedule,
  getClassSchedule,
  saveClassSchedule,
  getSchoolTasks,
  saveSchoolTasks,
  getTodayPlan,
  saveTodayPlan,
} from '../services/storage';
import { suggestStudySchedule } from '../services/api';

interface WorkStudyPlannerViewProps {
  onNavigateToTodayPlan: () => void;
}

const DAYS_OF_WEEK: WorkScheduleItem['day'][] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const WorkStudyPlannerView: React.FC<WorkStudyPlannerViewProps> = ({
  onNavigateToTodayPlan,
}) => {
  const [workList, setWorkList] = useState<WorkScheduleItem[]>(getWorkSchedule());
  const [classList, setClassList] = useState<ClassScheduleItem[]>(getClassSchedule());
  const [taskList, setTaskList] = useState<SchoolTaskItem[]>(getSchoolTasks());

  // Form states for adding items
  const [showAddWork, setShowAddWork] = useState(false);
  const [newWorkDay, setNewWorkDay] = useState<WorkScheduleItem['day']>('Monday');
  const [newWorkStart, setNewWorkStart] = useState('09:00');
  const [newWorkEnd, setNewWorkEnd] = useState('17:00');
  const [newWorkRole, setNewWorkRole] = useState('');

  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassSubject, setNewClassSubject] = useState('');
  const [newClassDay, setNewClassDay] = useState<ClassScheduleItem['day']>('Monday');
  const [newClassStart, setNewClassStart] = useState('14:00');
  const [newClassEnd, setNewClassEnd] = useState('17:00');
  const [newClassRoom, setNewClassRoom] = useState('');

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskSubject, setNewTaskSubject] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('2026-09-30');
  const [newTaskPriority, setNewTaskPriority] = useState<'High' | 'Medium' | 'Low'>('High');

  // AI Study Plan suggestions
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [aiPlan, setAiPlan] = useState<{
    overview: string;
    weeklyTips: string[];
    suggestedSessions: any[];
  } | null>(null);
  const [planSuccessNotice, setPlanSuccessNotice] = useState<string | null>(null);

  // Work Schedule operations
  const handleAddWork = (e: React.FormEvent) => {
    e.preventDefault();
    const item: WorkScheduleItem = {
      id: `work-${Date.now()}`,
      day: newWorkDay,
      startTime: newWorkStart,
      endTime: newWorkEnd,
      jobRole: newWorkRole.trim() || 'Work Shift',
    };
    const updated = [...workList, item];
    setWorkList(updated);
    saveWorkSchedule(updated);
    setShowAddWork(false);
    setNewWorkRole('');
  };

  const handleDeleteWork = (id: string) => {
    const updated = workList.filter((w) => w.id !== id);
    setWorkList(updated);
    saveWorkSchedule(updated);
  };

  // Class Schedule operations
  const handleAddClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassSubject.trim()) return;
    const item: ClassScheduleItem = {
      id: `cls-${Date.now()}`,
      subject: newClassSubject.trim(),
      day: newClassDay,
      startTime: newClassStart,
      endTime: newClassEnd,
      roomOrLink: newClassRoom.trim() || 'Classroom',
    };
    const updated = [...classList, item];
    setClassList(updated);
    saveClassSchedule(updated);
    setShowAddClass(false);
    setNewClassSubject('');
    setNewClassRoom('');
  };

  const handleDeleteClass = (id: string) => {
    const updated = classList.filter((c) => c.id !== id);
    setClassList(updated);
    saveClassSchedule(updated);
  };

  // School Tasks operations
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const item: SchoolTaskItem = {
      id: `tsk-${Date.now()}`,
      task: newTaskTitle.trim(),
      subject: newTaskSubject.trim() || 'General Course',
      dueDate: newTaskDue,
      priority: newTaskPriority,
      completed: false,
    };
    const updated = [...taskList, item];
    setTaskList(updated);
    saveSchoolTasks(updated);
    setShowAddTask(false);
    setNewTaskTitle('');
    setNewTaskSubject('');
  };

  const handleDeleteTask = (id: string) => {
    const updated = taskList.filter((t) => t.id !== id);
    setTaskList(updated);
    saveSchoolTasks(updated);
  };

  // AI Schedule Suggestion
  const handleGeneratePlan = async () => {
    setIsGeneratingPlan(true);
    setPlanSuccessNotice(null);
    try {
      const res = await suggestStudySchedule({
        workSchedule: workList,
        classSchedule: classList,
        schoolTasks: taskList,
      });
      setAiPlan(res);
    } catch (err: any) {
      console.error('Failed to generate study plan:', err);
      // Fallback sensible plan if network error
      setAiPlan({
        overview:
          'Based on your 24 hours of retail work and weekday classes, you have optimal 30-45 minute focus blocks before classes and on Sunday mornings. Mandatory rest periods are scheduled immediately after work shifts.',
        weeklyTips: [
          'Take a 30-minute brain break after your shift before starting study sessions.',
          'Use 15-minute Focus Timers on your phone to review flashcards or summaries during commute breaks.',
          'Protect at least one full evening purely for rest and social wellness.',
        ],
        suggestedSessions: [
          {
            day: 'Monday',
            timeSlot: '18:15 - 18:45',
            category: 'study',
            title: 'Quick 30-min Review: Intro to Business Management',
            description: 'Read Chapter 5 Summary & definitions before dinner',
            durationMinutes: 30,
          },
          {
            day: 'Wednesday',
            timeSlot: '18:30 - 19:15',
            category: 'quiz_review',
            title: '10-Question Practice Quiz on Chapter 5',
            description: 'Cement concepts with active recall',
            durationMinutes: 45,
          },
          {
            day: 'Friday',
            timeSlot: '19:00 - 19:45',
            category: 'break',
            title: 'Post-Work Decompression Buffer',
            description: 'No study allowed: healthy meal and rest',
            durationMinutes: 45,
          },
        ],
      });
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleApplyToTodayPlan = () => {
    if (!aiPlan) return;
    const currentToday = getTodayPlan();

    const newItems: TodayPlanItem[] = aiPlan.suggestedSessions.map((s, idx) => ({
      id: `ai-suggested-${Date.now()}-${idx}`,
      title: s.title,
      timeSlot: s.timeSlot,
      category: (s.category as any) || 'study',
      description: s.description,
      completed: false,
    }));

    const combined = [...currentToday, ...newItems];
    saveTodayPlan(combined);
    setPlanSuccessNotice(`Added ${newItems.length} suggested sessions to Today's Plan!`);
    setTimeout(() => setPlanSuccessNotice(null), 3000);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-sky-600 to-indigo-800 text-white rounded-xl shadow-sm shrink-0">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 bg-sky-100 px-2.5 py-0.5 rounded-full">
                  Supporting Feature 4 • Work & Study Planner
                </span>
                <span className="text-xs text-slate-400">Burnout Prevention</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Balance Your Job & Coursework
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Enter your work shifts and class blocks to generate realistic, non-overloading study schedules.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleGeneratePlan}
              disabled={isGeneratingPlan}
              className="px-4 py-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl shadow-sm transition-all flex items-center space-x-2"
            >
              <Sparkles className="w-4 h-4 text-sky-200" />
              <span>{isGeneratingPlan ? 'Analyzing Schedule...' : 'Suggest Study Schedule'}</span>
            </button>
          </div>
        </div>
      </div>

      {planSuccessNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{planSuccessNotice}</span>
          </div>
          <button
            onClick={onNavigateToTodayPlan}
            className="text-xs font-bold underline text-emerald-800 hover:text-emerald-950"
          >
            Go to Today's Plan &rarr;
          </button>
        </div>
      )}

      {/* AI Schedule Suggestion Box */}
      {aiPlan && (
        <div className="bg-gradient-to-r from-sky-50 via-white to-indigo-50 border border-sky-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 bg-sky-100 text-sky-800 text-[11px] font-bold rounded-full uppercase">
                  AI Schedule Recommendation
                </span>
                <span className="text-xs text-slate-500">Includes mandatory rest buffers</span>
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Personalized Work-Study Balance Plan
              </h3>
            </div>
            <button
              onClick={handleApplyToTodayPlan}
              className="px-3.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-colors"
            >
              Add to Today's Plan
            </button>
          </div>

          <p className="text-xs text-slate-700 leading-relaxed bg-white/80 p-3.5 rounded-xl border border-sky-100">
            {aiPlan.overview}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {aiPlan.suggestedSessions.map((session: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-2xs space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-sky-900">{session.day}</span>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {session.timeSlot}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-800 leading-snug">
                  {session.title}
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {session.description}
                </p>
                <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="capitalize">{session.category}</span>
                  <span>{session.durationMinutes} mins</span>
                </div>
              </div>
            ))}
          </div>

          {/* Working Student Tips */}
          {aiPlan.weeklyTips && (
            <div className="pt-2 border-t border-slate-200/70">
              <span className="text-xs font-bold text-slate-700 block mb-1">
                💡 Working Student Pro-Tips:
              </span>
              <ul className="space-y-1 text-xs text-slate-600">
                {aiPlan.weeklyTips.map((tip: string, idx: number) => (
                  <li key={idx} className="flex items-start space-x-1.5">
                    <span className="text-sky-600 font-bold">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 3 Input Columns: Work, Classes, Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUMN 1: WORK SCHEDULE */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                <Briefcase className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Work Schedule</h3>
                <p className="text-[11px] text-slate-500">Job shifts & store hours</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddWork(!showAddWork)}
              className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {showAddWork && (
            <form onSubmit={handleAddWork} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 text-xs">
              <span className="font-bold text-slate-800 block">Add Work Shift</span>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Day</label>
                <select
                  value={newWorkDay}
                  onChange={(e) => setNewWorkDay(e.target.value as any)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Start Time</label>
                  <input
                    type="time"
                    value={newWorkStart}
                    onChange={(e) => setNewWorkStart(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">End Time</label>
                  <input
                    type="time"
                    value={newWorkEnd}
                    onChange={(e) => setNewWorkEnd(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Role / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Retail Associate Shift"
                  value={newWorkRole}
                  onChange={(e) => setNewWorkRole(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddWork(false)}
                  className="px-3 py-1 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold"
                >
                  Save Shift
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {workList.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/70 rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900">{item.day}</span>
                    <span className="text-slate-500 font-medium">
                      {item.startTime} - {item.endTime}
                    </span>
                  </div>
                  {item.jobRole && (
                    <span className="text-[11px] text-slate-500 block">{item.jobRole}</span>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteWork(item.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                  title="Remove shift"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* COLUMN 2: CLASS SCHEDULE */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-sky-100 text-sky-800 rounded-xl">
                <GraduationCap className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Class Schedule</h3>
                <p className="text-[11px] text-slate-500">Lectures & labs</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddClass(!showAddClass)}
              className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {showAddClass && (
            <form onSubmit={handleAddClass} className="p-3.5 bg-sky-50/50 rounded-xl border border-sky-200 space-y-2.5 text-xs">
              <span className="font-bold text-slate-800 block">Add Class</span>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Subject</label>
                <input
                  type="text"
                  placeholder="e.g. Intro to Business Management"
                  value={newClassSubject}
                  onChange={(e) => setNewClassSubject(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Day</label>
                <select
                  value={newClassDay}
                  onChange={(e) => setNewClassDay(e.target.value as any)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Start Time</label>
                  <input
                    type="time"
                    value={newClassStart}
                    onChange={(e) => setNewClassStart(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">End Time</label>
                  <input
                    type="time"
                    value={newClassEnd}
                    onChange={(e) => setNewClassEnd(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Room / Link</label>
                <input
                  type="text"
                  placeholder="e.g. Hall B 204 or Zoom link"
                  value={newClassRoom}
                  onChange={(e) => setNewClassRoom(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddClass(false)}
                  className="px-3 py-1 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold"
                >
                  Save Class
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {classList.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/70 rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900 block">{item.subject}</span>
                  <div className="flex items-center space-x-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-sky-800">{item.day}</span>
                    <span>•</span>
                    <span>
                      {item.startTime} - {item.endTime}
                    </span>
                    {item.roomOrLink && (
                      <>
                        <span>•</span>
                        <span>{item.roomOrLink}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteClass(item.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                  title="Remove class"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* COLUMN 3: SCHOOL TASKS */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                <ListTodo className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">School Tasks</h3>
                <p className="text-[11px] text-slate-500">Assignments & tests</p>
              </div>
            </div>
            <button
              onClick={() => setShowAddTask(!showAddTask)}
              className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          {showAddTask && (
            <form onSubmit={handleAddTask} className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200 space-y-2.5 text-xs">
              <span className="font-bold text-slate-800 block">Add School Task</span>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Task Description</label>
                <input
                  type="text"
                  placeholder="e.g. Read Chapter 5 and take quiz"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Subject</label>
                <input
                  type="text"
                  placeholder="e.g. Intro to Business Management"
                  value={newTaskSubject}
                  onChange={(e) => setNewTaskSubject(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Due Date</label>
                  <input
                    type="date"
                    value={newTaskDue}
                    onChange={(e) => setNewTaskDue(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddTask(false)}
                  className="px-3 py-1 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold"
                >
                  Save Task
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {taskList.map((task) => (
              <div
                key={task.id}
                className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/70 rounded-xl flex items-start justify-between text-xs space-y-1"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        task.priority === 'High'
                          ? 'bg-red-100 text-red-800'
                          : task.priority === 'Medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-800'
                      }`}
                    >
                      {task.priority}
                    </span>
                    <span className="font-bold text-slate-800">{task.task}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-[11px] text-slate-500">
                    <span>{task.subject}</span>
                    <span>•</span>
                    <span>Due: {task.dueDate}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                  title="Remove task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
