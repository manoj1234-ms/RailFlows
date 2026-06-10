import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, MessageSquare, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) { toast.error('Please fill all fields'); return; }
    toast.success('Message sent! We\'ll get back to you soon.');
    setForm({ name: '', email: '', message: '' });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Contact Us</h1>
        <p className="text-[var(--color-text-muted)]">We'd love to hear from you</p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--color-text-muted)]">Message</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                placeholder="Your message..."
              />
            </div>
            <Button type="submit" className="w-full">Send Message</Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="flex items-center gap-4">
            <Mail className="text-[var(--color-primary)]" size={20} />
            <div>
              <div className="font-medium">Email</div>
              <div className="text-sm text-[var(--color-text-muted)]">support@railflow.app</div>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <MessageSquare className="text-[var(--color-primary)]" size={20} />
            <div>
              <div className="font-medium">Live Chat</div>
              <div className="text-sm text-[var(--color-text-muted)]">Available 24/7</div>
            </div>
          </Card>
          <Card className="flex items-center gap-4">
            <MapPin className="text-[var(--color-primary)]" size={20} />
            <div>
              <div className="font-medium">Office</div>
              <div className="text-sm text-[var(--color-text-muted)]">Bengaluru, India</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
