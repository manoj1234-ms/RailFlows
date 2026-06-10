import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';
import { MessageSquare, Mail, BookOpen, HelpCircle } from 'lucide-react';

const channels = [
  { icon: MessageSquare, title: 'Live Chat', desc: 'Chat with our support team', action: 'Start Chat', to: '/chatbot' },
  { icon: Mail, title: 'Email Support', desc: 'Get a reply within 24 hours', action: 'Send Email', to: '/contact' },
  { icon: BookOpen, title: 'Help Center', desc: 'Browse guides & tutorials', action: 'View Guides', to: '/faq' },
  { icon: HelpCircle, title: 'FAQ', desc: 'Quick answers to common questions', action: 'View FAQ', to: '/faq' },
];

export default function Support() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Support</h1>
        <p className="text-[var(--color-text-muted)] text-lg">We're here to help</p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-6">
        {channels.map((c) => (
          <Card key={c.title} className="space-y-4">
            <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center">
              <c.icon className="text-[var(--color-primary)]" size={24} />
            </div>
            <div>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">{c.desc}</p>
            </div>
            <Link to={c.to}><Button variant="outline" size="sm">{c.action}</Button></Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
