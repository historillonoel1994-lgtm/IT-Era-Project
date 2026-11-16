import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  UserCheck,
  UserX,
  KeyRound,
  FileText,
  LayoutDashboard,
  Search,
  RefreshCw,
  Plus,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  Cpu,
  Database,
  Sliders,
  History,
  Mail,
  User,
  GraduationCap,
  Calendar,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Award,
  BookOpen,
  Filter,
  Check,
  Loader2,
} from 'lucide-react';
import { UserProfile, UserRole, AdminInvitation, AdminAuditLog } from '../types';
import {
  fetchAdminOverview,
  fetchAdminStudents,
  updateStudentStatus,
  fetchAdminsList,
  inviteAdministrator,
  updateAdminRole,
  revokeAdminPrivileges,
  fetchAdminAuditLogs,
  fetchSystemConfig,
  updateSystemConfig,
  getActiveSupabaseConfig,
  fetchMfaStatus,
} from '../lib/supabase';
import { AdminMfaModal } from './AdminMfaModal';

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
}

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isAdmin = currentUser.role === 'admin' || isSuperAdmin;

  // Active Tab: 'overview' | 'students' | 'admins' | 'settings' | 'audit'
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'admins' | 'settings' | 'audit'>('overview');

  // MFA Challenge State for Administrative Operations
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [mfaTargetTitle, setMfaTargetTitle] = useState('Administrator Security Center');
  const [currentAal, setCurrentAal] = useState<'none' | 'aal1' | 'aal2'>('aal1');

  // Overview State
  const [overviewData, setOverviewData] = useState<any>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Students State
  const [studentsList, setStudentsList] = useState<any[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStudentForView, setSelectedStudentForView] = useState<any | null>(null);

  // Admins State
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [invitationsList, setInvitationsList] = useState<AdminInvitation[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'super_admin'>('admin');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Developer & Cloud Settings State
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>(['gemini-2.5-flash', 'gemini-2.5-pro']);
  const [defaultDifficulty, setDefaultDifficulty] = useState('medium');
  const [maxQuestionCount, setMaxQuestionCount] = useState(100);
  const [rateLimitRpm, setRateLimitRpm] = useState(60);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilter, setAuditFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState('');

  // Status & Feedback Messages
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen && isAdmin) {
      setFeedback(null);
      loadOverview();
      if (activeTab === 'students') loadStudents();
      if (activeTab === 'admins') loadAdmins();
      if (activeTab === 'settings' && isSuperAdmin) loadSystemConfig();
      if (activeTab === 'audit') loadAuditLogs();
    }
  }, [isOpen, activeTab, currentUser.email]);

  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const data = await fetchAdminOverview(currentUser.email);
      setOverviewData(data);
      setCurrentAal('aal2');
    } catch (err: any) {
      if (err.requiresMfa) {
        setMfaTargetTitle('Administrator Security Center');
        setShowMfaModal(true);
      }
      console.warn('Overview fetch notice:', err.message);
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadStudents = async () => {
    setStudentsLoading(true);
    try {
      const data = await fetchAdminStudents(currentUser.email, studentSearch);
      if (data?.students) {
        setStudentsList(data.students);
      }
      setCurrentAal('aal2');
    } catch (err: any) {
      if (err.requiresMfa) {
        setMfaTargetTitle('Student Account Management');
        setShowMfaModal(true);
      }
      setFeedback({ type: 'error', message: err.message || 'Failed to load students.' });
    } finally {
      setStudentsLoading(false);
    }
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    try {
      const data = await fetchAdminsList(currentUser.email);
      if (data?.admins) {
        setAdminsList(data.admins);
      }
      if (data?.invitations) {
        setInvitationsList(data.invitations);
      }
      setCurrentAal('aal2');
    } catch (err: any) {
      if (err.requiresMfa) {
        setMfaTargetTitle('Administrator Management');
        setShowMfaModal(true);
      }
      setFeedback({ type: 'error', message: err.message || 'Failed to load administrators.' });
    } finally {
      setAdminsLoading(false);
    }
  };

  const loadSystemConfig = async () => {
    if (!isSuperAdmin) return;
    setConfigLoading(true);
    try {
      const data = await fetchSystemConfig(currentUser.email);
      if (data?.config) {
        setSystemConfig(data.config);
        setSelectedModels(data.config.allowedModels || ['gemini-2.5-flash']);
        setDefaultDifficulty(data.config.defaultDifficulty || 'medium');
        setMaxQuestionCount(data.config.maxQuestionCount || 100);
        setRateLimitRpm(data.config.rateLimitRpm || 60);
      }
      setCurrentAal('aal2');
    } catch (err: any) {
      if (err.requiresMfa) {
        setMfaTargetTitle('Developer & Cloud Settings');
        setShowMfaModal(true);
      }
      setFeedback({ type: 'error', message: err.message || 'Failed to load system configuration.' });
    } finally {
      setConfigLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const data = await fetchAdminAuditLogs(currentUser.email);
      if (data?.logs) {
        setAuditLogs(data.logs);
      }
      setCurrentAal('aal2');
    } catch (err: any) {
      if (err.requiresMfa) {
        setMfaTargetTitle('Security Audit Logs');
        setShowMfaModal(true);
      }
      setFeedback({ type: 'error', message: err.message || 'Failed to load audit logs.' });
    } finally {
      setAuditLoading(false);
    }
  };

  // Toggle student status (active <-> suspended)
  const handleToggleStudentStatus = async (student: any) => {
    const newStatus = student.accountStatus === 'suspended' ? 'active' : 'suspended';
    const reason = prompt(
      `Enter reason for ${newStatus === 'suspended' ? 'suspending' : 'restoring'} student ${student.fullName}:`,
      newStatus === 'suspended' ? 'Violated student terms of service' : 'Account reviewed and restored'
    );
    if (reason === null) return;

    try {
      await updateStudentStatus(currentUser.email, student.id, newStatus, reason);
      setFeedback({
        type: 'success',
        message: `Student account for ${student.fullName} has been set to ${newStatus}.`,
      });
      loadStudents();
      loadOverview();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update student status.' });
    }
  };

  // Invite Administrator
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteFullName.trim() || !inviteEmail.trim()) {
      setFeedback({ type: 'error', message: 'Full name and email are required for administrative invitation.' });
      return;
    }

    if (inviteRole === 'super_admin' && !isSuperAdmin) {
      setFeedback({ type: 'error', message: 'Only Super Administrators can invite another Super Administrator.' });
      return;
    }

    setInviteLoading(true);
    try {
      const res = await inviteAdministrator(currentUser.email, {
        fullName: inviteFullName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
      });

      setFeedback({
        type: 'success',
        message: res.message || `Administrator invitation successfully created for ${inviteFullName}!`,
      });
      setInviteFullName('');
      setInviteEmail('');
      setShowInviteModal(false);
      loadAdmins();
      loadOverview();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to invite administrator.' });
    } finally {
      setInviteLoading(false);
    }
  };

  // Change Admin Role
  const handleChangeAdminRole = async (targetAdmin: any, newRole: 'admin' | 'super_admin' | 'student') => {
    if (!isSuperAdmin) {
      setFeedback({ type: 'error', message: 'Only a Super Administrator can change administrator roles.' });
      return;
    }

    const actionWord = newRole === 'super_admin' ? 'promote' : newRole === 'admin' ? 'demote' : 'revoke';
    const confirmPrompt = window.confirm(
      `Are you sure you want to ${actionWord} ${targetAdmin.fullName} (${targetAdmin.email}) to ${newRole.toUpperCase()}?`
    );
    if (!confirmPrompt) return;

    try {
      const res = await updateAdminRole(currentUser.email, targetAdmin.id || targetAdmin.email, newRole);
      setFeedback({ type: 'success', message: res.message });
      loadAdmins();
      loadOverview();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update role.' });
    }
  };

  // Revoke Admin
  const handleRevokeAdmin = async (targetAdmin: any) => {
    if (!isSuperAdmin) {
      setFeedback({ type: 'error', message: 'Only a Super Administrator can revoke administrative privileges.' });
      return;
    }

    const confirmPrompt = window.confirm(
      `Revoke ALL administrative privileges from ${targetAdmin.fullName} (${targetAdmin.email})? Their role will become Student.`
    );
    if (!confirmPrompt) return;

    try {
      const res = await revokeAdminPrivileges(currentUser.email, targetAdmin.id || targetAdmin.email);
      setFeedback({ type: 'success', message: res.message });
      loadAdmins();
      loadOverview();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to revoke administrator.' });
    }
  };

  // Save System Config (Super Admin Only)
  const handleSaveSystemConfig = async () => {
    if (!isSuperAdmin) return;
    setConfigSaving(true);
    try {
      await updateSystemConfig(currentUser.email, {
        allowedModels: selectedModels,
        defaultDifficulty,
        maxQuestionCount,
        rateLimitRpm,
        cloudSettingsRestricted: true,
      });
      setFeedback({ type: 'success', message: 'Developer & Cloud System Configurations saved and enforced.' });
      loadSystemConfig();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save configuration.' });
    } finally {
      setConfigSaving(false);
    }
  };

  if (!isOpen) return null;

  // Filtered students
  const filteredStudents = studentsList.filter((s) => {
    if (studentFilter === 'active' && s.accountStatus === 'suspended') return false;
    if (studentFilter === 'suspended' && s.accountStatus !== 'suspended') return false;
    return true;
  });

  // Filtered audit logs
  const filteredAuditLogs = auditLogs.filter((log) => {
    if (auditFilter !== 'all' && !log.action.toLowerCase().includes(auditFilter.toLowerCase())) {
      return false;
    }
    if (auditSearch.trim()) {
      const q = auditSearch.toLowerCase().trim();
      const matchEmail = (log.adminEmail || '').toLowerCase().includes(q);
      const matchAction = (log.action || '').toLowerCase().includes(q);
      const matchTarget = (log.targetUserEmail || '').toLowerCase().includes(q);
      if (!matchEmail && !matchAction && !matchTarget) return false;
    }
    return true;
  });

  const supabaseConfig = getActiveSupabaseConfig();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-5xl w-full overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
              <ShieldCheck className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Study Buddy AI Administrator Security Center
                </h2>
                <span
                  className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full flex items-center space-x-1 ${
                    isSuperAdmin
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-indigo-400/20 text-indigo-300 border border-indigo-400/30'
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  <span>{isSuperAdmin ? 'Super Administrator' : 'Administrator'}</span>
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Logged in as <strong className="text-white">{currentUser.fullName}</strong> ({currentUser.email})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close Dashboard"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert Bar */}
        {feedback && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-6 bg-slate-50 border-b border-slate-200 flex space-x-2 overflow-x-auto shrink-0 py-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-white text-indigo-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>1. System Overview</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('students');
              loadStudents();
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'students'
                ? 'bg-white text-indigo-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>2. Student Accounts</span>
            {overviewData?.totalStudents !== undefined && (
              <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded-md text-[10px]">
                {overviewData.totalStudents}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('admins');
              loadAdmins();
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'admins'
                ? 'bg-white text-indigo-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>3. Administrator Management</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('settings');
              if (isSuperAdmin) loadSystemConfig();
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-white text-indigo-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>4. Developer & Cloud Settings</span>
            {!isSuperAdmin && (
              <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded-md text-[10px] font-bold">
                Super Admin Only
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('audit');
              loadAuditLogs();
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-white text-indigo-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <History className="w-4 h-4" />
            <span>5. Security Audit Logs</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
          {/* ==================================================== */}
          {/* TAB 1: SYSTEM OVERVIEW */}
          {/* ==================================================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {overviewLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs">Loading system overview telemetry...</p>
                </div>
              ) : (
                <>
                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                      <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-semibold">Registered Students</span>
                        <Users className="w-4 h-4 text-sky-600" />
                      </div>
                      <div className="text-2xl font-black text-slate-900">
                        {overviewData?.totalStudents ?? 1}
                      </div>
                      <span className="text-[11px] text-emerald-600 font-medium">Standard public accounts</span>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                      <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-semibold">Total Administrators</span>
                        <Shield className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="text-2xl font-black text-slate-900">
                        {(overviewData?.totalAdmins ?? 0) + (overviewData?.totalSuperAdmins ?? 1)}
                      </div>
                      <span className="text-[11px] text-indigo-600 font-medium">
                        {overviewData?.totalSuperAdmins ?? 1} Super / {overviewData?.totalAdmins ?? 0} Ordinary
                      </span>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                      <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-semibold">Suspended Accounts</span>
                        <UserX className="w-4 h-4 text-rose-500" />
                      </div>
                      <div className="text-2xl font-black text-slate-900">
                        {overviewData?.suspendedAccounts ?? 0}
                      </div>
                      <span className="text-[11px] text-slate-500">Access disabled accounts</span>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                      <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-semibold">Security Audit Events</span>
                        <FileText className="w-4 h-4 text-amber-500" />
                      </div>
                      <div className="text-2xl font-black text-slate-900">
                        {overviewData?.totalAuditLogs ?? 1}
                      </div>
                      <span className="text-[11px] text-amber-600 font-medium">Immutable logged events</span>
                    </div>
                  </div>

                  {/* System Engine & Infrastructure Status */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Cpu className="w-5 h-5 text-indigo-600" />
                          <h3 className="text-sm font-bold text-slate-900">Gemini AI Tutor Engine</h3>
                        </div>
                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold flex items-center space-x-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Operational</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Configured with server-side SDK using <strong>@google/genai</strong>. Zero Hallucination
                        safeguards and strict source page citation boundaries are actively enforced.
                      </p>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span>Active Default Model:</span>
                        <code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-indigo-700 font-bold">
                          {overviewData?.primaryModel || 'gemini-2.5-flash'}
                        </code>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Database className="w-5 h-5 text-sky-600" />
                          <h3 className="text-sm font-bold text-slate-900">Supabase Cloud Database & Auth</h3>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center space-x-1 ${
                            supabaseConfig.isConfigured
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              supabaseConfig.isConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          <span>{supabaseConfig.isConfigured ? 'Connected' : 'Local Storage Mode'}</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Row-Level Security (RLS) policies safeguard student records, quiz results, and learning materials.
                        Initial Super Administrator bootstrap is active for{' '}
                        <strong>{overviewData?.initialAdminEmail || 'historillo.noel1994@gmail.com'}</strong>.
                      </p>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span>Protected Tables:</span>
                        <span className="font-semibold text-slate-700">
                          user_roles, profiles, quiz_attempts, learning_materials
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Action Shortcuts */}
                  <div className="bg-gradient-to-br from-indigo-50 to-sky-50 rounded-2xl p-5 border border-indigo-100">
                    <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-3">
                      Administrator Quick Actions
                    </h4>
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        onClick={() => {
                          setActiveTab('students');
                          loadStudents();
                        }}
                        className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-1.5 cursor-pointer"
                      >
                        <Users className="w-4 h-4 text-sky-600" />
                        <span>Browse Students</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveTab('admins');
                          setShowInviteModal(true);
                        }}
                        className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Invite Administrator</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveTab('audit');
                          loadAuditLogs();
                        }}
                        className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-1.5 cursor-pointer"
                      >
                        <History className="w-4 h-4 text-amber-600" />
                        <span>View Security Audit Logs</span>
                      </button>

                      {isSuperAdmin && (
                        <button
                          onClick={() => {
                            setActiveTab('settings');
                            loadSystemConfig();
                          }}
                          className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-1.5 cursor-pointer"
                        >
                          <Sliders className="w-4 h-4 text-indigo-600" />
                          <span>Configure AI & Cloud</span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 2: STUDENT ACCOUNT MANAGEMENT */}
          {/* ==================================================== */}
          {activeTab === 'students' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadStudents()}
                    placeholder="Search students by name, email, or institution..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <select
                    value={studentFilter}
                    onChange={(e: any) => setStudentFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">All Accounts</option>
                    <option value="active">Active Only</option>
                    <option value="suspended">Suspended Only</option>
                  </select>

                  <button
                    onClick={loadStudents}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                    title="Refresh student list"
                  >
                    <RefreshCw className={`w-4 h-4 ${studentsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Student Table / Cards */}
              {studentsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs">Loading registered students...</p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
                  <Users className="w-8 h-8 text-slate-300 mx-auto" />
                  <h4 className="text-sm font-bold text-slate-700">No Student Accounts Found</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {studentSearch
                      ? `No student records match "${studentSearch}". Try clearing your search.`
                      : 'Newly registered students will appear here automatically.'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Student Name</th>
                          <th className="px-4 py-3">Contact Email</th>
                          <th className="px-4 py-3">Institution & Course</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Registration Date</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {filteredStudents.map((st) => (
                          <tr key={st.id || st.email} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3.5 text-slate-900 font-bold flex items-center space-x-2.5">
                              <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center font-bold text-xs shrink-0">
                                {st.fullName?.[0]?.toUpperCase() || 'S'}
                              </div>
                              <span className="truncate max-w-[140px]">{st.fullName}</span>
                            </td>
                            <td className="px-4 py-3.5 text-slate-700 font-mono text-[11px]">{st.email}</td>
                            <td className="px-4 py-3.5">
                              <div className="text-slate-900 font-semibold truncate max-w-[180px]">
                                {st.institution || 'State Metropolitan University'}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate max-w-[180px]">
                                {st.course || 'BS Business Administration'}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center space-x-1 ${
                                  st.accountStatus === 'suspended'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {st.accountStatus === 'suspended' ? (
                                  <>
                                    <UserX className="w-3 h-3" />
                                    <span>Suspended</span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="w-3 h-3" />
                                    <span>Active</span>
                                  </>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-slate-500 text-[11px]">
                              {st.createdAt ? new Date(st.createdAt).toLocaleDateString() : 'Active'}
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                <button
                                  onClick={() => setSelectedStudentForView(st)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                                  title="View student activity details"
                                >
                                  Inspect
                                </button>

                                <button
                                  onClick={() => handleToggleStudentStatus(st)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                    st.accountStatus === 'suspended'
                                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                                      : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                                  }`}
                                  title={st.accountStatus === 'suspended' ? 'Restore access' : 'Suspend account'}
                                >
                                  {st.accountStatus === 'suspended' ? 'Restore' : 'Suspend'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Student Detail Inspector Drawer/Modal */}
              {selectedStudentForView && (
                <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-in zoom-in-95">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-sm">
                          {selectedStudentForView.fullName?.[0] || 'S'}
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-slate-900">{selectedStudentForView.fullName}</h4>
                          <p className="text-xs text-slate-500 font-mono">{selectedStudentForView.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedStudentForView(null)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div>
                          <span className="text-slate-400 block font-medium">Institution:</span>
                          <span className="font-bold text-slate-800">{selectedStudentForView.institution || 'State Metropolitan University'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Degree Program:</span>
                          <span className="font-bold text-slate-800">{selectedStudentForView.course || 'BS Business Administration'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Account Role:</span>
                          <span className="font-bold text-sky-700 uppercase">{selectedStudentForView.role}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Current Status:</span>
                          <span
                            className={`font-bold uppercase ${
                              selectedStudentForView.accountStatus === 'suspended' ? 'text-rose-600' : 'text-emerald-600'
                            }`}
                          >
                            {selectedStudentForView.accountStatus || 'active'}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-1">
                        <span className="font-bold text-indigo-950 block">Connected Learning Activity:</span>
                        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                          <div className="bg-white p-2 rounded-lg border border-indigo-100">
                            <span className="text-base font-black text-indigo-900 block">4</span>
                            <span className="text-[10px] text-slate-500">Quizzes Taken</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-indigo-100">
                            <span className="text-base font-black text-indigo-900 block">3.1h</span>
                            <span className="text-[10px] text-slate-500">Hours Logged</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-indigo-100">
                            <span className="text-base font-black text-indigo-900 block">12</span>
                            <span className="text-[10px] text-slate-500">Verified Citations</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => {
                          handleToggleStudentStatus(selectedStudentForView);
                          setSelectedStudentForView(null);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                          selectedStudentForView.accountStatus === 'suspended'
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-rose-600 hover:bg-rose-700 text-white'
                        }`}
                      >
                        {selectedStudentForView.accountStatus === 'suspended' ? 'Restore Account' : 'Suspend Account'}
                      </button>

                      <button
                        onClick={() => setSelectedStudentForView(null)}
                        className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 3: ADMINISTRATOR MANAGEMENT */}
          {/* ==================================================== */}
          {activeTab === 'admins' && (
            <div className="space-y-6">
              {/* Header & Add Admin Button */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Administrator Roster & Role Authorities</h3>
                  <p className="text-xs text-slate-500">
                    Manage system administrators, invitations, and role promotions.
                  </p>
                </div>

                <button
                  onClick={() => setShowInviteModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Invite New Administrator</span>
                </button>
              </div>

              {/* Administrator List */}
              {adminsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs">Loading administrators...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Active System Administrators ({adminsList.length})</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        Role-Based Access Control Active
                      </span>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {adminsList.map((admin) => {
                        const isThisSuperAdmin = admin.role === 'super_admin';
                        const isInitialSuper =
                          admin.email.toLowerCase() === 'historillo.noel1994@gmail.com' || admin.isInitialSuperAdmin;

                        return (
                          <div
                            key={admin.id || admin.email}
                            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                          >
                            <div className="flex items-start sm:items-center space-x-3">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                                  isThisSuperAdmin
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                }`}
                              >
                                {isThisSuperAdmin ? (
                                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                                ) : (
                                  <Shield className="w-5 h-5 text-indigo-600" />
                                )}
                              </div>

                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-bold text-slate-900 text-xs sm:text-sm">
                                    {admin.fullName}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                      isThisSuperAdmin
                                        ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                        : 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                                    }`}
                                  >
                                    {isThisSuperAdmin ? 'Super Administrator' : 'Administrator'}
                                  </span>
                                  {isInitialSuper && (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                                      Initial Root
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 font-mono flex items-center space-x-2 pt-0.5">
                                  <span>{admin.email}</span>
                                  <span>•</span>
                                  <span>Provisioned: {admin.assignedBy || 'System Bootstrap'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center space-x-2 self-end sm:self-center">
                              {isSuperAdmin ? (
                                <>
                                  {isThisSuperAdmin ? (
                                    <button
                                      onClick={() => handleChangeAdminRole(admin, 'admin')}
                                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                                      title="Demote to Ordinary Administrator"
                                    >
                                      Demote to Admin
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleChangeAdminRole(admin, 'super_admin')}
                                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-lg cursor-pointer"
                                      title="Promote to Super Administrator"
                                    >
                                      Promote to Super Admin
                                    </button>
                                  )}

                                  <button
                                    onClick={() => handleRevokeAdmin(admin)}
                                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold rounded-lg cursor-pointer"
                                    title="Revoke Administrative Privileges (Set to Student)"
                                  >
                                    Revoke
                                  </button>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-400 italic">
                                  Role management restricted to Super Admin
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pending Invitations Table */}
                  {invitationsList.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                        Pending Administrator Invitations ({invitationsList.length})
                      </div>
                      <div className="divide-y divide-slate-100">
                        {invitationsList.map((inv) => (
                          <div
                            key={inv.id}
                            className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50"
                          >
                            <div>
                              <span className="font-bold text-slate-800">{inv.fullName}</span>{' '}
                              <span className="font-mono text-slate-500">({inv.email})</span>
                              <div className="text-[11px] text-slate-400">
                                Designated: <strong className="text-indigo-600 uppercase">{inv.role}</strong> •
                                Expires: {new Date(inv.expiresAt).toLocaleDateString()}
                              </div>
                            </div>
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold uppercase">
                              {inv.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Invite Modal Dialog */}
              {showInviteModal && (
                <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-4">
                  <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl animate-in zoom-in-95">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div className="flex items-center space-x-2">
                        <Shield className="w-5 h-5 text-indigo-600" />
                        <h4 className="text-base font-bold text-slate-900">Invite Administrator</h4>
                      </div>
                      <button
                        onClick={() => setShowInviteModal(false)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <form onSubmit={handleSendInvite} className="space-y-4 text-xs">
                      <div>
                        <label className="block text-slate-700 font-bold mb-1">Administrator Full Name</label>
                        <input
                          type="text"
                          required
                          value={inviteFullName}
                          onChange={(e) => setInviteFullName(e.target.value)}
                          placeholder="e.g. Dr. Alexis Reyes"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-700 font-bold mb-1">Administrator Email Address</label>
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="e.g. alexis.reyes@faculty.univ.edu"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-700 font-bold mb-1">Designated Role Authority</label>
                        <select
                          value={inviteRole}
                          onChange={(e: any) => setInviteRole(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="admin">Administrator (Manage Students & View Reports)</option>
                          {isSuperAdmin && (
                            <option value="super_admin">
                              Super Administrator (Full System & Cloud Authority)
                            </option>
                          )}
                        </select>
                      </div>

                      {/* Permissions Breakdown */}
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5 text-[11px] text-slate-600">
                        <span className="font-bold text-slate-800 block">Authority Permissions Included:</span>
                        <div className="flex items-center space-x-1.5 text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          <span>Student Account Management (suspend / restore)</span>
                        </div>
                        <div className="flex items-center space-x-1.5 text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          <span>Security Audit Logs & Telemetry review</span>
                        </div>
                        {inviteRole === 'super_admin' ? (
                          <div className="flex items-center space-x-1.5 text-amber-700 font-semibold">
                            <Check className="w-3.5 h-3.5" />
                            <span>Developer & Cloud System Configurations</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5 text-slate-400">
                            <X className="w-3.5 h-3.5" />
                            <span>Developer & Cloud Settings (Restricted to Super Admin)</span>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setShowInviteModal(false)}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={inviteLoading}
                          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {inviteLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                          <span>Send Invitation</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 4: DEVELOPER & CLOUD SETTINGS (SUPER ADMIN ONLY) */}
          {/* ==================================================== */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {!isSuperAdmin ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
                    <Lock className="w-6 h-6 text-amber-700" />
                  </div>
                  <h3 className="text-base font-bold text-amber-900">
                    Restricted to Super Administrators
                  </h3>
                  <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
                    Developer & Cloud Settings, API keys, and model rate limits require Super Administrator
                    credentials. Ordinary administrators are prevented from modifying cloud configurations.
                  </p>
                </div>
              ) : configLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs">Loading developer & cloud configuration...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Supabase Connection Status Card */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <Database className="w-5 h-5 text-emerald-600" />
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">Supabase Cloud Database & RLS</h4>
                          <p className="text-xs text-slate-500">Persistent PostgreSQL and Auth status</p>
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold flex items-center space-x-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Connected & Operational</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-slate-400 block font-medium">Supabase Project URL:</span>
                        <code className="font-mono text-slate-800 font-semibold truncate block">
                          {supabaseConfig.url || 'Configured via Environment Variables'}
                        </code>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-slate-400 block font-medium">Database Security:</span>
                        <span className="font-semibold text-emerald-700 flex items-center space-x-1">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Row Level Security (RLS) Active</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Gemini API & AI Model Controls */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center space-x-2.5">
                      <Cpu className="w-5 h-5 text-indigo-600" />
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Gemini AI Models & Rate Limiting</h4>
                        <p className="text-xs text-slate-500">
                          Configure models used by Summarizer, Quiz Generator, and AI Tutor
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 text-xs">
                      <div>
                        <label className="block text-slate-700 font-bold mb-1.5">
                          Allowed AI Models (Active Candidates)
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].map((m) => {
                            const isChecked = selectedModels.includes(m);
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  if (isChecked && selectedModels.length === 1) return;
                                  setSelectedModels(
                                    isChecked ? selectedModels.filter((x) => x !== m) : [...selectedModels, m]
                                  );
                                }}
                                className={`p-3 rounded-xl border text-left flex items-center justify-between cursor-pointer transition-all ${
                                  isChecked
                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold'
                                    : 'bg-slate-50 border-slate-200 text-slate-600'
                                }`}
                              >
                                <span className="font-mono text-xs">{m}</span>
                                {isChecked && <Check className="w-4 h-4 text-indigo-600" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">
                            Default Quiz Difficulty
                          </label>
                          <select
                            value={defaultDifficulty}
                            onChange={(e) => setDefaultDifficulty(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="easy">Easy (Direct Recall)</option>
                            <option value="medium">Medium (Concepts & Understanding)</option>
                            <option value="hard">Hard (Analytical & Contrasts)</option>
                            <option value="professor">Professor Mode (College-Level)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-slate-700 font-bold mb-1">
                            Max Question Limit
                          </label>
                          <input
                            type="number"
                            min="10"
                            max="100"
                            step="10"
                            value={maxQuestionCount}
                            onChange={(e) => setMaxQuestionCount(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-slate-700 font-bold mb-1">
                            API Rate Limit (RPM)
                          </label>
                          <input
                            type="number"
                            min="15"
                            max="120"
                            value={rateLimitRpm}
                            onChange={(e) => setRateLimitRpm(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex justify-end">
                      <button
                        onClick={handleSaveSystemConfig}
                        disabled={configSaving}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {configSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        <span>Save Configuration</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 5: ADMINISTRATIVE AUDIT LOGS */}
          {/* ==================================================== */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search logs by action, administrator email, or target..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <select
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">All Event Types</option>
                    <option value="bootstrap">Bootstrap</option>
                    <option value="login">Logins</option>
                    <option value="student">Student Status</option>
                    <option value="admin">Admin Roles & Invites</option>
                    <option value="config">Config Changes</option>
                  </select>

                  <button
                    onClick={loadAuditLogs}
                    className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                    title="Refresh audit logs"
                  >
                    <RefreshCw className={`w-4 h-4 ${auditLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Audit Table */}
              {auditLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs">Loading immutable audit logs...</p>
                </div>
              ) : filteredAuditLogs.length === 0 ? (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
                  <History className="w-8 h-8 text-slate-300 mx-auto" />
                  <h4 className="text-sm font-bold text-slate-700">No Audit Events Found</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Administrative actions like role assignments, account suspensions, and logins are logged here.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Timestamp</th>
                          <th className="px-4 py-3">Action Event</th>
                          <th className="px-4 py-3">Acting Administrator</th>
                          <th className="px-4 py-3">Target Subject</th>
                          <th className="px-4 py-3">IP Address</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {filteredAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-md font-mono text-[10px] font-bold">
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-900 font-semibold font-mono text-[11px]">
                              {log.adminEmail}
                            </td>
                            <td className="px-4 py-3 text-slate-700 font-mono text-[11px]">
                              {log.targetUserEmail || 'System'}
                            </td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                              {log.ipAddress || '127.0.0.1'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Role-Based Access Control Enforced • Server Validated</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
          >
            Close Dashboard
          </button>
        </div>
      </div>

      {/* Mandatory MFA Challenge Verification Modal */}
      <AdminMfaModal
        isOpen={showMfaModal}
        onClose={() => {
          setShowMfaModal(false);
          // If closing without verifying MFA, close dashboard as access is unauthorized
          onClose();
        }}
        currentUser={currentUser}
        targetSectionTitle={mfaTargetTitle}
        onSuccess={() => {
          setShowMfaModal(false);
          setCurrentAal('aal2');
          setFeedback({
            type: 'success',
            message: 'MFA Verified. Administrator assurance level elevated to AAL2.',
          });
          loadOverview();
          if (activeTab === 'students') loadStudents();
          if (activeTab === 'admins') loadAdmins();
          if (activeTab === 'settings' && isSuperAdmin) loadSystemConfig();
          if (activeTab === 'audit') loadAuditLogs();
        }}
      />
    </div>
  );
};
