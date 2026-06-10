import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { authApi } from '@/api/auth';

export default function VerifyOtp() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !code) { toast.error('Fill all fields'); return; }
    setLoading(true);
    try {
      const res = await authApi.verifyOtp({ phone, code });
      localStorage.setItem('accessToken', res.data.data.accessToken);
      toast.success('Phone verified!');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Verify OTP</h1>
          <p className="text-[var(--color-text-muted)] text-sm">Enter the code sent to your phone</p>
        </div>
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input id="phone" label="Phone Number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
            <Input id="code" label="OTP Code" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            <Button type="submit" loading={loading} className="w-full">Verify</Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
