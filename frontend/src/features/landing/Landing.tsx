import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Search, Shield, Zap, BarChart3, Bot, Wallet, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HeroScene } from '@/components/three/HeroScene';
import { FloatingRouteCard } from '@/components/three/FloatingRouteCard';
import { useAuthStore } from '@/store/authStore';

const stats = [
  { label: 'Daily Bookings', value: '50K+' },
  { label: 'Trains Covered', value: '12K+' },
  { label: 'Happy Users', value: '10M+' },
  { label: 'Stations', value: '8K+' },
];

const features = [
  { icon: Search, title: 'Smart Search', desc: 'AI-powered train search with fuzzy station matching and fare calendar.' },
  { icon: Shield, title: 'Secure Booking', desc: 'End-to-end encrypted transactions with PCI DSS compliance.' },
  { icon: Zap, title: 'Real-time Queue', desc: 'Virtual queue system with live position tracking and anti-tampering.' },
  { icon: BarChart3, title: 'ML Predictions', desc: 'Waitlist confirmation predictions and fare forecasting.' },
  { icon: Wallet, title: 'Digital Wallet', desc: 'Integrated wallet with instant refunds and reward points.' },
  { icon: Bot, title: 'AI Assistant', desc: '24/7 chatbot for bookings, cancellations, and enquiries.' },
  { icon: Ticket, title: 'E-Tickets', desc: 'Paperless travel with QR-based e-tickets and PDF downloads.' },
  { icon: Shield, title: 'MFA Security', desc: 'Multi-factor authentication with device fingerprinting.' },
];

export default function Landing() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="space-y-0">
      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        <HeroScene />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-bg)]/60 via-transparent to-[var(--color-bg)]" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--color-primary)]/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-[var(--color-secondary)]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />

        <div className="relative max-w-4xl mx-auto px-4 text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            <h1 className="text-5xl md:text-7xl font-bold leading-tight">
              <span className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] bg-clip-text text-transparent">
                Premium Train Booking
              </span>
              <br />
              Reimagined
            </h1>
            <p className="text-lg md:text-xl text-[var(--color-text-muted)] max-w-2xl mx-auto">
              India's most advanced railway booking platform. AI-powered search, real-time tracking,
              secure payments, and a premium travel experience.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex items-center justify-center gap-4 flex-wrap"
          >
            {isAuthenticated ? (
              <Link to="/search">
                <Button size="lg" className="text-base">
                  Book Your Trip <ArrowRight size={18} />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/register">
                  <Button size="lg" className="text-base animate-pulse-glow">
                    Get Started Free <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link to="/search">
                  <Button variant="outline" size="lg" className="text-base">
                    Search Trains
                  </Button>
                </Link>
              </>
            )}
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12"
          >
            {stats.map((s) => (
              <div key={s.label} className="glass rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-[var(--color-primary)]">{s.value}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl font-bold">Everything You Need</h2>
          <p className="text-[var(--color-text-muted)] max-w-2xl mx-auto">
            From smart search to AI-powered predictions, RailFlow offers a complete travel experience.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <FloatingRouteCard key={f.title} intensity={8}>
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="glass rounded-xl p-6 space-y-4 hover:border-[var(--color-primary)]/50 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center">
                  <f.icon className="text-[var(--color-primary)]" size={24} />
                </div>
                <h3 className="font-semibold text-lg">{f.title}</h3>
                <p className="text-sm text-[var(--color-text-muted)]">{f.desc}</p>
              </motion.div>
            </FloatingRouteCard>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 py-24 text-center space-y-6">
        <h2 className="text-3xl md:text-4xl font-bold">Ready to Experience Premium Travel?</h2>
        <p className="text-[var(--color-text-muted)] text-lg">
          Join millions of happy travellers. Book your first trip with RailFlow today.
        </p>
        <Link to={isAuthenticated ? '/search' : '/register'}>
          <Button size="lg" className="text-base animate-pulse-glow">
            {isAuthenticated ? 'Book Now' : 'Create Free Account'} <ArrowRight size={18} />
          </Button>
        </Link>
      </section>
    </div>
  );
}
