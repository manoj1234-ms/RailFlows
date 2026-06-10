import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';

export default function About() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">About RailFlow</h1>
        <p className="text-[var(--color-text-muted)] text-lg max-w-2xl mx-auto">
          India's most advanced train booking platform, combining AI, real-time tracking, and premium user experience.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        {[
          { stat: '10M+', label: 'Happy Users' },
          { stat: '50K+', label: 'Daily Bookings' },
          { stat: '99.9%', label: 'Uptime' },
        ].map((s) => (
          <Card key={s.label} className="text-center py-8">
            <div className="text-3xl font-bold text-[var(--color-primary)]">{s.stat}</div>
            <div className="text-sm text-[var(--color-text-muted)]">{s.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-xl font-semibold mb-4">Our Mission</h2>
        <p className="text-[var(--color-text-muted)] leading-relaxed">
          RailFlow aims to revolutionize train travel in India by providing a seamless, secure, and intelligent booking experience.
          From AI-powered search to real-time train tracking and ML-based waitlist predictions, we leverage cutting-edge technology
          to make every journey effortless.
        </p>
      </Card>
    </div>
  );
}
