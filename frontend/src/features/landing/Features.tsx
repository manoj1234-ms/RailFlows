import { motion } from 'framer-motion';
import { Search, Shield, Zap, BarChart3, Wallet, Bot, Ticket, Globe } from 'lucide-react';
import { Card } from '@/components/ui/Card';

const allFeatures = [
  { icon: Search, title: 'AI-Powered Search', desc: 'Fuzzy station matching, smart autocomplete, and fare calendar for best prices.' },
  { icon: Shield, title: 'Enterprise Security', desc: 'End-to-end encryption, PCI DSS v4.0 compliance, field-level Aadhaar encryption.' },
  { icon: Zap, title: 'Virtual Queue System', desc: 'Real-time queue with anti-tampering security, device fingerprinting, and position tracking.' },
  { icon: BarChart3, title: 'ML Predictions', desc: 'Waitlist confirmation probability, fare forecasting, and personalized recommendations.' },
  { icon: Wallet, title: 'Digital Wallet', desc: 'Instant refunds, coupon system, reward points, and transaction history.' },
  { icon: Bot, title: 'AI Chatbot', desc: '24/7 intelligent assistant for bookings, cancellations, PNR status, and travel queries.' },
  { icon: Ticket, title: 'E-Tickets & QR', desc: 'Paperless travel with QR-based e-tickets, PDF downloads, and offline access.' },
  { icon: Globe, title: 'Live Tracking', desc: 'Real-time train tracking via WebSocket with live position and delay updates.' },
];

export default function Features() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-16 space-y-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Features</h1>
        <p className="text-[var(--color-text-muted)] text-lg max-w-2xl mx-auto">
          Everything you need for a premium train travel experience
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {allFeatures.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            viewport={{ once: true }}
          >
            <Card className="h-full space-y-4">
              <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center">
                <f.icon className="text-[var(--color-primary)]" size={24} />
              </div>
              <h3 className="font-semibold text-lg">{f.title}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">{f.desc}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
