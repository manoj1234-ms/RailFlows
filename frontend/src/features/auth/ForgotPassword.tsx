import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast.error('Enter your email'); return; }
    setSent(true);
    toast.success('Reset link sent to your email');
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Forgot Password</h1>
          <p className="text-[var(--color-text-muted)] text-sm">We'll send you a reset link</p>
        </div>
        <Card>
          {sent ? (
            <div className="text-center space-y-4 py-4">
              <p className="text-[var(--color-success)]">Reset link sent!</p>
              <p className="text-sm text-[var(--color-text-muted)]">Check your email for instructions.</p>
              <Link to="/login"><Button variant="outline">Back to Login</Button></Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input id="email" label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <Button type="submit" className="w-full">Send Reset Link</Button>
              <p className="text-center text-sm"><Link to="/login" className="text-[var(--color-primary)] hover:underline">Back to Login</Link></p>
            </form>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
