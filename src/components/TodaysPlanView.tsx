import React, { useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Briefcase,
  GraduationCap,
  BookOpen,
  Coffee,
  HelpCircle,
  Plus,
  Trash2,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { TodayPlanItem } from '../types';
import { getTodayPlan, saveTodayPlan, updateProgress, getStudentProgress } from '../services/storage';

interface TodaysPlanViewProps {
  onNavigateToTimer: () => void;
  onNavigateToQuiz: () => void;
  onNavigateToSummary: () => void;
}

export const TodaysPlanView: React.FC<TodaysPlanViewProps> = ({
  onNavigateToTimer,
  onNavigateToQuiz,
  onNavigateToSummary,
}) => {
  const [items, setItems] = useState<TodayPlanItem[]>(getTodayPlan());
  const [filter, setFilter] = useState<'all' | 'work' | 'class' | 'study' | 'break'>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  // New item form
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('18:00 - 18:30');
  const [newCategory, setNewCategory] = useState<TodayPlanItem['category']>('study');
  const [newDesc, setNewDesc] = useState('');

  const completedCount = items.filter((i) => i.completed).length;
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  const handleToggle = (id: string) => {
    const updated = items.map((i) => {
      if (i.id === id) {
        return { ...i, completed: !i.completed };
      }
      return i;
    });
    setItems(updated);
    saveTodayPlan(updated);

    const newCompletedCount = updated.filter((i) => i.completed).length;
    updateProgress({ tasksCompleted: newCompletedCount });
  };

  const handleDelete = (id: string) => {
    const updated = items.filter((i) => i.id !== id);
    setItems(updated);
    saveTodayPlan(updated);
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newItem: TodayPlanItem = {
      id: `tp-${Date.now()}`,
      title: newTitle.trim(),
      timeSlot: newTime.trim(),
      category: newCategory,
      description: newDesc.trim() || undefined,
      completed: false,
    };

    const updated = [...items, newItem];
    setItems(updated);
    saveTodayPlan(updated);
    setShowAddModal(false);
    setNewTitle('');
    setNewDesc('');
  };

  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'work') return item.category === 'work';
    if (filter === 'class') return item.category === 'class';
    if (filter === 'study') return ['study', 'quiz_review', 'assignment'].includes(item.category);
    if (filter === 'break') return item.category === 'break';
    return true;
  });

  const getCategoryBadge = (cat: TodayPlanItem['category']) => {
    switch (cat) {
      case 'work':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-white">
            <Briefcase className="w-3 h-3" />
            <span>Work Shift</span>
          </span>
        );
      case 'class':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800">
            <GraduationCap className="w-3 h-3" />
            <span>Class Lecture</span>
          </span>
        );
      case 'study':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">
            <BookOpen className="w-3 h-3" />
            <span>Study Session</span>
          </span>
        );
      case 'quiz_review':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
            <HelpCircle className="w-3 h-3" />
            <span>Quiz Review</span>
          </span>
        );
      case 'break':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <Coffee className="w-3 h-3" />
            <span>Rest & Break</span>
          </span>
        );
      case 'assignment':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">
            <ClipboardList className="w-3 h-3" />
            <span>Assignment</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-emerald-600 to-teal-800 text-white rounded-xl shadow-sm shrink-0">
              <CalendarDays className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-0.5 rounded-full">
                  Supporting Feature 5 • Today's Plan
                </span>
                <span className="text-xs text-slate-400">Daily Execution</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Today's Integrated Schedule
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Track your work shifts, classes, study sessions, and mandatory rest periods.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-sm transition-all flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Activity</span>
            </button>
          </div>
        </div>

        {/* Progress tracker */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-slate-700">
              Today's Completion: {completedCount} of {items.length} ({progressPercent}%)
            </span>
            <div className="w-40 bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Quick filter tabs */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl text-xs font-medium text-slate-600">
            {(['all', 'work', 'class', 'study', 'break'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1 rounded-lg capitalize transition-colors ${
                  filter === cat ? 'bg-white text-slate-900 font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Schedule Items List */}
      <div className="space-y-3">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className={`bg-white rounded-2xl border transition-all p-4 shadow-sm flex items-start justify-between gap-4 ${
              item.completed
                ? 'border-slate-200/60 bg-slate-50/50 opacity-75'
                : 'border-slate-200 hover:border-sky-300'
            }`}
          >
            <div className="flex items-start space-x-3.5 flex-1">
              <button
                onClick={() => handleToggle(item.id)}
                className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors shrink-0"
              >
                {item.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Circle className="w-5 h-5" />
                )}
              </button>

              <div className="space-y-1 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-bold ${
                      item.completed ? 'line-through text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    {item.title}
                  </span>
                  {getCategoryBadge(item.category)}
                  <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    {item.timeSlot}
                  </span>
                </div>

                {item.description && (
                  <p
                    className={`text-xs leading-relaxed ${
                      item.completed ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    {item.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {item.category === 'study' && !item.completed && (
                <button
                  onClick={onNavigateToTimer}
                  className="px-2.5 py-1 text-[11px] font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors"
                >
                  Start Timer
                </button>
              )}
              {item.category === 'quiz_review' && !item.completed && (
                <button
                  onClick={onNavigateToQuiz}
                  className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  Take Quiz
                </button>
              )}
              <button
                onClick={() => handleDelete(item.id)}
                className="text-slate-300 hover:text-red-500 p-1 transition-colors"
                title="Delete item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {filteredItems.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
            No activities matching this filter. Click "Add Activity" above to schedule your day.
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Add to Today's Plan</h3>

            <form onSubmit={handleAddItem} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Activity Title</label>
                <input
                  type="text"
                  placeholder="e.g. Study Session: Review Chapter 5"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Time Slot</label>
                  <input
                    type="text"
                    placeholder="e.g. 18:00 - 18:45"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl bg-white font-medium"
                  >
                    <option value="study">Study Session</option>
                    <option value="quiz_review">Quiz Review</option>
                    <option value="break">Rest & Break</option>
                    <option value="work">Work Shift</option>
                    <option value="class">Class Lecture</option>
                    <option value="assignment">Assignment</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Notes / Description</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Focus on Schumpeter definition and Lean startup loop"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl bg-white resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl"
                >
                  Save Activity
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
