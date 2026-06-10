import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { bookingsApi } from '@/api/bookings';
import { formatDate, pnrColor } from '@/utils/format';

export default function History() {
  const [search, setSearch] = useState('');

  const { data: res, isLoading } = useQuery({
    queryKey: ['booking-history'],
    queryFn: () => bookingsApi.getHistory({ page: 1, limit: 100 }),
  });

  const allBookings = res?.data.data?.all || [];
  const filtered = search
    ? allBookings.filter((b: any) => b.pnr?.toLowerCase().includes(search.toLowerCase()) || b.train_number?.toLowerCase().includes(search.toLowerCase()))
    : allBookings;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Booking History</h1>
        <Input placeholder="Search by PNR or train..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {isLoading ? (
        <Skeleton className="h-24" count={5} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-text-muted)]">No bookings found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b: any) => (
            <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.train_name || b.train_number}</span>
                    <Badge variant={b.status === 'CONFIRMED' ? 'success' : b.status === 'CANCELLED' ? 'danger' : 'warning'}>{b.status}</Badge>
                  </div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    {b.from_station} → {b.to_station} · {formatDate(b.created_at)}
                  </div>
                  <div className="text-xs font-mono text-[var(--color-text-muted)]">PNR: {b.pnr}</div>
                </div>
                <div className="text-right space-y-1">
                  <div className={pnrColor(b.status)}>₹{b.price}</div>
                  <Link to={`/booking/success?pnr=${b.pnr}`}>
                    <Button size="sm" variant="ghost"><Download size={14} /></Button>
                  </Link>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
