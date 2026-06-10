import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Bed, Users, ChevronsUp, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { trainsApi } from '@/api/trains';
import { cn } from '@/utils/cn';
import { COACH_CLASSES } from '@/utils/constants';
import { useBookingStore } from '@/store/bookingStore';

const BERTH_PREFS = [
  { value: 'LB', label: 'Lower', desc: '↓ Lower Berth' },
  { value: 'MB', label: 'Middle', desc: '— Middle Berth' },
  { value: 'UB', label: 'Upper', desc: '↑ Upper Berth' },
  { value: 'SL', label: 'Side Lower', desc: '↙ Side Lower' },
  { value: 'SU', label: 'Side Upper', desc: '↗ Side Upper' },
] as const;

type BerthVal = typeof BERTH_PREFS[number]['value'];

const PASSENGER_OPTIONS = [1, 2, 3, 4, 5, 6];

export default function CoachSelection() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const coachClass = searchParams.get('class') || '3A';

  const [passengerCount, setPassengerCount] = useState(1);
  const [checkedBerths, setCheckedBerths] = useState<BerthVal[]>([]);
  const [autoUpgrade, setAutoUpgrade] = useState(true);
  const setCoach = useBookingStore((s) => s.setCoach);
  const setTrain = useBookingStore((s) => s.setTrain);
  const setPassengerCountStore = useBookingStore((s) => s.setPassengerCount);
  const setBerthPrefs = useBookingStore((s) => s.setBerthPrefs);

  const { data: res, isLoading } = useQuery({
    queryKey: ['coach', id, coachClass],
    queryFn: () => trainsApi.getCoach(id!, coachClass),
    enabled: !!id,
  });

  const seats = res?.data.data?.seats || [];
  const coachesList = [...new Set(seats.map((s: any) => s.coachLabel))] as string[];
  const [selectedCoach, setSelectedCoach] = useState('');

  useEffect(() => {
    if (!selectedCoach && coachesList.length > 0) {
      setSelectedCoach(coachesList[0]);
    }
  }, [coachesList, selectedCoach]);

  const coachSeats = useMemo(() => seats.filter((s: any) => s.coachLabel === selectedCoach), [seats, selectedCoach]);
  const availableCount = useMemo(() => coachSeats.filter((s: any) => s.status === 'AVAILABLE').length, [coachSeats]);

  const handleCheck = (v: BerthVal) => {
    setCheckedBerths((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  };

  const handleContinue = () => {
    if (checkedBerths.length === 0) { toast.error('Select at least 1 berth preference'); return; }
    setTrain(id!);
    setCoach(selectedCoach);
    setPassengerCountStore(passengerCount);
    setBerthPrefs(checkedBerths);
    navigate('/booking');
  };

  const clsLabel = COACH_CLASSES.find((c) => c.value === coachClass)?.label || coachClass;

  if (isLoading) return <div className="max-w-4xl mx-auto px-4 py-8"><Skeleton className="h-96" /></div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <Link to={`/train/${id}`} className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft size={16} /> Back to train details
      </Link>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{clsLabel} — Seat Selection</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{availableCount} seats free in {selectedCoach}</p>
            </div>
          </div>

          {/* Coach tabs */}
          <div className="flex gap-2 flex-wrap">
            {coachesList.map((c) => (
              <button key={c} onClick={() => setSelectedCoach(c)}
                className={cn('px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer', selectedCoach === c ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-border)] text-[var(--color-text-muted)]')}
              >{c}</button>
            ))}
          </div>

          {/* Passengers */}
          <div>
            <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-2"><Users size={12} /> Passengers</span>
            <div className="flex gap-2">
              {PASSENGER_OPTIONS.map((n) => (
                <button key={n} onClick={() => setPassengerCount(n)}
                  className={cn('w-10 h-10 rounded-lg text-sm font-medium transition-colors cursor-pointer', passengerCount === n ? 'bg-[var(--color-primary)] text-white' : 'glass hover:bg-white/10')}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* Berth checkboxes */}
          <div>
            <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-2"><Bed size={12} /> Berth Preference <span className="text-[10px] opacity-60">(tick your choices)</span></span>
            <div className="space-y-1.5">
              {BERTH_PREFS.map((b) => {
                const checked = checkedBerths.includes(b.value);
                return (
                  <div key={b.value} onClick={() => handleCheck(b.value)} className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer',
                    checked ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'
                  )}>
                    <div className={cn(
                      'w-5 h-5 rounded flex items-center justify-center border-2 transition-colors',
                      checked ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-[var(--color-border)]'
                    )}>
                      {checked && <Check size={12} className="text-white" />}
                    </div>
                    <span className="text-sm">{b.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auto upgrade toggle */}
          <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--color-border)] cursor-pointer hover:border-[var(--color-primary)]/50 transition-colors">
            <div onClick={() => setAutoUpgrade(!autoUpgrade)} className={cn(
              'w-5 h-5 rounded flex items-center justify-center border-2 transition-colors',
              autoUpgrade ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-[var(--color-border)]'
            )}>
              {autoUpgrade && <Check size={12} className="text-white" />}
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <ChevronsUp size={14} className="text-[var(--color-primary)]" />
              <span>Auto upgrade if preferred berth not available</span>
            </div>
          </label>

          {/* Continue */}
          <Button onClick={handleContinue} size="lg" disabled={checkedBerths.length === 0} className="w-full text-base">
            Continue → Add Passengers
          </Button>
        </Card>
      </motion.div>
    </div>
  );
}


