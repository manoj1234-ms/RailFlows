import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Train, Clock, Users, ArrowUpDown, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { FareCalendar } from '@/components/ui/FareCalendar';
import { trainsApi } from '@/api/trains';
import { stationsApi } from '@/api/stations';
import { formatCurrency, formatTime, formatDuration } from '@/utils/format';
import { cn } from '@/utils/cn';

type SortKey = 'departure' | 'price' | 'duration';

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SearchResults() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const date = searchParams.get('date') || '';
  const quota = searchParams.get('quota') || 'GN';

  const [sortBy, setSortBy] = useState<SortKey>('departure');
  const [showCalendar, setShowCalendar] = useState(false);

  const { data: fromStation } = useQuery({
    queryKey: ['station', from],
    queryFn: () => stationsApi.getByCode(from.toUpperCase()),
    enabled: from.length >= 2,
  });

  const { data: toStation } = useQuery({
    queryKey: ['station', to],
    queryFn: () => stationsApi.getByCode(to.toUpperCase()),
    enabled: to.length >= 2,
  });

  const { data: results, isLoading, isError, error } = useQuery({
    queryKey: ['train-search', from, to, date],
    queryFn: () => trainsApi.search({ from, to, date }),
    enabled: !!from && !!to && !!date,
    retry: 1,
  });

  const trains = results?.data?.data || [];

  const sortedTrains = useMemo(() => {
    return [...trains].sort((a, b) => {
      if (sortBy === 'price') return a.baseFare - b.baseFare;
      if (sortBy === 'duration') return formatDuration(a.departureTime, a.arrivalTime).localeCompare(formatDuration(b.departureTime, b.arrivalTime));
      return a.departureTime.localeCompare(b.departureTime);
    });
  }, [trains, sortBy]);

  const changeDate = (newDate: string) => {
    setSearchParams({ from, to, date: newDate, quota });
    setShowCalendar(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {fromStation?.data.data?.name || from} → {toStation?.data.data?.name || to}
          </h1>
          <Link to="/search" className="text-sm text-[var(--color-primary)] hover:underline">Change stations</Link>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[var(--color-text-muted)]">
            {new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {trains.length} trains found
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCalendar(!showCalendar)}
              className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors cursor-pointer', showCalendar ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]' : 'glass hover:bg-white/10')}
            >
              <Calendar size={13} />
              {formatDisplayDate(date)}
            </button>
            {showCalendar && (
              <div className="absolute z-20 mt-2 right-0 w-72">
                <FareCalendar
                  from={from}
                  to={to}
                  selectedDate={date}
                  onDateSelect={changeDate}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sort */}
      <Card className="flex items-center gap-4 flex-wrap">
        <ArrowUpDown size={16} className="text-[var(--color-text-muted)]" />
        <div className="flex gap-2 text-sm">
          {(['departure', 'price', 'duration'] as SortKey[]).map((s) => (
            <button key={s} onClick={() => setSortBy(s)} className={`cursor-pointer px-3 py-1 rounded-lg transition-colors ${sortBy === s ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-4"><Skeleton className="h-32" count={5} /></div>
      ) : isError ? (
        <div className="text-center py-16 text-[var(--color-text-muted)] space-y-3">
          <Train size={48} className="mx-auto opacity-30" />
          <p className="text-lg text-[var(--color-danger)]">Failed to load trains</p>
          <p className="text-sm">The server may be offline. Please try again.</p>
          <Link to="/search"><Button variant="outline">Modify Search</Button></Link>
        </div>
      ) : sortedTrains.length === 0 ? (
        <div className="text-center py-16 text-[var(--color-text-muted)] space-y-3">
          <Train size={48} className="mx-auto opacity-30" />
          <p className="text-lg">No trains found</p>
          <p>Try different stations or date</p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <span className="px-2 py-1 glass rounded-lg">Try codes: MMCT → NDLS</span>
            <span className="px-2 py-1 glass rounded-lg">NDLS → TVC</span>
            <span className="px-2 py-1 glass rounded-lg">SBC → NZM</span>
          </div>
          <Link to="/search"><Button variant="outline">Modify Search</Button></Link>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedTrains.map((train, i) => (
            <motion.div key={train.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link to={`/train/${train.trainNumber}`}>
                <Card hover className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{train.name}</h3>
                      <p className="text-sm text-[var(--color-text-muted)]">{train.trainNumber}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-[var(--color-primary)]">{formatCurrency(train.baseFare)}</div>
                      <p className="text-xs text-[var(--color-text-muted)]">starting fare</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-lg font-semibold">{formatTime(train.departureTime)}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{train.fromStation}</div>
                    </div>
                    <div className="flex-1 flex flex-col items-center">
                      <Clock size={14} className="text-[var(--color-text-muted)]" />
                      <div className="text-xs text-[var(--color-text-muted)]">{formatDuration(train.departureTime, train.arrivalTime)}</div>
                      <div className="w-full h-px bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-secondary)] to-[var(--color-primary)]" />
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold">{formatTime(train.arrivalTime)}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{train.toStation}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-[var(--color-text-muted)]" />
                      <span>{train.availableSeatsCount ?? '?'} seats available</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded glass border border-[var(--color-border)]">{quota}</span>
                    </div>
                    <Badge variant={train.availableSeatsCount && train.availableSeatsCount > 10 ? 'success' : train.availableSeatsCount && train.availableSeatsCount > 0 ? 'warning' : 'danger'}>
                      {train.availableSeatsCount && train.availableSeatsCount > 10 ? 'Available' : train.availableSeatsCount && train.availableSeatsCount > 0 ? 'Filling Fast' : 'Full'}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
