import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { UserProfile } from '../types';
import {
  fetchMfaStatus,
  enrollMfaTotp,
  verifyMfaTotp,
  getAdminMfaToken,
} from '../lib/supabase';

interface AdminMfaModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onSuccess: () => void;
  targetSectionTitle?: string;
}

export const AdminMfaModal: React.FC<AdminMfaModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSuccess,
  targetSectionTitle = 'Administrator Security Center',
}) => {
  const [loading, setLoading] = useState(true);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<{
    id: string;
    factorType: string;
    totp: { qrCode: string; secret: string; uri: string };
  } | null>(null);

  const [verificationCode, setVerificationCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setVerificationCode('');
      checkStatusAndInit();
    }
  }, [isOpen, currentUser.email]);

  const checkStatusAndInit = async () => {
    setLoading(true);
    try {
      const status = await fetchMfaStatus(currentUser.email);
      setIsEnrolled(status.isEnrolled);

      // If enrolled and already at AAL2, allow access immediately
      if (status.isEnrolled && status.currentAal === 'aal2') {
        onSuccess();
        return;
      }

      // If not enrolled, initiate enrollment right away so QR code is ready
      if (!status.isEnrolled) {
        const enrollRes = await enrollMfaTotp({
          email: currentUser.email,
          friendlyName: `${currentUser.fullName} Admin TOTP`,
        });
        setEnrollmentData(enrollRes);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to check administrative MFA status.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = () => {
    if (enrollmentData?.totp.secret) {
      navigator.clipboard.writeText(enrollmentData.totp.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2500);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.trim().replace(/\s+/g, '');
    if (cleanCode.length !== 6) {
      setErrorMessage('Please enter a complete 6-digit security code.');
      return;
    }

    setVerifying(true);
    setErrorMessage(null);

    try {
      const res = await verifyMfaTotp({
        email: currentUser.email,
        code: cleanCode,
        factorId: enrollmentData?.id,
      });

      setSuccessMessage('MFA Enabled and Verified. Administrator session elevated to AAL2.');
      setTimeout(() => {
        onSuccess();
      }, 700);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Invalid 6-digit code. Please check your Google Authenticator or Microsoft Authenticator app.'
      );
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 shadow-inner">
              <ShieldCheck className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Administrator Security Verification
              </h3>
              <p className="text-xs text-slate-300">
                Supabase Auth TOTP Multi-Factor Authentication (AAL2)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Alert Banner */}
        <div className="px-6 py-3 bg-amber-50/80 border-b border-amber-200/70 text-xs text-amber-900 flex items-start space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            Administrative access to <strong>{targetSectionTitle}</strong> requires verified Multi-Factor
            Authentication (AAL2) to protect institutional databases and system configurations.
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-xs font-semibold">Verifying administrative MFA security state...</p>
            </div>
          ) : (
            <>
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="leading-tight font-medium">{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-start space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="leading-tight font-bold">{successMessage}</span>
                </div>
              )}

              {/* ENROLLMENT MODE: When Administrator hasn't enrolled yet */}
              {!isEnrolled && enrollmentData ? (
                <div className="space-y-4">
                  <div className="text-center space-y-1">
                    <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px] font-black uppercase tracking-wider">
                      Initial MFA Enrollment Required
                    </span>
                    <h4 className="text-sm font-bold text-slate-900">
                      Link Google Authenticator or Microsoft Authenticator
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Scan the QR code below using your mobile authenticator app to enable TOTP verification for{' '}
                      <span className="font-semibold text-slate-700">{currentUser.email}</span>.
                    </p>
                  </div>

                  {/* QR Code Container */}
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div
                      className="w-44 h-44 bg-white p-2.5 rounded-2xl border-2 border-indigo-100 shadow-sm flex items-center justify-center overflow-hidden [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: enrollmentData.totp.qrCode }}
                    />
                    <div className="flex items-center space-x-1.5 text-[11px] text-slate-500">
                      <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Compatible with Google Authenticator, Microsoft Authenticator, and 1Password</span>
                    </div>
                  </div>

                  {/* Manual Key Display */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Can't scan the QR code? Use this manual setup key:
                    </span>
                    <div className="flex items-center justify-center space-x-2">
                      <code className="font-mono text-xs font-bold text-indigo-900 bg-white px-2 py-1 rounded border border-slate-200">
                        {enrollmentData.totp.secret}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-[11px] font-semibold text-slate-700 transition-colors flex items-center space-x-1 cursor-pointer"
                      >
                        {copiedSecret ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Code Input Form */}
                  <form onSubmit={handleVerify} className="space-y-3 pt-1">
                    <div>
                      <label className="block text-slate-700 font-bold text-xs mb-1.5 text-center">
                        Enter the 6-Digit Code from Your Authenticator App:
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        autoFocus
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="w-full text-center font-mono text-2xl tracking-[0.4em] font-black py-2.5 bg-slate-50 border-2 border-indigo-200 rounded-xl focus:outline-none focus:border-indigo-600 focus:bg-white text-slate-900"
                      />
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>

                      <button
                        type="submit"
                        disabled={verifying || verificationCode.trim().length !== 6}
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                      >
                        {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>Verify & Unlock</span>
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* CHALLENGE MODE: When Administrator has already enrolled MFA, but needs AAL2 verification */
                <div className="space-y-4">
                  <div className="text-center space-y-1">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center mx-auto mb-2">
                      <Lock className="w-6 h-6" />
                    </div>
                    <h4 className="text-base font-bold text-slate-900">
                      Two-Factor Authentication Required
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Please enter the dynamic 6-digit security code generated by your Google Authenticator or Microsoft
                      Authenticator app for{' '}
                      <span className="font-semibold text-slate-700">{currentUser.email}</span>.
                    </p>
                  </div>

                  <form onSubmit={handleVerify} className="space-y-4 pt-2">
                    <div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        autoFocus
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="w-full text-center font-mono text-3xl tracking-[0.4em] font-black py-3 bg-slate-50 border-2 border-indigo-200 rounded-2xl focus:outline-none focus:border-indigo-600 focus:bg-white text-slate-900"
                      />
                      <span className="text-[11px] text-slate-400 text-center block mt-1.5">
                        Code rotates every 30 seconds
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 pt-1">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>

                      <button
                        type="submit"
                        disabled={verifying || verificationCode.trim().length !== 6}
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                      >
                        {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>Verify MFA</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
