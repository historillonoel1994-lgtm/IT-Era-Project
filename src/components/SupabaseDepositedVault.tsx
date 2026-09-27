import React, { useState, useEffect } from 'react';
import {
  Database,
  FileText,
  Award,
  Clock,
  ShieldCheck,
  RefreshCw,
  Upload,
  User,
  CheckCircle2,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  Key,
  Server,
  Terminal,
  AlertCircle,
  Loader2,
  Check,
} from 'lucide-react';
import { UserProfile, LessonDocument, QuizResult, StudentProgress } from '../types';
import {
  supabase,
  STORAGE_BUCKET,
  checkIsConfigured,
  getActiveSupabaseConfig,
  testSupabaseConnection,
  setCurrentLearningMaterialId,
  ensureUserProfileAndProgress,
  DATA_UPDATED_EVENT,
} from '../lib/supabase';

interface SupabaseDepositedVaultProps {
  user: UserProfile;
  lessons: LessonDocument[];
  progress: StudentProgress;
  onOpenUpload: () => void;
  onSelectLesson: (lesson: LessonDocument) => void;
  onTakeQuiz: () => void;
  onDataRefreshed?: () => void;
}

interface SupabaseMaterialRow {
  id: string;
  user_id: string;
  title: string;
  file_name?: string;
  file_path?: string;
  total_pages?: number | null;
  created_at?: string;
}

interface SupabaseQuizRow {
  id: string;
  user_id: string;
  learning_material_id?: string | null;
  score: number;
  total_questions: number;
  created_at?: string;
}

export const SupabaseDepositedVault: React.FC<SupabaseDepositedVaultProps> = ({
  user,
  lessons,
  progress: propProgress,
  onOpenUpload,
  onSelectLesson,
  onTakeQuiz,
  onDataRefreshed,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'materials' | 'quizzes' | 'progress'>('all');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('Just now');
  const [showDevOptions, setShowDevOptions] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Real Supabase data states
  const [dbMaterials, setDbMaterials] = useState<SupabaseMaterialRow[]>([]);
  const [dbQuizzes, setDbQuizzes] = useState<SupabaseQuizRow[]>([]);
  const [dbStudyMinutes, setDbStudyMinutes] = useState<number>(0);
  const [dbTasksDone, setDbTasksDone] = useState<number>(0);
  const [dbVerifiedPages, setDbVerifiedPages] = useState<number>(0);
  const [dbAverageQuizScore, setDbAverageQuizScore] = useState<number>(0);

  // Friendly error notice
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);

  const isSupabaseReady = checkIsConfigured();
  const supabaseConfig = getActiveSupabaseConfig();

  // Load real data directly from Supabase
  const loadSupabaseData = async () => {
    if (!checkIsConfigured()) {
      setIsAuthenticated(false);
      return;
    }

    setSyncing(true);
    setDbErrorMessage(null);

    // 1. AUTHENTICATED USER
    const {
      data: { user: authUser },
      error: userError,
    } = await supabase.auth.getUser();

    if (!authUser) {
      setIsAuthenticated(false);
      setSyncing(false);
      setDbMaterials([]);
      setDbQuizzes([]);
      return;
    }

    setIsAuthenticated(true);
    const userId = authUser.id;

    // Ensure profiles and study_progress exist for this student
    ensureUserProfileAndProgress(authUser).catch((err) =>
      console.error('Profile DB error:', err)
    );

    // 3. SAVED LEARNING MATERIALS (load from learning_materials)
    try {
      let { data: materialsData, error: materialError } = await supabase
        .from('learning_materials')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (materialError && materialError.message?.includes('created_at')) {
        const retry = await supabase
          .from('learning_materials')
          .select('*')
          .eq('user_id', userId);
        materialsData = retry.data;
        materialError = retry.error;
      }

      if (materialError) {
        console.error('Material DB error:', materialError);
        setDbErrorMessage(materialError.message);
      } else {
        const rawMaterials = (materialsData as SupabaseMaterialRow[]) || [];
        const seenFiles = new Set<string>();
        const uniqueMaterials: SupabaseMaterialRow[] = [];
        const duplicateMaterialIds: string[] = [];

        for (const mat of rawMaterials) {
          const key = `${mat.file_name || ''}::${mat.file_path || ''}`;
          if (key !== '::' && seenFiles.has(key)) {
            if (mat.id) duplicateMaterialIds.push(mat.id);
          } else {
            if (key !== '::') seenFiles.add(key);
            uniqueMaterials.push(mat);
          }
        }

        if (duplicateMaterialIds.length > 0) {
          void Promise.resolve(supabase.from('learning_materials').delete().in('id', duplicateMaterialIds)).catch(() => {});
        }

        setDbMaterials(uniqueMaterials);
      }
    } catch (err: any) {
      console.error('Material DB error:', err);
      setDbErrorMessage(err.message || 'Failed to load learning materials');
    }

    // 5. COMPLETED QUIZ ATTEMPTS (load from quiz_attempts)
    let fetchedQuizzes: SupabaseQuizRow[] = [];
    try {
      let { data: quizzesData, error: quizError } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (quizError && quizError.message?.includes('created_at')) {
        const retry = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('user_id', userId);
        quizzesData = retry.data;
        quizError = retry.error;
      }

      if (quizError) {
        console.error('Quiz DB error:', quizError);
        setDbErrorMessage((prev) => prev || quizError.message);
      } else {
        const rawQuizzes = (quizzesData as SupabaseQuizRow[]) || [];
        const uniqueQuizzes: SupabaseQuizRow[] = [];
        const duplicateQuizIds: string[] = [];

        for (const q of rawQuizzes) {
          const isDup = uniqueQuizzes.some((existing) => {
            const sameScore = existing.score === q.score && existing.total_questions === q.total_questions;
            const sameMat = (existing.learning_material_id || '') === (q.learning_material_id || '');
            if (!sameScore || !sameMat) return false;
            if (existing.created_at && q.created_at) {
              return Math.abs(new Date(existing.created_at).getTime() - new Date(q.created_at).getTime()) <= 30000;
            }
            return true;
          });

          if (!isDup) {
            uniqueQuizzes.push(q);
          } else if (q.id) {
            duplicateQuizIds.push(q.id);
          }
        }

        if (duplicateQuizIds.length > 0) {
          void Promise.resolve(supabase.from('quiz_attempts').delete().in('id', duplicateQuizIds)).catch(() => {});
        }

        fetchedQuizzes = uniqueQuizzes;
        setDbQuizzes(fetchedQuizzes);
      }
    } catch (err: any) {
      console.error('Quiz DB error:', err);
      setDbErrorMessage((prev) => prev || err.message);
    }

    // 6. STUDY PROGRESS (load from study_progress)
    try {
      let { data: progRows, error: progressError } = await supabase
        .from('study_progress')
        .select('*')
        .eq('user_id', userId);

      if (progressError) {
        console.error('Progress DB error:', progressError);
        setDbErrorMessage((prev) => prev || progressError.message);
      }

      let progRow = progRows && progRows.length > 0 ? progRows[0] : null;

      // If multiple duplicate rows exist, select the best one and clean up redundant duplicates
      if (progRows && progRows.length > 1) {
        progRow = progRows.reduce((prev: any, curr: any) => {
          const prevScore = (prev.study_minutes || 0) + (prev.tasks_completed || 0) + (prev.verified_pages || 0);
          const currScore = (curr.study_minutes || 0) + (curr.tasks_completed || 0) + (curr.verified_pages || 0);
          return currScore > prevScore ? curr : prev;
        }, progRows[0]);

        if (progRow?.id) {
          const dupIds = progRows
            .filter((r: any) => r.id && r.id !== progRow.id)
            .map((r: any) => r.id);
          if (dupIds.length > 0) {
            await supabase.from('study_progress').delete().in('id', dupIds);
          }
        }
      }

      // If the logged-in user has no study_progress record, create one with:
      // user_id = user.id, study_minutes = 0, tasks_completed = 0, verified_pages = 0
      if (!progRow && !progressError) {
        const { data: newRows, error: insertProgErr } = await supabase
          .from('study_progress')
          .insert({
            user_id: userId,
            study_minutes: 0,
            tasks_completed: 0,
            verified_pages: 0,
          })
          .select();

        if (insertProgErr) {
          console.error('Progress DB error:', insertProgErr);
          setDbErrorMessage((prev) => prev || insertProgErr.message);
        } else if (newRows && newRows.length > 0) {
          progRow = newRows[0];
        }
      }

      // Study Time must come from study_progress.study_minutes
      setDbStudyMinutes(progRow?.study_minutes ?? 0);
      // Tasks Done must come from study_progress.tasks_completed
      setDbTasksDone(progRow?.tasks_completed ?? 0);
      // Verified Pages must come from study_progress.verified_pages
      setDbVerifiedPages(progRow?.verified_pages ?? 0);

      // Average Quiz Score must be calculated from quiz_attempts
      if (fetchedQuizzes.length > 0) {
        const totalPct = fetchedQuizzes.reduce((sum, q) => {
          const pct = q.total_questions > 0 ? (q.score / q.total_questions) * 100 : 0;
          return sum + pct;
        }, 0);
        setDbAverageQuizScore(Math.round(totalPct / fetchedQuizzes.length));
      } else {
        setDbAverageQuizScore(0);
      }
    } catch (err: any) {
      console.error('Progress DB error:', err);
      setDbErrorMessage((prev) => prev || err.message);
    }

    setLastSyncedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setSyncing(false);

    if (onDataRefreshed) {
      onDataRefreshed();
    }
  };

  useEffect(() => {
    loadSupabaseData();

    const handleUpdate = () => {
      loadSupabaseData();
    };

    window.addEventListener(DATA_UPDATED_EVENT, handleUpdate);
    window.addEventListener('focus', handleUpdate);

    return () => {
      window.removeEventListener(DATA_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('focus', handleUpdate);
    };
  }, [user.id, lessons.length, propProgress.quizzesCompleted, propProgress.tasksCompleted]);

  const handleRefreshData = async () => {
    await loadSupabaseData();
  };

  const handleTestDevConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testSupabaseConnection();
    setTesting(false);
    setTestResult(res.message);
  };

  // Helper to load a material into the app
  const handleMaterialClick = (mat: SupabaseMaterialRow) => {
    setCurrentLearningMaterialId(mat.id);
    const ext = (mat.file_name?.split('.').pop() || 'pdf').toLowerCase();
    const doc: LessonDocument = {
      id: mat.id,
      title: mat.title || mat.file_name || 'Learning Material',
      subject: 'Saved Course Material',
      totalPages: mat.total_pages || 1,
      uploadedAt: mat.created_at || new Date().toISOString(),
      fileName: mat.file_name,
      filePath: mat.file_path,
      fileType: ext,
      pages: [
        {
          pageNumber: 1,
          text: `[Document: ${mat.title || mat.file_name}]\nStored path: ${mat.file_path || 'saved in study-buddy-materials'}.\nReady for AI summarization and quiz generation.`,
        },
      ],
      isSample: false,
    };
    onSelectLesson(doc);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-start space-x-3.5">
          <div className="p-3 bg-gradient-to-br from-sky-600 to-indigo-800 text-white rounded-2xl shadow-sm shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2.5 py-0.5 rounded-full border border-sky-100">
                Your Study Library
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Saved & Synchronized</span>
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              Your Learning Materials & Study Activity
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Access your uploaded lesson materials, practice quiz results, and study progress saved in Supabase.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={handleRefreshData}
            disabled={syncing}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors flex items-center space-x-1.5 cursor-pointer"
            title="Fetch latest updates from Supabase database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-sky-600' : ''}`} />
            <span>{syncing ? 'Refreshing...' : 'Refresh Records'}</span>
          </button>

          <button
            onClick={onOpenUpload}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Material</span>
          </button>
        </div>
      </div>

      {/* Friendly Error Notice if Supabase reports an error */}
      {dbErrorMessage && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs flex items-center space-x-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <span className="font-bold">Database notification: </span>
            <span>{dbErrorMessage}</span>
          </div>
        </div>
      )}

      {/* Unauthenticated notice */}
      {!isAuthenticated && (
        <div className="p-4 bg-amber-50/80 border border-amber-200 text-amber-900 rounded-2xl text-xs flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-semibold">Please sign in to save your activity.</span>
          </div>
          <button
            onClick={onOpenUpload}
            className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-bold text-xs"
          >
            Sign In / Log In
          </button>
        </div>
      )}

      {/* DEVELOPER OPTIONS DRAWER */}
      {showDevOptions && (
        <div className="p-5 bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
                Developer & Cloud Diagnostics (Supabase Connection)
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Status: {isSupabaseReady ? '🟢 Configured & Connected' : '🟡 Pending Config'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
            {/* Dev Box 1: Student User ID */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 space-y-1">
              <span className="text-[10px] text-slate-400 block uppercase">Auth User ID (UUID)</span>
              <div className="text-emerald-300 font-bold text-[11px] truncate select-all" title={user.id}>
                {user.id}
              </div>
              <span className="text-[10px] text-slate-500 block">Row-Level Security key</span>
            </div>

            {/* Dev Box 2: Storage Bucket */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 space-y-1">
              <span className="text-[10px] text-slate-400 block uppercase">Storage Bucket</span>
              <div className="text-sky-300 font-bold text-[11px] truncate select-all">
                {STORAGE_BUCKET}
              </div>
              <span className="text-[10px] text-slate-500 block">Path: &#123;user_id&#125;/&#123;file&#125;</span>
            </div>

            {/* Dev Box 3: Database Tables */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 space-y-1">
              <span className="text-[10px] text-slate-400 block uppercase">Connected Tables</span>
              <div className="text-amber-300 font-bold text-[11px] truncate">
                profiles, learning_materials, quiz_attempts, study_progress
              </div>
              <span className="text-[10px] text-slate-500 block">4 tables synchronized</span>
            </div>

            {/* Dev Box 4: Project Endpoint */}
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 space-y-1">
              <span className="text-[10px] text-slate-400 block uppercase">Supabase Endpoint</span>
              <div className="text-indigo-300 font-bold text-[11px] truncate select-all">
                {supabaseConfig.url ? new URL(supabaseConfig.url).hostname : 'Not configured'}
              </div>
              <span className="text-[10px] text-slate-500 block">VITE_SUPABASE_URL</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <span>Diagnostic ping:</span>
              <button
                onClick={handleTestDevConnection}
                disabled={testing}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold cursor-pointer transition-colors"
              >
                {testing ? 'Testing...' : 'Ping Supabase API'}
              </button>
              {testResult && <span className="text-emerald-400 ml-1">{testResult}</span>}
            </div>

            <button
              onClick={() => setShowDevOptions(false)}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline font-mono cursor-pointer"
            >
              Hide Developer Options
            </button>
          </div>
        </div>
      )}

      {/* Student Identity Card */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-sky-50 via-white to-indigo-50/50 border border-sky-100 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-600 to-indigo-700 text-white font-black text-lg flex items-center justify-center shadow-xs">
            {user.fullName[0]}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-base text-slate-900">{user.fullName}</h3>
              <span className="text-[10px] font-bold text-sky-800 bg-sky-100/80 px-2 py-0.5 rounded-full">
                Active Student
              </span>
            </div>
            <p className="text-xs text-slate-500">{user.email}</p>
            <p className="text-xs text-slate-700 font-medium mt-0.5">
              <span>{user.degree}</span> • <span className="text-indigo-700 font-semibold">{user.jobTitle}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="p-2.5 bg-white border border-slate-200/80 rounded-xl text-center min-w-[90px]">
            <span className="text-[10px] text-slate-400 block font-semibold uppercase">Materials</span>
            <span className="text-lg font-bold text-sky-700">{dbMaterials.length}</span>
          </div>
          <div className="p-2.5 bg-white border border-slate-200/80 rounded-xl text-center min-w-[90px]">
            <span className="text-[10px] text-slate-400 block font-semibold uppercase">Quizzes</span>
            <span className="text-lg font-bold text-indigo-700">{dbQuizzes.length}</span>
          </div>
          <div className="p-2.5 bg-white border border-slate-200/80 rounded-xl text-center min-w-[90px]">
            <span className="text-[10px] text-slate-400 block font-semibold uppercase">Study Time</span>
            <span className="text-lg font-bold text-emerald-700">{dbStudyMinutes}m</span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex space-x-2 border-b border-slate-100 pb-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'all'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Overview (All Records)
        </button>
        <button
          onClick={() => setActiveTab('materials')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'materials'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Learning Materials ({dbMaterials.length})
        </button>
        <button
          onClick={() => setActiveTab('quizzes')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'quizzes'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Quiz Attempts ({dbQuizzes.length})
        </button>
        <button
          onClick={() => setActiveTab('progress')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'progress'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Study Progress Metrics
        </button>
      </div>

      {/* 1. SAVED LEARNING MATERIALS (loaded from learning_materials) */}
      {(activeTab === 'all' || activeTab === 'materials') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-sky-100 text-sky-800 rounded-lg">
                <FileText className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">
                Saved Learning Materials
              </h3>
              <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                {dbMaterials.length} Documents in Supabase
              </span>
            </div>

            <button
              onClick={onOpenUpload}
              className="text-xs text-sky-700 hover:text-sky-900 font-semibold cursor-pointer"
            >
              + Upload Material
            </button>
          </div>

          {dbMaterials.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 space-y-2">
              <Upload className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700">
                No learning materials saved yet.
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Upload a course PDF, Word document, or lecture deck. The file will be stored in bucket <code className="text-sky-800 font-mono font-semibold">{STORAGE_BUCKET}</code> and registered into your <code className="text-sky-800 font-mono font-semibold">learning_materials</code> table.
              </p>
              <button
                onClick={onOpenUpload}
                className="mt-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Upload Your First Material
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dbMaterials.map((mat) => {
                const ext = (mat.file_name?.split('.').pop() || 'pdf').toLowerCase();
                return (
                  <div
                    key={mat.id}
                    onClick={() => handleMaterialClick(mat)}
                    className="p-4 bg-slate-50 hover:bg-sky-50/70 border border-slate-200 hover:border-sky-300 rounded-2xl transition-all cursor-pointer space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-1.5 mb-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-200/80 text-slate-700">
                            {ext.toUpperCase()}
                          </span>
                          <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-1">
                            {mat.title || mat.file_name}
                          </h4>
                        </div>
                        <p className="text-xs text-slate-500 truncate max-w-xs">
                          {mat.file_name || mat.file_path || 'Uploaded Document'}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded-md text-[10px] font-bold shrink-0">
                        {mat.total_pages ? `${mat.total_pages} Pages` : '1 Document'}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="text-[11px] text-slate-600">
                        {mat.created_at ? new Date(mat.created_at).toLocaleDateString() : 'Saved in cloud'}
                      </span>
                      <span className="text-sky-700 font-semibold hover:underline">
                        Load Lesson →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. COMPLETED QUIZ ATTEMPTS (loaded from quiz_attempts) */}
      {(activeTab === 'all' || activeTab === 'quizzes') && (
        <div className="space-y-3 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-indigo-100 text-indigo-800 rounded-lg">
                <Award className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">
                Completed Quiz Attempts
              </h3>
              <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                {dbQuizzes.length} Attempts in Supabase
              </span>
            </div>

            <button
              onClick={onTakeQuiz}
              className="text-xs text-indigo-700 hover:text-indigo-900 font-semibold cursor-pointer"
            >
              + Generate Practice Quiz
            </button>
          </div>

          {dbQuizzes.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50 space-y-2">
              <Award className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700">
                No quiz attempts completed yet.
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Generate an AI practice quiz from any lesson. When you finish, your score, question count, and mastery percentage are saved into <code className="text-indigo-800 font-mono font-semibold">quiz_attempts</code>.
              </p>
              <button
                onClick={onTakeQuiz}
                className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Take a Practice Quiz Now
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Material ID / Record</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Percentage</th>
                    <th className="px-4 py-3">Completed Date</th>
                    <th className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {dbQuizzes.map((q) => {
                    const percentage =
                      q.total_questions > 0 ? Math.round((q.score / q.total_questions) * 100) : 0;
                    return (
                      <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {q.learning_material_id ? (
                            <span className="font-mono text-[11px] text-slate-700">
                              {q.learning_material_id.slice(0, 13)}...
                            </span>
                          ) : (
                            <span className="text-slate-600">Practice Quiz</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-slate-800">
                          {q.score} / {q.total_questions}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                              percentage >= 80
                                ? 'bg-emerald-100 text-emerald-800'
                                : percentage >= 60
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {percentage}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {q.created_at
                            ? new Date(q.created_at).toLocaleDateString() +
                              ' ' +
                              new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Saved in database'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center space-x-1 text-emerald-700 text-[11px] font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Saved</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. STUDY PROGRESS (loaded from study_progress + quiz_attempts) */}
      {(activeTab === 'all' || activeTab === 'progress') && (
        <div className="space-y-3 pt-3">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">
              Study Progress Analytics (Supabase Records)
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-1">
              <span className="text-2xl font-black text-sky-700">{dbStudyMinutes}m</span>
              <span className="text-[11px] font-semibold text-slate-500 block">Study Time (study_minutes)</span>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-1">
              <span className="text-2xl font-black text-indigo-700">{dbQuizzes.length}</span>
              <span className="text-[11px] font-semibold text-slate-500 block">Quizzes Taken (quiz_attempts)</span>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-1">
              <span className="text-2xl font-black text-emerald-700">{dbAverageQuizScore}%</span>
              <span className="text-[11px] font-semibold text-slate-500 block">Average Quiz Score</span>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-1">
              <span className="text-2xl font-black text-amber-700">{dbVerifiedPages}</span>
              <span className="text-[11px] font-semibold text-slate-500 block">Verified Pages</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer bar */}
      <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center space-x-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Real Supabase records loaded for student ID {user.id}.</span>
        </div>
        <div className="flex items-center space-x-3 text-[11px] text-slate-400">
          <span>Synced: {lastSyncedTime}</span>
        </div>
      </div>
    </div>
  );
};
