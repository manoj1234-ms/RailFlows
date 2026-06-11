/**
 * MfaSetupModal.tsx
 * Guides the user through TOTP setup in 3 steps:
 *   1. Call /mfa/setup → receives QR code data URL + base32 secret
 *   2. User scans QR in Google Authenticator / Authy
 *   3. User enters first TOTP code → calls /mfa/confirm to activate
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { X, ShieldCheck, QrCode, Key, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authApi } from '@/api/auth';

interface Props {
  onClose: () => void;
  onActivated: () => void;
}

type Step = 'idle' | 'qr' | 'verify' | 'done';

export default function MfaSetupModal({ onClose, onActivated }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');

  const startSetup = async () => {
    setLoading(true);
    try {
      const res = await authApi.mfaSetup();
      const { qrCode: qr, secret: s } = res.data as any;
      setQrCode(qr);
      setSecret(s);
      setStep('qr');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to initiate MFA setup');
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async () => {
    if (code.length !== 6) { toast.error('Enter the 6-digit code from your authenticator'); return; }
    setLoading(true);
    try {
      await authApi.mfaConfirm({ code });
      setStep('done');
      toast.success('MFA activated successfully! 🔒');
      onActivated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Code did not match — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
        >
          <X size={20} />
        </button>

        {/* Step: Idle — explain & start */}
        {step === 'idle' && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <ShieldCheck size={28} className="text-white" />
              </div>
              <h2 className="text-xl font-bold">Enable Two-Factor Auth</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Protect your account with a TOTP authenticator app (Google Authenticator, Authy, etc.).
              </p>
            </div>
            <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
              {['Install an authenticator app on your phone', 'Scan the QR code shown next', 'Enter the 6-digit code to confirm'].map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[var(--color-primary)]/20 text-[var(--color-primary)] text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ul>
            <Button className="w-full" loading={loading} onClick={startSetup}>
              <QrCode size={16} /> Generate QR Code
            </Button>
          </div>
        )}

        {/* Step: QR — show scannable QR + manual key */}
        {step === 'qr' && (
          <div className="space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-xl font-bold">Scan with Authenticator</h2>
              <p className="text-sm text-[var(--color-text-muted)]">Open your app and scan the QR code below.</p>
            </div>
            {qrCode && (
              <div className="flex justify-center">
                <img
                  src={qrCode}
                  alt="TOTP QR Code"
                  className="w-44 h-44 rounded-xl border-2 border-[var(--color-border)] p-1 bg-white"
                />
              </div>
            )}
            <div className="bg-slate-900/60 rounded-xl p-3 space-y-1">
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Key size={12} /> Manual entry key
              </div>
              <p className="font-mono text-xs tracking-widest text-[var(--color-primary)] break-all select-all">
                {secret}
              </p>
            </div>
            <Button className="w-full" onClick={() => setStep('verify')}>
              I've Scanned the Code →
            </Button>
          </div>
        )}

        {/* Step: Verify — user enters first TOTP code */}
        {step === 'verify' && (
          <div className="space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-xl font-bold">Enter Verification Code</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Enter the 6-digit code shown in your authenticator app to activate MFA.
              </p>
            </div>
            <Input
              id="totp-code"
              label="Authenticator Code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
            />
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('qr')} className="flex-1">← Back</Button>
              <Button loading={loading} onClick={confirmSetup} className="flex-1">Activate MFA</Button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center space-y-5">
            <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-white" />
            </div>
            <h2 className="text-xl font-bold">MFA Activated!</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Your account is now protected. You'll need your authenticator code at every login.
            </p>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
