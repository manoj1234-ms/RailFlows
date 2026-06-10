import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Eye, EyeOff, ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';
import { authApi } from '@/api/auth';

const registerSchema = z.object({
  aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
  aadhaarOtp: z.string().length(6, 'OTP must be exactly 6 digits').optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one digit')
    .regex(/[^a-zA-Z0-9]/, 'Must contain at least one special character'),
});

type RegisterData = z.infer<typeof registerSchema>;

export default function Register() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Aadhaar OTP States
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Password Strength States
  const [pwdValue, setPwdValue] = useState('');
  const [pwdStrength, setPwdStrength] = useState<'weak' | 'medium' | 'strong' | 'none'>('none');

  // 3D Tilt Card Motion Values
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-250, 250], [10, -10]);
  const rotateY = useTransform(x, [-250, 250], [-10, 10]);

  const { register, handleSubmit, watch, getValues, formState: { errors } } = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      aadhaar: '',
      aadhaarOtp: '',
      email: '',
      phone: '',
      password: '',
    }
  });

  const aadhaarVal = watch('aadhaar');
  const otpVal = watch('aadhaarOtp');

  // Cooldown Timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  // Track Password value for Strength Meter
  const passwordVal = watch('password');
  useEffect(() => {
    setPwdValue(passwordVal || '');
    if (!passwordVal) {
      setPwdStrength('none');
    } else {
      const hasUpper = /[A-Z]/.test(passwordVal);
      const hasNumber = /[0-9]/.test(passwordVal);
      const hasSpecial = /[^a-zA-Z0-9]/.test(passwordVal);
      const isLongEnough = passwordVal.length >= 8;

      if (!isLongEnough || (!hasUpper && !hasNumber)) {
        setPwdStrength('weak');
      } else if (hasUpper && hasNumber && !hasSpecial) {
        setPwdStrength('medium');
      } else if (hasUpper && hasNumber && hasSpecial) {
        setPwdStrength('strong');
      }
    }
  }, [passwordVal]);

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

  const sendAadhaarOtp = async () => {
    const aadhaar = getValues('aadhaar');
    const phone = getValues('phone');
    if (!/^\d{12}$/.test(aadhaar)) {
      toast.error('Please enter a valid 12-digit Aadhaar number first.');
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      toast.error('Please enter a valid 10-digit phone number first.');
      return;
    }

    setOtpLoading(true);
    try {
      await authApi.sendAadhaarOtp({ aadhaar, phone });
      setOtpSent(true);
      setCooldown(30);
      toast.success('Aadhaar OTP sent successfully to ' + phone);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to send Aadhaar OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyAadhaarOtp = async () => {
    const aadhaar = getValues('aadhaar');
    const code = getValues('aadhaarOtp');
    if (!code || code.length !== 6) {
      toast.error('Enter the 6-digit OTP code');
      return;
    }

    setVerifyingOtp(true);
    try {
      await authApi.verifyAadhaarOtp({ aadhaar, code });
      setOtpVerified(true);
      toast.success('Aadhaar Identity verified successfully.');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Aadhaar OTP verification failed');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const onSubmit = async (data: RegisterData) => {
    if (!otpVerified) {
      toast.error('Please verify your Aadhaar OTP before completing registration.');
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        aadhaar: data.aadhaar,
        password: data.password,
        role: 'Passenger',
      };
      if (data.email) payload.email = data.email;
      if (data.phone) payload.phone = data.phone;

      await authApi.register(payload);
      toast.success('Registration successful! Redirecting to login...');
      navigate('/login');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const getStrengthBarColor = () => {
    switch (pwdStrength) {
      case 'weak': return 'bg-red-500 w-1/3';
      case 'medium': return 'bg-amber-500 w-2/3';
      case 'strong': return 'bg-emerald-500 w-full';
      default: return 'bg-slate-700 w-0';
    }
  };

  const getStrengthLabel = () => {
    switch (pwdStrength) {
      case 'weak': return 'Weak (Add upper, digit)';
      case 'medium': return 'Medium (Add special char)';
      case 'strong': return 'Strong and Secure';
      default: return 'Enter password';
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-8" style={{ perspective: 1000 }}>
      <motion.div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md space-y-6"
      >
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">Create Account</h1>
          <p className="text-[var(--color-text-muted)] text-sm">Verify with Aadhaar for secure passenger reservations</p>
        </div>

        <Card className="space-y-6 glass border-[var(--color-border)] shadow-xl relative overflow-hidden backdrop-blur-md">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Aadhaar Input with Inline Verification */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-text-muted)]">Aadhaar Number</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="aadhaar"
                    type="text"
                    maxLength={12}
                    disabled={otpVerified}
                    placeholder="12-digit Aadhaar"
                    {...register('aadhaar')}
                    error={errors.aadhaar?.message}
                    className="w-full pr-8"
                  />
                  {otpVerified && (
                    <div className="absolute right-3 top-[10px] text-emerald-500">
                      <ShieldCheck size={20} />
                    </div>
                  )}
                </div>
                {!otpVerified && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={sendAadhaarOtp}
                    loading={otpLoading}
                    disabled={cooldown > 0 || !/^\d{12}$/.test(aadhaarVal || '')}
                    className="h-10 text-xs shrink-0 cursor-pointer"
                  >
                    {cooldown > 0 ? `Resend (${cooldown}s)` : 'Send OTP'}
                  </Button>
                )}
              </div>
            </div>

            {/* Aadhaar OTP Input (Show when OTP sent & not yet verified) */}
            {otpSent && !otpVerified && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2 p-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
              >
                <label className="text-xs font-semibold text-[var(--color-primary)] flex items-center gap-1">
                  <KeyRound size={14} /> Enter Aadhaar OTP
                </label>
                <div className="flex gap-2">
                  <Input
                    id="aadhaarOtp"
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit OTP"
                    {...register('aadhaarOtp')}
                    error={errors.aadhaarOtp?.message}
                    className="flex-1 text-center font-mono text-lg tracking-wider"
                  />
                  <Button
                    type="button"
                    onClick={verifyAadhaarOtp}
                    loading={verifyingOtp}
                    disabled={!/^\d{6}$/.test(otpVal || '')}
                    className="h-10 text-xs shrink-0"
                  >
                    Verify
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Contact details */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="phone"
                label="Phone (compulsory)"
                type="tel"
                maxLength={10}
                placeholder="9876543210"
                {...register('phone')}
                error={errors.phone?.message}
              />
              <Input
                id="email"
                label="Email (optional)"
                type="email"
                placeholder="you@example.com"
                {...register('email')}
                error={errors.email?.message}
              />
            </div>

            {/* Password with Strength Indicator */}
            <div className="relative space-y-1">
              <div className="relative">
                <Input
                  id="password"
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  {...register('password')}
                  error={errors.password?.message}
                  placeholder="Min 8 chars, A-Z, 0-9, special"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[38px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Password Strength bar */}
              {pwdValue && (
                <div className="space-y-1 pt-1">
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-300 ${getStrengthBarColor()}`} />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-[var(--color-text-muted)] px-1">
                    <span>Password Strength:</span>
                    <span className={`font-semibold ${
                      pwdStrength === 'weak' ? 'text-red-400' : 
                      pwdStrength === 'medium' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>{getStrengthLabel()}</span>
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              loading={loading}
              disabled={!otpVerified}
              className="w-full mt-6"
            >
              Verify Aadhaar & Register
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Already have an account? <Link to="/login" className="text-[var(--color-primary)] hover:underline font-semibold">Sign in</Link>
          </p>
        </Card>
      </motion.div>
    </div>
  );
}
