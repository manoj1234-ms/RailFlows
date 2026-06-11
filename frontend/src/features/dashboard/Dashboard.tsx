import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Train, Ticket, Wallet, Bell, Search, Star, TrendingUp,
  Clock, ShieldCheck, MapPin, Radio,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { bookingsApi } from '@/api/bookings';
import { useAuthStore } from '@/store/authStore';
import { formatDate, pnrColor } from '@/utils/format';
import MfaSetupModal from './MfaSetupModal';
import LiveTrackingWidget from './LiveTrackingWidget';

const quickActions = [
  { icon: Search, label: 'Book a Train', to: '/search', color: 'from-[var(--color-primary)] to-[var(--color-secondary)]' },
  { icon: Ticket, label: 'My Trips', to: '/my-trips', color: 'from-[var(--color-success)] to-emerald-600' },
  { icon: Wallet, label: 'Wallet', to: '/wallet', color: 'from-[var(--color-warning)] to-amber-600' },
  { icon: Star, label: 'Loyalty', to: '/loyalty', color: 'from-purple-500 to-pink-500' },
];

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const [showMfa, setShowMfa] = useState(false);
  const [mfaActive, setMfaActive] = useState(false);
  const [trackTrain, setTrackTrain] = useState('');
  const [showTracking, setShowTracking] = useState(false);

  const { data: bookingsRes, isLoading } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => bookingsApi.getHistory({ page: 1, limit: 5 }),
    enabled: !!localStorage.getItem('accessToken'),
  });

  const upcoming = bookingsRes?.data.data?.upcoming || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Welcome */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold">
          Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}!
        </h1>
        <p className="text-[var(--color-text-muted)]">Ready for your next journey?</p>
      </motion.div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {quickActions.map((action, i) => (
          <motion.div key={action.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Link to={action.to}>
              <Card hover className="text-center space-y-3 py-6">
                <div className={`w-12 h-12 mx-auto rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center`}>
                  <action.icon size={22} className="text-white" />
                </div>
                <span className="text-sm font-medium">{action.label}</span>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Security & Live Tracking row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* MFA Security Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mfaActive ? 'bg-emerald-500/20' : 'bg-slate-700/50'}`}>
                <ShieldCheck size={20} className={mfaActive ? 'text-emerald-400' : 'text-[var(--color-text-muted)]'} />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Two-Factor Authentication</h3>
                <p className={`text-xs ${mfaActive ? 'text-emerald-400' : 'text-[var(--color-text-muted)]'}`}>
                  {mfaActive ? '✓ MFA is active' : 'Not enabled — your account is at risk'}
                </p>
              </div>
            </div>
            {!mfaActive && (
              <Button
                size="sm"
                onClick={() => setShowMfa(true)}
                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500"
              >
                <ShieldCheck size={14} /> Enable MFA Now
              </Button>
            )}
          </Card>
        </motion.div>

        {/* Live Train Tracking Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Radio size={20} className="text-sky-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Live Train Tracker</h3>
                <p className="text-xs text-[var(--color-text-muted)]">Real-time station updates via WebSocket</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter train number…"
                value={trackTrain}
                onChange={(e) => setTrackTrain(e.target.value.toUpperCase())}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-slate-800/60 border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
              />
              <Button
                size="sm"
                onClick={() => { if (trackTrain) setShowTracking(true); }}
                disabled={!trackTrain}
              >
                <MapPin size={14} /> Track
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Upcoming Trips */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} className="text-[var(--color-primary)]" />
            Upcoming Trips
          </h2>
          <Link to="/my-trips"><Button variant="ghost" size="sm">View All</Button></Link>
        </div>
        {isLoading ? (
          <div className="space-y-3"><Skeleton className="h-20" count={2} /></div>
        ) : upcoming.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)] space-y-3">
            <Train size={40} className="mx-auto opacity-30" />
            <p>No upcoming trips</p>
            <Link to="/search"><Button size="sm">Book a Train</Button></Link>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((b: any) => (
              <Link key={b.id} to={`/booking/success?pnr=${b.pnr}`}>
                <div className="glass rounded-lg p-4 flex items-center justify-between hover:border-[var(--color-primary)]/50 transition-colors">
                  <div>
                    <p className="font-medium">{b.train_name} ({b.train_number})</p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {b.from_station} &rarr; {b.to_station} &middot; {formatDate(b.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={pnrColor(b.status)}>{b.status}</div>
                    <div className="text-sm text-[var(--color-text-muted)]">PNR: {b.pnr}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Stats row */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <TrendingUp className="text-[var(--color-primary)]" size={24} />
            <div>
              <div className="text-2xl font-bold">{bookingsRes?.data.data?.all?.length || 0}</div>
              <div className="text-sm text-[var(--color-text-muted)]">Total Bookings</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Wallet className="text-[var(--color-success)]" size={24} />
            <div>
              <div className="text-2xl font-bold">--</div>
              <div className="text-sm text-[var(--color-text-muted)]">Wallet Balance</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Bell className="text-[var(--color-warning)]" size={24} />
            <div>
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-[var(--color-text-muted)]">Notifications</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showMfa && (
          <MfaSetupModal
            onClose={() => setShowMfa(false)}
            onActivated={() => { setMfaActive(true); setShowMfa(false); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTracking && trackTrain && (
          <LiveTrackingWidget
            trainNumber={trackTrain}
            onClose={() => setShowTracking(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
