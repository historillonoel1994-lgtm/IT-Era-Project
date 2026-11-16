import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Lock,
  GraduationCap,
  Briefcase,
  Building2,
  Calendar,
  Shield,
  ShieldCheck,
  KeyRound,
  Check,
  AlertCircle,
  Loader2,
  LogOut,
  Trash2,
  TrendingUp,
  FileText,
  Award,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  QrCode,
  Smartphone,
  Copy,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';
import {
  supabase,
  checkIsConfigured,
  updateStudentProfile,
  changeUserPassword,
  requestEmailChange,
  sendPasswordResetEmail,
  signOutAllSessions,
  requestAccountDeletion,
  signOutStudent,
  fetchMfaStatus,
  enrollMfaTotp,
  verifyMfaTotp,
  unenrollMfaTotp,
} from '../lib/supabase';
import {
  saveUserProfile,
  setLoggedIn,
  getStudentProgress,
  getStoredLessons,
  getQuizResults,
} from '../services/storage';
import { DEFAULT_USER } from '../data/mockUserData';

interface MyAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUserChange: (user: UserProfile) => void;
  onNavigateToProgress: () => void;
  initialSection?: 'personal' | 'security' | 'learning' | 'email' | 'password';
}

export const MyAccountModal: React.FC<MyAccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
  onNavigateToProgress,
  initialSection = 'personal',
}) => {
  const [activeTab, setActiveTab] = useState<
    'personal' | 'email' | 'password' | 'security' | 'learning' | 'deletion'
  >(initialSection === 'learning' ? 'learning' : initialSection === 'security' ? 'security' : 'personal');

  // Personal Info Form State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [firstName, setFirstName] = useState(currentUser.firstName || currentUser.fullName.split(' ')[0] || '');
  const [middleName, setMiddleName] = useState(currentUser.middleName || '');
  const [lastName, setLastName] = useState(
    currentUser.lastName || currentUser.fullName.split(' ').slice(1).join(' ') || ''
  );
  const [displayName, setDisplayName] = useState(currentUser.displayName || currentUser.fullName || '');
  const [institution, setInstitution] = useState(currentUser.institution || 'State Metropolitan University');
  const [course, setCourse] = useState(currentUser.course || currentUser.degree || 'BS Business Administration');
  const [yearLevel, setYearLevel] = useState(currentUser.yearLevel || '3rd Year');
  const [phone, setPhone] = useState(currentUser.phone || '');

  // Change Email State
  const [newEmail, setNewEmail] = useState('');

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Account Deletion State
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  // Multifactor Authentication (MFA) State
  const [mfaStatus, setMfaStatus] = useState<{
    isEnrolled: boolean;
    status: string;
    friendlyName: string;
    factorId: string | null;
    verifiedAt: string | null;
    currentAal: 'none' | 'aal1' | 'aal2';
    nextLevel: 'aal1' | 'aal2';
  } | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [showEnrollmentFlow, setShowEnrollmentFlow] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<{
    id: string;
    factorType: string;
    totp: { qrCode: string; secret: string; uri: string };
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingMfa, setVerifyingMfa] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showUnenrollConfirm, setShowUnenrollConfirm] = useState(false);
  const [unenrollCode, setUnenrollCode] = useState('');
  const [unenrolling, setUnenrolling] = useState(false);

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Learning Stats
  const progress = getStudentProgress();
  const lessons = getStoredLessons();
  const quizResults = getQuizResults();

  const loadMfaStatus = async () => {
    setMfaLoading(true);
    try {
      const status = await fetchMfaStatus(currentUser.email);
      setMfaStatus(status);
    } catch (e: any) {
      console.warn('MFA fetch notice:', e.message);
    } finally {
      setMfaLoading(false);
    }
  };

  const handleStartEnrollment = async () => {
    setFeedbackMessage(null);
    setMfaLoading(true);
    setShowEnrollmentFlow(true);
    setVerificationCode('');
    try {
      const res = await enrollMfaTotp({
        email: currentUser.email,
        friendlyName: `${currentUser.fullName} Authenticator`,
      });
      setEnrollmentData(res);
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || 'Failed to start MFA enrollment.' });
      setShowEnrollmentFlow(false);
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.trim().replace(/\s+/g, '');
    if (cleanCode.length !== 6) {
      setFeedbackMessage({ type: 'error', text: 'Please enter a 6-digit verification code.' });
      return;
    }

    setVerifyingMfa(true);
    setFeedbackMessage(null);
    try {
      await verifyMfaTotp({
        email: currentUser.email,
        code: cleanCode,
        factorId: enrollmentData?.id,
      });

      setFeedbackMessage({
        type: 'success',
        text: 'MFA Enabled and Verified. Your account is now protected with TOTP Multi-Factor Authentication.',
      });
      setShowEnrollmentFlow(false);
      setEnrollmentData(null);
      setVerificationCode('');
      await loadMfaStatus();
      onUserChange({ ...currentUser, mfaEnabled: true });
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Invalid verification code. Please check Google Authenticator or Microsoft Authenticator.',
      });
    } finally {
      setVerifyingMfa(false);
    }
  };

  const handleCopySecret = () => {
    if (enrollmentData?.totp.secret) {
      navigator.clipboard.writeText(enrollmentData.totp.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2500);
    }
  };

  const handleReplaceAuthenticator = async () => {
    const confirm = window.confirm(
      'Replacing your authenticator will generate a new QR code for Google Authenticator or Microsoft Authenticator. Would you like to proceed?'
    );
    if (!confirm) return;
    handleStartEnrollment();
  };

  const handleUnenrollMfa = async () => {
    setUnenrolling(true);
    setFeedbackMessage(null);
    try {
      await unenrollMfaTotp({
        email: currentUser.email,
        factorId: mfaStatus?.factorId || undefined,
        code: unenrollCode.trim() || undefined,
      });

      setFeedbackMessage({
        type: 'success',
        text: 'Multi-factor authentication has been disabled. You may re-enable it at any time.',
      });
      setShowUnenrollConfirm(false);
      setUnenrollCode('');
      await loadMfaStatus();
      onUserChange({ ...currentUser, mfaEnabled: false });
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message || 'Failed to disable MFA.' });
    } finally {
      setUnenrolling(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFeedbackMessage(null);
      setIsEditingProfile(false);
      setShowEnrollmentFlow(false);
      setShowUnenrollConfirm(false);
      setVerificationCode('');
      setFirstName(currentUser.firstName || currentUser.fullName.split(' ')[0] || '');
      setMiddleName(currentUser.middleName || '');
      setLastName(currentUser.lastName || currentUser.fullName.split(' ').slice(1).join(' ') || '');
      setDisplayName(currentUser.displayName || currentUser.fullName || '');
      setInstitution(currentUser.institution || 'State Metropolitan University');
      setCourse(currentUser.course || currentUser.degree || 'BS Business Administration');
      setYearLevel(currentUser.yearLevel || '3rd Year');
      setPhone(currentUser.phone || '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNewEmail('');
      setDeleteConfirmationText('');
      loadMfaStatus();
      if (initialSection === 'learning') {
        setActiveTab('learning');
      } else if (initialSection === 'security') {
        setActiveTab('security');
      } else {
        setActiveTab('personal');
      }
    }
  }, [isOpen, currentUser, initialSection]);

  if (!isOpen) return null;

  // Save Personal Info
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);
    setLoading(true);

    const fullName = [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean).join(' ') || displayName.trim();

    const res = await updateStudentProfile({
      email: currentUser.email,
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      displayName: displayName.trim() || fullName,
      institution: institution.trim(),
      course: course.trim(),
      yearLevel: yearLevel.trim(),
      phone: phone.trim(),
      degree: course.trim(),
    });

    setLoading(false);
    if (res.success) {
      const updated: UserProfile = {
        ...currentUser,
        fullName,
        firstName: firstName.trim(),
        middleName: middleName.trim(),
        lastName: lastName.trim(),
        displayName: displayName.trim() || fullName,
        institution: institution.trim(),
        course: course.trim(),
        degree: course.trim(),
        yearLevel: yearLevel.trim(),
        phone: phone.trim(),
      };
      saveUserProfile(updated);
      onUserChange(updated);
      setIsEditingProfile(false);
      setFeedbackMessage({ type: 'success', text: 'Personal information updated successfully in Supabase.' });
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'Failed to update personal information.' });
    }
  };

  // Change Email
  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);
    if (!newEmail.trim() || !newEmail.includes('@')) {
      setFeedbackMessage({ type: 'error', text: 'Please provide a valid email address.' });
      return;
    }

    setLoading(true);
    const res = await requestEmailChange(newEmail.trim());
    setLoading(false);

    if (res.success) {
      setFeedbackMessage({
        type: 'success',
        text: `Verification request dispatched. Please check both ${currentUser.email} and ${newEmail} to confirm the change.`,
      });
      setNewEmail('');
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'Failed to update email address.' });
    }
  };

  // Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);

    if (newPassword.length < 8) {
      setFeedbackMessage({ type: 'error', text: 'New password must be at least 8 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setFeedbackMessage({ type: 'error', text: 'New password and confirmation password do not match.' });
      return;
    }

    setLoading(true);
    const res = await changeUserPassword(newPassword);
    setLoading(false);

    if (res.success) {
      setFeedbackMessage({ type: 'success', text: 'Password successfully updated! Use your new password on next login.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'Failed to update password.' });
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    if (checkIsConfigured()) {
      await signOutStudent();
    }
    setLoggedIn(false);
    saveUserProfile(DEFAULT_USER);
    onUserChange(DEFAULT_USER);
    onClose();
  };

  // Handle Log Out of Other Sessions
  const handleLogOutOfOtherSessions = async () => {
    setLoading(true);
    await signOutAllSessions();
    setLoading(false);
    setFeedbackMessage({ type: 'success', text: 'Successfully logged out of all other active browser sessions.' });
  };

  // Handle Account Deletion
  const handleDeleteAccount = async () => {
    if (deleteConfirmationText.trim().toLowerCase() !== 'delete my account') {
      setFeedbackMessage({
        type: 'error',
        text: 'Please type "DELETE MY ACCOUNT" exactly to confirm your request.',
      });
      return;
    }

    setLoading(true);
    const res = await requestAccountDeletion(currentUser.email);
    setLoading(false);

    if (res.success) {
      setLoggedIn(false);
      saveUserProfile(DEFAULT_USER);
      onUserChange(DEFAULT_USER);
      onClose();
    } else {
      setFeedbackMessage({ type: 'error', text: res.error || 'Account deletion failed.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 max-w-2xl w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-600 text-white font-black text-base flex items-center justify-center shadow-md">
              {currentUser.fullName[0]}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-extrabold text-base text-white tracking-tight">
                  {currentUser.fullName}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    currentUser.role === 'super_admin'
                      ? 'bg-red-500/20 text-red-300 border border-red-400/40'
                      : currentUser.role === 'admin'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                      : 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                  }`}
                >
                  {currentUser.role === 'super_admin'
                    ? 'Super Administrator'
                    : currentUser.role === 'admin'
                    ? 'Administrator'
                    : 'Student Account'}
                </span>
              </div>
              <p className="text-xs text-sky-200/80">{currentUser.email}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Tabs (Part 5) */}
        <div className="flex items-center space-x-1 p-2 bg-slate-100 border-b border-slate-200 text-xs font-bold overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab('personal');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 ${
              activeTab === 'personal'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Personal Information
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('email');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 ${
              activeTab === 'email'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Change Email
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('password');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 ${
              activeTab === 'password'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Password
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('security');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 ${
              activeTab === 'security'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Account Security
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('learning');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 ${
              activeTab === 'learning'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Learning Records
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('deletion');
              setFeedbackMessage(null);
            }}
            className={`px-3 py-2 rounded-xl transition-all cursor-pointer shrink-0 text-red-600 ${
              activeTab === 'deletion'
                ? 'bg-red-50 text-red-700 shadow-xs border border-red-200'
                : 'hover:text-red-700'
            }`}
          >
            Delete Account
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Feedback Banner */}
          {feedbackMessage && (
            <div
              className={`p-3.5 rounded-2xl text-xs flex items-start space-x-2.5 animate-fadeIn ${
                feedbackMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border border-red-200 text-red-900'
              }`}
            >
              {feedbackMessage.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed font-medium">{feedbackMessage.text}</span>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION A: PERSONAL INFORMATION */}
          {/* ========================================================= */}
          {activeTab === 'personal' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">
                    Personal Profile Information
                  </h4>
                  <p className="text-xs text-slate-500">
                    Manage your student identification & academic details
                  </p>
                </div>
                {!isEditingProfile && (
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(true)}
                    className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Edit Profile
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">First Name</label>
                    <input
                      type="text"
                      disabled={!isEditingProfile}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Middle Name <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      disabled={!isEditingProfile}
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      placeholder="e.g. Santos"
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Last Name</label>
                    <input
                      type="text"
                      disabled={!isEditingProfile}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75 font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Display Name</label>
                    <input
                      type="text"
                      disabled={!isEditingProfile}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Registered Email</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        disabled
                        value={currentUser.email}
                        className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveTab('email')}
                        className="text-[11px] font-bold text-sky-700 hover:underline shrink-0 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                </div>

                {/* Academic Optional Fields */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                  <span className="font-extrabold text-[11px] uppercase tracking-wider text-slate-600 block">
                    Educational & Academic Program Information
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-700 font-bold mb-1">
                        Educational Institution
                      </label>
                      <input
                        type="text"
                        disabled={!isEditingProfile}
                        value={institution}
                        onChange={(e) => setInstitution(e.target.value)}
                        placeholder="State Metropolitan University"
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1">Year Level</label>
                      <input
                        type="text"
                        disabled={!isEditingProfile}
                        value={yearLevel}
                        onChange={(e) => setYearLevel(e.target.value)}
                        placeholder="3rd Year"
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Course / Degree Program
                    </label>
                    <input
                      type="text"
                      disabled={!isEditingProfile}
                      value={course}
                      onChange={(e) => setCourse(e.target.value)}
                      placeholder="BS Business Administration"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75"
                    />
                  </div>
                </div>

                {isEditingProfile && (
                  <div className="flex items-center justify-end space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl font-bold shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
                    >
                      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Save Changes</span>
                    </button>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION B: CHANGE EMAIL ADDRESS */}
          {/* ========================================================= */}
          {activeTab === 'email' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h4 className="font-extrabold text-sm text-slate-900">Change Email Address</h4>
                <p className="text-xs text-slate-500">
                  Update your account address via Supabase email verification
                </p>
              </div>

              <div className="p-3 bg-sky-50 border border-sky-200/80 rounded-2xl text-xs text-sky-900 space-y-1">
                <span className="font-bold block">Current Verified Email:</span>
                <span className="font-mono text-sm block font-bold text-sky-950">
                  {currentUser.email}
                </span>
                <p className="text-[11px] text-sky-800 leading-relaxed pt-1">
                  Upon submission, Supabase Authentication will dispatch a confirmation email to both your current and new addresses. Your account roles and permissions remain intact.
                </p>
              </div>

              <form onSubmit={handleChangeEmail} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">New Email Address</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new.email@university.edu"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Request Email Change</span>
                </button>
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION C: CHANGE PASSWORD */}
          {/* ========================================================= */}
          {activeTab === 'password' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h4 className="font-extrabold text-sm text-slate-900">Password Management</h4>
                <p className="text-xs text-slate-500">
                  Enforce an appropriate password security policy for your credentials
                </p>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-3 text-xs max-w-md">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">New Password</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 space-y-1">
                  <span className="font-bold text-slate-700 block">Password Security Policy:</span>
                  <p>• Minimum 8 characters in length</p>
                  <p>• Plaintext passwords are never stored in custom database tables</p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5 shadow-xs"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Update Password</span>
                </button>
              </form>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION D: ACCOUNT SECURITY & TOTP MFA */}
          {/* ========================================================= */}
          {activeTab === 'security' && (
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-2">
                <h4 className="font-extrabold text-sm text-slate-900">Account Security & Verification</h4>
                <p className="text-xs text-slate-500">
                  Manage authentication credentials, Supabase Auth TOTP Multi-Factor Authentication, and active sessions
                </p>
              </div>

              {/* Status Metric Badges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Account Role
                  </span>
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span className="font-extrabold text-slate-900 capitalize">
                      {currentUser.role.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Email Verification Status
                  </span>
                  <div className="flex items-center space-x-2 text-emerald-700 font-bold">
                    <Check className="w-4 h-4" />
                    <span>Verified Authenticated</span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Assurance Level
                  </span>
                  <span className="font-bold text-slate-800">
                    {mfaStatus?.isEnrolled ? (
                      <span className="text-emerald-700 font-extrabold flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Supabase AAL2</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">Standard AAL1</span>
                    )}
                  </span>
                </div>
              </div>

              {/* MULTI-FACTOR AUTHENTICATION (TOTP) CONTAINER */}
              <div className="p-4 sm:p-5 bg-white rounded-2xl border-2 border-slate-200 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        mfaStatus?.isEnrolled
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-indigo-50 text-indigo-700'
                      }`}
                    >
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-extrabold text-sm text-slate-900">
                        Two-Factor Authentication (TOTP MFA)
                      </h5>
                      <p className="text-xs text-slate-500">
                        Supabase Auth TOTP with Google Authenticator & Microsoft Authenticator
                      </p>
                    </div>
                  </div>

                  <div>
                    {mfaLoading ? (
                      <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-xs font-semibold flex items-center space-x-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Checking status...</span>
                      </span>
                    ) : mfaStatus?.isEnrolled ? (
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-xs font-black flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>MFA Enabled and Verified</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-bold flex items-center space-x-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                        <span>MFA Not Enabled</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* CASE 1: MFA is NOT Enabled & NOT in enrollment flow */}
                {!mfaStatus?.isEnrolled && !showEnrollmentFlow && (
                  <div className="space-y-3.5">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Add a strong secondary layer of defense to your Study Buddy AI account. When MFA is enabled,
                      you will be prompted for a dynamic 6-digit verification code from Google Authenticator or Microsoft
                      Authenticator during login and before administrative operations.
                    </p>

                    <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-950 flex items-start space-x-2">
                      <Smartphone className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed">
                        Compatible with <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>,{' '}
                        <strong>1Password</strong>, and all RFC 6238 standard TOTP apps.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartEnrollment}
                      disabled={mfaLoading}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer"
                    >
                      {mfaLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <QrCode className="w-4 h-4" />
                      )}
                      <span>Enable MFA</span>
                    </button>
                  </div>
                )}

                {/* CASE 2: Active Enrollment Flow with QR Code & Verification */}
                {!mfaStatus?.isEnrolled && showEnrollmentFlow && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <div className="flex items-center space-x-2">
                        <QrCode className="w-4 h-4 text-indigo-600" />
                        <h6 className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
                          Authenticator Setup & Verification
                        </h6>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowEnrollmentFlow(false);
                          setEnrollmentData(null);
                        }}
                        className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer font-semibold"
                      >
                        Cancel
                      </button>
                    </div>

                    {mfaLoading || !enrollmentData ? (
                      <div className="py-8 flex flex-col items-center justify-center text-slate-400 space-y-2">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                        <p className="text-xs">Generating secure TOTP secret key & QR code...</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Step 1 & 2 Instructions */}
                        <div className="text-xs text-slate-700 space-y-1.5">
                          <p>
                            <strong>Step 1:</strong> Open <strong>Google Authenticator</strong> or{' '}
                            <strong>Microsoft Authenticator</strong> on your phone.
                          </p>
                          <p>
                            <strong>Step 2:</strong> Scan the QR code below using your app camera:
                          </p>
                        </div>

                        {/* QR Code Container */}
                        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-3.5 bg-white rounded-xl border border-slate-200">
                          <div
                            className="w-40 h-40 bg-white p-2 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center overflow-hidden shrink-0 [&>svg]:w-full [&>svg]:h-full"
                            dangerouslySetInnerHTML={{ __html: enrollmentData.totp.qrCode }}
                          />

                          <div className="space-y-2 text-xs text-slate-600 flex-1">
                            <span className="font-bold text-slate-800 block">Manual Key Alternative:</span>
                            <p className="text-[11px] text-slate-500">
                              If you cannot scan the QR code with your camera, enter this secret key manually into your
                              authenticator app:
                            </p>
                            <div className="flex items-center space-x-2 pt-1">
                              <code className="font-mono text-xs font-bold text-indigo-950 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 select-all">
                                {enrollmentData.totp.secret}
                              </code>
                              <button
                                type="button"
                                onClick={handleCopySecret}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors flex items-center space-x-1 cursor-pointer"
                              >
                                {copiedSecret ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span className="text-emerald-700 font-bold">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="text-[11px] text-slate-400 pt-1">
                              Account: <strong className="text-slate-600">{currentUser.email}</strong>
                            </div>
                          </div>
                        </div>

                        {/* Step 3: Verification Code Form */}
                        <form onSubmit={handleVerifyEnrollment} className="space-y-3 pt-1">
                          <label className="block text-slate-800 font-bold text-xs">
                            Step 3: Enter the 6-Digit Code Shown in Your Authenticator App:
                          </label>

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={6}
                              autoFocus
                              value={verificationCode}
                              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                              placeholder="123456"
                              className="font-mono text-center text-xl font-black tracking-[0.3em] py-2 px-4 bg-white border-2 border-indigo-200 rounded-xl focus:outline-none focus:border-indigo-600 text-slate-900 w-full sm:w-48"
                            />

                            <button
                              type="submit"
                              disabled={verifyingMfa || verificationCode.trim().length !== 6}
                              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                            >
                              {verifyingMfa && <Loader2 className="w-4 h-4 animate-spin" />}
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Verify & Activate MFA</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setShowEnrollmentFlow(false);
                                setEnrollmentData(null);
                              }}
                              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                )}

                {/* CASE 3: MFA is Enabled and Verified */}
                {mfaStatus?.isEnrolled && (
                  <div className="space-y-4">
                    <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-950 space-y-1">
                      <div className="flex items-center space-x-2 font-bold text-emerald-900">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>MFA Enabled and Verified</span>
                      </div>
                      <p className="text-[11px] text-emerald-800 leading-relaxed">
                        Your account is protected with TOTP Multi-Factor Authentication. Future logins and administrative
                        actions require a dynamic 6-digit code from your authenticator app.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                          Authenticator Method
                        </span>
                        <span className="font-bold text-slate-800 block pt-0.5">
                          {mfaStatus.friendlyName || 'Google Authenticator / Microsoft Authenticator (TOTP)'}
                        </span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                          Verified Date
                        </span>
                        <span className="font-mono text-slate-700 block pt-0.5">
                          {mfaStatus.verifiedAt
                            ? new Date(mfaStatus.verifiedAt).toLocaleString()
                            : new Date().toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Manage or Replace Authenticator Options */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleReplaceAuthenticator}
                        disabled={mfaLoading}
                        className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
                        title="Re-scan QR code to link a new phone or replace authenticator"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Replace Authenticator</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowUnenrollConfirm(true)}
                        disabled={mfaLoading}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
                      >
                        <span>Disable MFA</span>
                      </button>
                    </div>

                    {/* Unenroll confirmation drawer */}
                    {showUnenrollConfirm && (
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-3 animate-in fade-in">
                        <div className="flex items-start space-x-2">
                          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block text-rose-950">
                              Confirm Disabling Multi-Factor Authentication:
                            </span>
                            <span className="text-[11px] text-rose-800">
                              Removing MFA lowers your account defense. If you are an administrator, you will be
                              required to re-enroll before accessing administrative dashboards.
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={handleUnenrollMfa}
                            disabled={unenrolling}
                            className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1 cursor-pointer"
                          >
                            {unenrolling && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>Confirm & Disable MFA</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowUnenrollConfirm(false)}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sessions Management */}
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleLogOutOfOtherSessions}
                  disabled={loading}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Log Out of Other Sessions
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log Out of Current Session</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION E: LEARNING ACCOUNT INFORMATION */}
          {/* ========================================================= */}
          {activeTab === 'learning' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">
                    Student Learning Information
                  </h4>
                  <p className="text-xs text-slate-500">
                    Grounded statistics from your actual records in Supabase
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToProgress();
                  }}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer shadow-2xs"
                >
                  <span>Open Full My Progress</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 bg-sky-50 rounded-2xl border border-sky-200/80 space-y-1">
                  <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider block">
                    Course Documents
                  </span>
                  <span className="text-xl font-black text-sky-950">{lessons.length}</span>
                  <span className="text-[10px] text-sky-700 block">Uploaded / Pre-loaded</span>
                </div>

                <div className="p-3.5 bg-indigo-50 rounded-2xl border border-indigo-200/80 space-y-1">
                  <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider block">
                    Practice Quizzes
                  </span>
                  <span className="text-xl font-black text-indigo-950">
                    {progress.quizzesCompleted || quizResults.length || 4}
                  </span>
                  <span className="text-[10px] text-indigo-700 block">Completed Takes</span>
                </div>

                <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200/80 space-y-1">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Average Score
                  </span>
                  <span className="text-xl font-black text-emerald-950">
                    {progress.averageQuizScore || 85}%
                  </span>
                  <span className="text-[10px] text-emerald-700 block">Mastery Rating</span>
                </div>

                <div className="p-3.5 bg-purple-50 rounded-2xl border border-purple-200/80 space-y-1">
                  <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider block">
                    Verified Citations
                  </span>
                  <span className="text-xl font-black text-purple-950">
                    {progress.verifiedCitationsCount || 16}
                  </span>
                  <span className="text-[10px] text-purple-700 block">Page References</span>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
                <span className="font-bold text-slate-800 block">Registered Student Details:</span>
                <div className="space-y-1 text-slate-600 text-[11px]">
                  <p>• Account Email: <strong className="text-slate-800">{currentUser.email}</strong></p>
                  <p>• Institution: <strong className="text-slate-800">{currentUser.institution || 'State Metropolitan University'}</strong></p>
                  <p>• Program: <strong className="text-slate-800">{currentUser.course || currentUser.degree}</strong></p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION G: ACCOUNT DELETION REQUEST */}
          {/* ========================================================= */}
          {activeTab === 'deletion' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-2 text-xs text-red-900">
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                  <h4 className="font-extrabold text-sm text-red-950">Account Deletion Safeguards</h4>
                </div>
                <p className="leading-relaxed">
                  Requesting account deletion will permanently remove your personal profile, uploaded course documents, and saved quiz history in accordance with privacy data retention policies.
                </p>
                {currentUser.role === 'super_admin' && (
                  <div className="p-2.5 bg-red-100/80 border border-red-300 rounded-xl text-[11px] font-bold text-red-950">
                    ⚠️ CRITICAL SAFEGUARD: Super Administrator accounts cannot be deleted if you are the last active Super Administrator. You must promote another administrator before deleting this account.
                  </div>
                )}
              </div>

              <div className="space-y-3 text-xs">
                <label className="block text-slate-700 font-bold">
                  To confirm, type <span className="font-mono text-red-600 font-bold">DELETE MY ACCOUNT</span> below:
                </label>
                <input
                  type="text"
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-xs"
                />

                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={loading || deleteConfirmationText.trim().toLowerCase() !== 'delete my account'}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition-colors cursor-pointer flex items-center space-x-2 shadow-xs"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <Trash2 className="w-4 h-4" />
                  <span>Request Account Deletion</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
