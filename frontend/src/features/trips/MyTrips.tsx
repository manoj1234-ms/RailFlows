import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Train, Download, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { bookingsApi } from '@/api/bookings';
import { formatDate, pnrColor } from '@/utils/format';
import type { Booking } from '@/types';

type Tab = 'upcoming' | 'completed' | 'cancelled';

export default function MyTrips() {
  const [tab, setTab] = useState<Tab>('upcoming');

  const { data: res, isLoading } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => bookingsApi.getHistory({ page: 1, limit: 50 }),
  });

  const all = res?.data.data;
  const trips: Record<Tab, Booking[]> = {
    upcoming: all?.upcoming || [],
    completed: all?.completed || [],
    cancelled: all?.cancelled || [],
  };

  const handleCancel = async (pnr: string) => {
    try {
      await bookingsApi.cancel(pnr);
      toast.success('Booking cancelled');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Cancellation failed');
    }
  };

  const tabs: Tab[] = ['upcoming', 'completed', 'cancelled'];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">My Trips</h1>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors cursor-pointer ${tab === t ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-32" count={3} />
      ) : trips[tab].length === 0 ? (
        <div className="text-center py-16 text-[var(--color-text-muted)] space-y-3">
          <Train size={48} className="mx-auto opacity-30" />
          <p>No {tab} trips</p>
          <Link to="/search"><Button size="sm">Book a Train</Button></Link>
        </div>
      ) : (
        <div className="space-y-4">
          {trips[tab].map((b: any) => (
            <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{b.train_name}</span>
                      <span className="text-sm text-[var(--color-text-muted)]">({b.train_number})</span>
                      <Badge variant={b.status === 'CONFIRMED' ? 'success' : b.status === 'CANCELLED' ? 'danger' : 'warning'}>{b.status}</Badge>
                    </div>
                    <div className="text-sm text-[var(--color-text-muted)]">
                      {b.from_station} → {b.to_station}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      PNR: <span className="font-mono">{b.pnr}</span> · {formatDate(b.created_at)}
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <div className={pnrColor(b.status)}>₹{b.price}</div>
                    {b.status === 'CONFIRMED' && (
                      <div className="flex gap-2">
                        <Link to={`/booking/success?pnr=${b.pnr}`}>
                          <Button size="sm" variant="ghost"><Download size={14} /></Button>
                        </Link>
                        <Button size="sm" variant="ghost" onClick={() => handleCancel(b.pnr)}><XCircle size={14} className="text-[var(--color-danger)]" /></Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
