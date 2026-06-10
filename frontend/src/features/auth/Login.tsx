import { useState, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { Train, Globe, Apple, Eye, EyeOff, X, User } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password required'),
});

type LoginData = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  // Social Modal States
  const [showSocialModal, setShowSocialModal] = useState<false | 'google' | 'apple'>(false);

  // 3D Tilt Card Motion Values
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-250, 250], [10, -10]);
  const rotateY = useTransform(x, [-250, 250], [-10, 10]);

  const mfaState = location.state as { mfaToken?: string; email?: string } | null;

  const { register, handleSubmit, formState: { errors } } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
  });

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left - width / 2;
    const mouseY = event.clientY - rect.top - height / 2;
    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const onSubmit = async (data: LoginData) => {
    setLoading(true);
    try {
      const res = await authApi.login(data);
      const body = res.data;

      if (body.status === 'mfa_required') {
        navigate('/login', { state: { mfaToken: (body as any).mfaToken, email: data.email }, replace: true });
        toast.info('MFA code required');
        return;
      }

      if (body.status === 'success') {
        const successBody = body as any;
        setAuth({ id: 0, email: data.email, role: successBody.role, mfaEnabled: false, createdAt: '' }, successBody.accessToken);
        toast.success('Login successful');
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaState?.email) return;
    setLoading(true);
    try {
      const res = await authApi.mfaVerify({ email: mfaState.email, code: mfaCode });
      const body = res.data;
      if (body.status === 'success') {
        const successBody = body as any;
        setAuth({ id: 0, email: mfaState.email, role: successBody.role, mfaEnabled: true, createdAt: '' }, successBody.accessToken);
        toast.success('MFA verified');
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async () => {
    if (phone.length !== 10) { toast.error('Enter a valid 10-digit phone number'); return; }
    setOtpLoading(true);
    try {
      await authApi.sendOtp({ phone });
      setOtpSent(true);
      toast.success('OTP sent to ' + phone);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to send OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) { toast.error('Enter the OTP code'); return; }
    setLoading(true);
    try {
      const { data } = await authApi.verifyOtp({ phone, code: otp });
      setAuth({ id: data.data.userId, email: '', role: data.data.role, mfaEnabled: false, createdAt: '' }, data.data.accessToken);
      toast.success('Login successful');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  // Mock social profiles selector handler
  const handleSocialSelect = async (email: string, name: string) => {
    if (!showSocialModal) return;
    setLoading(true);
    try {
      const response = await authApi.socialLogin({
        provider: showSocialModal,
        token: `mock-oauth-token-${showSocialModal}-${Date.now()}`,
        email,
        name,
      });
      if (response.data.status === 'success') {
        setAuth({ id: 0, email, role: response.data.role, mfaEnabled: false, createdAt: '' }, response.data.accessToken);
        toast.success(`${showSocialModal === 'google' ? 'Google' : 'Apple'} login successful!`);
        setShowSocialModal(false);
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Social login failed');
    } finally {
      setLoading(false);
    }
  };

  const mockProfiles = {
    google: [
      { name: 'Manoj Kumar', email: 'manoj.kumar@gmail.com' },
      { name: 'Passenger Test', email: 'passenger@railflow.com' },
    ],
    apple: [
      { name: 'Manoj Kumar (Apple)', email: 'manoj.kumar@icloud.com' },
      { name: 'Apple Guest User', email: 'guest.apple@icloud.com' },
    ]
  };

  if (mfaState?.mfaToken) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <Train className="mx-auto text-[var(--color-primary)]" size={40} />
            <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
            <p className="text-[var(--color-text-muted)] text-sm">Enter the 6-digit code from your authenticator app</p>
          </div>
          <Card className="space-y-6">
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <Input
                id="mfaCode"
                label="MFA Code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
              <Button type="submit" loading={loading} className="w-full">Verify</Button>
            </form>
            <div className="text-center">
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="text-sm text-[var(--color-primary)] hover:underline cursor-pointer"
              >
                Back to login
              </button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-8" style={{ perspective: 1000 }}>
      <motion.div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-6"
      >
        <div className="text-center space-y-2">
          <Train className="mx-auto text-[var(--color-primary)]" size={40} />
          <h1 className="text-3xl font-extrabold tracking-tight">Welcome Back</h1>
          <p className="text-[var(--color-text-muted)] text-sm">Sign in to your RailFlow account</p>
        </div>

        <Card className="space-y-6 glass border-[var(--color-border)] shadow-xl relative overflow-hidden backdrop-blur-md">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('email')}
              className={`flex-1 py-2 text-sm rounded-lg transition-colors cursor-pointer font-semibold ${mode === 'email' ? 'bg-[var(--color-primary)] text-white' : 'bg-slate-800/50 text-[var(--color-text-muted)] hover:bg-slate-800'}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setMode('phone')}
              className={`flex-1 py-2 text-sm rounded-lg transition-colors cursor-pointer font-semibold ${mode === 'phone' ? 'bg-[var(--color-primary)] text-white' : 'bg-slate-800/50 text-[var(--color-text-muted)] hover:bg-slate-800'}`}
            >
              Phone
            </button>
          </div>

          {mode === 'email' ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input id="email" label="Email Address" type="email" {...register('email')} error={errors.email?.message} placeholder="you@example.com" />
              <div className="relative">
                <Input id="password" label="Password" type={showPassword ? 'text' : 'password'} {...register('password')} error={errors.password?.message} placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-[38px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-xs text-[var(--color-primary)] hover:underline">Forgot password?</Link>
              </div>
              <Button type="submit" loading={loading} className="w-full">Sign In</Button>
            </form>
          ) : (
            <div className="space-y-4">
              <Input
                label="Phone Number"
                type="tel"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {!otpSent ? (
                <Button onClick={sendOtp} loading={otpLoading} className="w-full">Send OTP</Button>
              ) : (
                <div className="space-y-4">
                  <Input
                    label="OTP Code"
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <Button onClick={verifyOtp} loading={loading} className="w-full">Verify & Login</Button>
                  <button onClick={() => { setOtpSent(false); setOtp(''); }} className="w-full text-xs text-[var(--color-primary)] hover:underline cursor-pointer">
                    Change phone number
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--color-border)]" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-[var(--color-surface)] px-2 text-[var(--color-text-muted)]">or continue with</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSocialModal('google')} className="cursor-pointer font-semibold"><Globe size={16} /> Google</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSocialModal('apple')} className="cursor-pointer font-semibold"><Apple size={16} /> Apple</Button>
          </div>

          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Don't have an account? <Link to="/register" className="text-[var(--color-primary)] hover:underline font-semibold">Register</Link>
          </p>
        </Card>
      </motion.div>

      {/* Social Popup Dialog Selector */}
      <AnimatePresence>
        {showSocialModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4 relative"
            >
              <button
                type="button"
                onClick={() => setShowSocialModal(false)}
                className="absolute right-4 top-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={20} />
              </button>

              <div className="text-center space-y-1">
                {showSocialModal === 'google' ? (
                  <Globe className="mx-auto text-sky-400" size={32} />
                ) : (
                  <Apple className="mx-auto text-slate-100" size={32} />
                )}
                <h3 className="text-lg font-bold">
                  Sign in with {showSocialModal === 'google' ? 'Google' : 'Apple'}
                </h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Choose a mock account to continue simulation login
                </p>
              </div>

              <div className="space-y-2 pt-2">
                {mockProfiles[showSocialModal].map((profile) => (
                  <button
                    key={profile.email}
                    type="button"
                    onClick={() => handleSocialSelect(profile.email, profile.name)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] hover:bg-slate-800/50 hover:border-[var(--color-primary)] transition-all cursor-pointer text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[var(--color-text)]">
                      <User size={16} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{profile.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{profile.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
