import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Train, MapPin, Clock, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { trainsApi } from '@/api/trains';
import { formatCurrency, formatTime } from '@/utils/format';
import { COACH_CLASSES } from '@/utils/constants';

export default function TrainDetails() {
  const { id } = useParams<{ id: string }>();

  const { data: res, isLoading } = useQuery({
    queryKey: ['train', id],
    queryFn: () => trainsApi.getDetails(id!),
    enabled: !!id,
  });

  const train = res?.data.data;

  if (isLoading) return <div className="max-w-4xl mx-auto px-4 py-8 space-y-4"><Skeleton className="h-48" /><Skeleton className="h-64" /></div>;
  if (!train) return <div className="text-center py-16 text-[var(--color-danger)]">Train not found</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <Link to={`/search/results?from=${train.fromStation}&to=${train.toStation}&date=${new Date().toISOString().split('T')[0]}`} className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={16} /> Back to results
      </Link>

      {/* Train Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="space-y-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center">
                <Train className="text-[var(--color-primary)]" size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{train.name}</h1>
                <p className="text-sm text-[var(--color-text-muted)]">{train.trainNumber} · {formatCurrency(train.baseFare)} base fare</p>
              </div>
            </div>
            <Link to={`/train/${train.trainNumber}/coach`}>
              <Button>Select Seats <ChevronRight size={16} /></Button>
            </Link>
          </div>

          {/* Time */}
          <div className="flex items-center gap-4 p-4 glass rounded-lg">
            <div className="text-center">
              <div className="text-xl font-bold">{formatTime(train.departureTime)}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{train.fromStation}</div>
            </div>
            <div className="flex-1 flex flex-col items-center">
              <Clock size={14} className="text-[var(--color-text-muted)]" />
              <div className="w-full h-px bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)]" />
            </div>
            <div className="text-center">
              <div className="text-xl font-bold">{formatTime(train.arrivalTime)}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{train.toStation}</div>
            </div>
          </div>

          {/* Coach Composition */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Coach Classes</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {train.coachComposition.map((coach, idx) => {
                const cls = COACH_CLASSES.find((c) => c.value === coach.class);
                return (
                  <Link key={`${coach.label}-${idx}`} to={`/train/${train.trainNumber}/coach?class=${coach.class}`}>
                    <div className="glass rounded-lg p-3 text-center hover:border-[var(--color-primary)]/50 transition-colors">
                      <div className="text-sm font-semibold">{cls?.label || coach.class}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{coach.label} · {coach.totalSeats} seats</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Route Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card>
          <h2 className="font-semibold mb-4 flex items-center gap-2"><MapPin size={16} className="text-[var(--color-primary)]" /> Route ({train.route.length} stops)</h2>
          <div className="space-y-0">
            {(train.route || []).map((stop, i) => {
              const name = stop.stationName || stop.station_name || '';
              const code = stop.stationCode || stop.station_code || '';
              const day = stop.dayCount || stop.day_count || 1;
              const arr = stop.arrivalTime || stop.arrival_time || '';
              const dep = stop.departureTime || stop.departure_time || '';
              return (
              <div key={`stop-${i}`} className="flex items-start gap-4 py-3 border-b border-[var(--color-border)] last:border-0">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full ${i === 0 || i === train.route.length - 1 ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`} />
                  {i < train.route.length - 1 && <div className="w-px h-8 bg-[var(--color-border)]" />}
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{code} · Day {day}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div>{arr && arr !== '00:00' ? formatTime(arr) : 'Start'}</div>
                    <div className="text-[var(--color-text-muted)]">{dep && dep !== '00:00' ? formatTime(dep) : 'End'}</div>
                  </div>
                </div>
              </div>
              );
            }
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
