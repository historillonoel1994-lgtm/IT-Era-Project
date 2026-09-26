import React, { useState } from 'react';
import { X, User, Mail, Lock, GraduationCap, Briefcase, Sparkles, Check } from 'lucide-react';
import { UserProfile } from '../types';
import { DEFAULT_USER } from '../data/mockUserData';
import { saveUserProfile, setLoggedIn } from '../services/storage';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUserChange: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('••••••••');
  const [degree, setDegree] = useState(currentUser.degree);
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserProfile = {
      id: `usr-${Date.now()}`,
      fullName: fullName.trim() || 'Working Student',
      email: email.trim() || 'student@university.edu',
      degree: degree.trim() || 'College Degree',
      jobTitle: jobTitle.trim() || 'Working Student',
      avatarSeed: fullName.toLowerCase().replace(/\s+/g, '-'),
    };
    saveUserProfile(updated);
    setLoggedIn(true);
    onUserChange(updated);
    onClose();
  };

  const handleQuickDemoJuan = () => {
    saveUserProfile(DEFAULT_USER);
    setLoggedIn(true);
    onUserChange(DEFAULT_USER);
    onClose();
  };

  const handleQuickDemoMaria = () => {
    const maria: UserProfile = {
      id: 'usr-working-maria',
      fullName: 'Maria Santos',
      email: 'maria.santos@univ.edu',
      degree: 'BS Information Technology (3rd Year)',
      jobTitle: 'BPO Customer Support (Night Shift, 30 hrs/wk)',
      institution: 'City State College',
      avatarSeed: 'maria-studybuddy',
    };
    saveUserProfile(maria);
    setLoggedIn(true);
    onUserChange(maria);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 max-w-md w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-sky-800 to-slate-900 text-white flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="font-bold text-lg text-white">Student Account & Profile</h3>
            <p className="text-xs text-sky-200">
              Manage your student profile & work credentials
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="px-6 pt-3 border-b border-slate-100 flex space-x-6 text-xs font-semibold bg-slate-50/50">
          <button
            onClick={() => setMode('login')}
            className={`pb-3 border-b-2 transition-colors ${
              mode === 'login'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Login to Account
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`pb-3 border-b-2 transition-colors ${
              mode === 'signup'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign Up New Student
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Quick Demo Selector */}
          <div className="p-3 bg-sky-50/70 border border-sky-200/70 rounded-xl space-y-2">
            <span className="text-[11px] font-bold text-sky-900 uppercase tracking-wider block">
              Quick 1-Click Demo Profiles (For Presentation)
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleQuickDemoJuan}
                className="p-2 bg-white hover:bg-sky-100/70 border border-sky-200 rounded-lg text-left text-xs transition-colors"
              >
                <span className="font-bold text-slate-800 block">Juan Dela Cruz</span>
                <span className="text-[10px] text-slate-500 block truncate">Retail Associate (24h/wk)</span>
              </button>
              <button
                type="button"
                onClick={handleQuickDemoMaria}
                className="p-2 bg-white hover:bg-sky-100/70 border border-sky-200 rounded-lg text-left text-xs transition-colors"
              >
                <span className="font-bold text-slate-800 block">Maria Santos</span>
                <span className="text-[10px] text-slate-500 block truncate">BPO Support (30h/wk)</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {mode === 'signup' && (
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Student Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Degree / Major</label>
                  <div className="relative">
                    <GraduationCap className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={degree}
                      onChange={(e) => setDegree(e.target.value)}
                      placeholder="e.g. BS Business Administration"
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Job / Employment Role</label>
                  <div className="relative">
                    <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="e.g. Retail Sales Associate (24 hrs/wk)"
                      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow transition-colors mt-2"
            >
              {mode === 'login' ? 'Log In to Study Buddy' : 'Create Student Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
