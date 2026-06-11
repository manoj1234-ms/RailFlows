import { useState, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { Train, Apple, Eye, EyeOff } from 'lucide-react';

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
  const [googleLoading, setGoogleLoading] = useState(false);

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
    const mouseX = event.clientX - rect.left - rect.width / 2;
    const mouseY = event.clientY - rect.top - rect.height / 2;
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
        toast.info('MFA code required — open your authenticator app');
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
        toast.success('MFA verified — welcome back!');
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

  // Real Google login — called with the ID token from Google's popup
  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    const idToken = credentialResponse.credential;
    if (!idToken) { toast.error('Google sign-in failed — no credential received'); return; }
    setGoogleLoading(true);
    try {
      const response = await authApi.socialLogin({ provider: 'google', token: idToken });
      if (response.data.status === 'success') {
        setAuth(
          { id: 0, email: (response.data as any).email || '', role: (response.data as any).role, mfaEnabled: false, createdAt: '' },
          (response.data as any).accessToken
        );
        toast.success(`Welcome, ${(response.data as any).name || 'User'}! 👋`);
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Google login failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleError = () => {
    toast.error('Google sign-in was cancelled or failed. Please try again.');
  };

  // MFA screen
  if (mfaState?.mfaToken) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <Train className="mx-auto text-[var(--color-primary)]" size={40} />
            <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
            <p className="text-[var(--color-text-muted)] text-sm">
              Enter the 6-digit code from <strong>Google Authenticator</strong> or <strong>Authy</strong>
            </p>
          </div>
          <Card className="space-y-6">
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <Input
                id="mfaCode"
                label="Authenticator Code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
              <Button type="submit" loading={loading} className="w-full">Verify Code</Button>
            </form>
            <div className="text-center">
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="text-sm text-[var(--color-primary)] hover:underline cursor-pointer"
              >
                ← Back to login
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

          <AnimatePresence mode="wait">
            {mode === 'email' ? (
              <motion.form
                key="email-form"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-4"
              >
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
              </motion.form>
            ) : (
              <motion.div
                key="phone-form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
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
                    <Button onClick={verifyOtp} loading={loading} className="w-full">Verify &amp; Login</Button>
                    <button onClick={() => { setOtpSent(false); setOtp(''); }} className="w-full text-xs text-[var(--color-primary)] hover:underline cursor-pointer">
                      Change phone number
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--color-border)]" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-[var(--color-surface)] px-2 text-[var(--color-text-muted)]">or continue with</span></div>
          </div>

          {/* Real Google Sign-In Button — uses VITE_GOOGLE_CLIENT_ID */}
          <div className="space-y-3">
            {googleLoading ? (
              <div className="flex justify-center items-center h-10 gap-2 text-sm text-[var(--color-text-muted)]">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Signing in with Google…
              </div>
            ) : (
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  theme="filled_black"
                  shape="pill"
                  size="large"
                  text="signin_with"
                  useOneTap={false}
                />
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full cursor-pointer font-semibold opacity-60 cursor-not-allowed"
              disabled
            >
              <Apple size={16} /> Apple (Coming Soon)
            </Button>
          </div>

          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Don't have an account? <Link to="/register" className="text-[var(--color-primary)] hover:underline font-semibold">Register</Link>
          </p>
        </Card>
      </motion.div>
    </div>
  );
}
