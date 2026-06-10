import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ArrowRightLeft, Calendar, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { FareCalendar } from '@/components/ui/FareCalendar';
import { stationsApi } from '@/api/stations';
import { cn } from '@/utils/cn';
import { QUOTA_TYPES } from '@/utils/constants';

const searchSchema = z.object({
  from: z.string().min(2, 'Enter departure station'),
  to: z.string().min(2, 'Enter arrival station'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a valid date'),
});

type SearchData = z.infer<typeof searchSchema>;

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<{ from: any[]; to: any[] }>({ from: [], to: [] });
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [quota, setQuota] = useState('GN');

  const { setValue, watch, formState: { errors } } = useForm<SearchData>({
    resolver: zodResolver(searchSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0] },
  });

  const fromVal = watch('from');
  const toVal = watch('to');
  const dateVal = watch('date');

  const handleAutocomplete = useCallback(async (field: 'from' | 'to', query: string) => {
    if (query.length < 2) { setSuggestions((s) => ({ ...s, [field]: [] })); return; }
    try {
      const res = await stationsApi.autocomplete({ q: query, limit: 5 });
      setSuggestions((s) => ({ ...s, [field]: res.data.data }));
    } catch { /* ignore */ }
  }, []);

  const swapStations = () => {
    const f = fromVal;
    const t = toVal;
    setValue('from', t);
    setValue('to', f);
  };

  const onSubmit = () => {
    if (fromVal.toUpperCase() === toVal.toUpperCase()) {
      toast.error('From and To stations cannot be the same');
      return;
    }
    navigate(`/search/results?from=${encodeURIComponent(fromVal)}&to=${encodeURIComponent(toVal)}&date=${dateVal}&quota=${quota}`);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Search Trains</h1>
          <p className="text-[var(--color-text-muted)]">Find and book trains across India</p>
        </div>

        <Card className="space-y-6">
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
              <div className="relative">
                <Input
                  id="from"
                  label="From Station"
                  placeholder="e.g. NDLS, Mumbai"
                  value={fromVal || ''}
                  onFocus={() => setActiveField('from')}
                  onBlur={() => setTimeout(() => setActiveField(null), 200)}
                  onChange={(e) => { setValue('from', e.target.value); handleAutocomplete('from', e.target.value); }}
                  error={errors.from?.message}
                />
                {activeField === 'from' && suggestions.from.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 glass rounded-lg border border-[var(--color-border)] overflow-hidden">
                    {suggestions.from.map((s: any) => (
                      <button
                        key={s.code}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors cursor-pointer"
                        onMouseDown={() => { setValue('from', s.code); setSuggestions((prev) => ({ ...prev, from: [] })); }}
                      >
                        <span className="font-medium">{s.code}</span> - {s.name}, {s.city}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button type="button" onClick={swapStations} className="p-2 rounded-lg hover:bg-white/10 transition-colors mb-1 cursor-pointer">
                <ArrowRightLeft size={18} className="text-[var(--color-primary)]" />
              </button>

              <div className="relative">
                <Input
                  id="to"
                  label="To Station"
                  placeholder="e.g. BCT, Chennai"
                  value={toVal || ''}
                  onFocus={() => setActiveField('to')}
                  onBlur={() => setTimeout(() => setActiveField(null), 200)}
                  onChange={(e) => { setValue('to', e.target.value); handleAutocomplete('to', e.target.value); }}
                  error={errors.to?.message}
                />
                {activeField === 'to' && suggestions.to.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 glass rounded-lg border border-[var(--color-border)] overflow-hidden">
                    {suggestions.to.map((s: any) => (
                      <button
                        key={s.code}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors cursor-pointer"
                        onMouseDown={() => { setValue('to', s.code); setSuggestions((prev) => ({ ...prev, to: [] })); }}
                      >
                        <span className="font-medium">{s.code}</span> - {s.name}, {s.city}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCalendar(!showCalendar)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 rounded-lg border bg-transparent text-left transition-colors cursor-pointer',
                  showCalendar ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'
                )}
              >
                <div>
                  <span className="text-xs text-[var(--color-text-muted)]">Journey Date</span>
                  <div className="text-sm font-medium">{dateVal ? formatDisplayDate(dateVal) : 'Select date'}</div>
                </div>
                <Calendar size={18} className="text-[var(--color-primary)]" />
              </button>
              {errors.date?.message && <p className="text-xs text-red-400 mt-1">{errors.date.message}</p>}

              {showCalendar && fromVal && toVal && (
                <div className="absolute z-20 mt-2 left-0 right-0">
                  <FareCalendar
                    from={fromVal}
                    to={toVal}
                    selectedDate={dateVal}
                    onDateSelect={(d) => { setValue('date', d); setShowCalendar(false); }}
                  />
                </div>
              )}
            </div>

            <div>
              <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-2"><Users size={12} /> Quota</span>
              <div className="flex flex-wrap gap-1.5">
                {QUOTA_TYPES.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    onClick={() => setQuota(q.value)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer',
                      quota === q.value ? 'bg-[var(--color-primary)] text-white' : 'glass hover:bg-white/10 text-[var(--color-text-muted)]'
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={onSubmit} size="lg" className="w-full text-base">
              <Search size={18} /> Search Trains
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
