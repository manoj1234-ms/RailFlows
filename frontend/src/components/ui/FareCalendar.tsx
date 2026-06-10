import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, IndianRupee, Train, Clock } from 'lucide-react';
import { trainsApi } from '@/api/trains';
import { cn } from '@/utils/cn';
import { formatCurrency, formatTime } from '@/utils/format';
import { Card } from './Card';
import type { FareCalendarDay } from '@/types';

interface FareCalendarProps {
  from: string;
  to: string;
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function FareCalendar({ from, to, selectedDate, onDateSelect }: FareCalendarProps) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [selectedDayData, setSelectedDayData] = useState<FareCalendarDay | null>(null);
  const [showFareDetail, setShowFareDetail] = useState(false);

  const { data: fareRes } = useQuery({
    queryKey: ['fare-calendar', from, to],
    queryFn: () => trainsApi.fareCalendar({ from: from.toUpperCase(), to: to.toUpperCase() }),
    enabled: !!from && !!to,
  });

  const fareData = (fareRes?.data?.data || []) as FareCalendarDay[];

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [viewMonth, viewYear]);

  const getFareForDate = (day: number): FareCalendarDay | undefined => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return fareData.find((fd) => fd.date === dateStr);
  };

  const isPastDate = (day: number): boolean => {
    const d = new Date(viewYear, viewMonth, day);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d < t;
  };

  const isSelected = (day: number): boolean => {
    return selectedDate === `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const isToday = (day: number): boolean => {
    return today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
    setShowFareDetail(false);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
    setShowFareDetail(false);
  };

  const handleDateClick = (day: number) => {
    if (isPastDate(day)) return;
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDateSelect(dateStr);
    const dayData = getFareForDate(day);
    if (dayData?.trains.length) {
      setSelectedDayData(dayData);
      setShowFareDetail(true);
    }
  };

  const canGoPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={prevMonth}
            disabled={!canGoPrev}
            className={cn('p-1.5 rounded-lg transition-colors', canGoPrev ? 'hover:bg-white/10 cursor-pointer' : 'opacity-30 cursor-not-allowed')}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
          <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-xs text-[var(--color-text-muted)] font-medium py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />;
            const fare = getFareForDate(day);
            const past = isPastDate(day);
            const sel = isSelected(day);
            const tdy = isToday(day);

            return (
              <button
                key={day}
                type="button"
                disabled={past}
                onClick={() => handleDateClick(day)}
                className={cn(
                  'relative flex flex-col items-center py-1.5 px-1 rounded-lg text-sm transition-all min-h-[56px]',
                  past && 'opacity-30 cursor-not-allowed',
                  !past && 'hover:bg-white/10 cursor-pointer',
                  sel && 'bg-[var(--color-primary)]/20 ring-1 ring-[var(--color-primary)]',
                  tdy && !sel && 'ring-1 ring-[var(--color-secondary)]',
                )}
              >
                <span className={cn('text-xs leading-tight', sel ? 'text-[var(--color-primary)] font-bold' : '')}>{day}</span>
                {fare && fare.cheapestFare !== null ? (
                  <span className="text-[10px] text-green-400 font-medium mt-0.5 leading-tight">
                    ₹{fare.cheapestFare}
                  </span>
                ) : !past ? (
                  <span className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-tight">—</span>
                ) : null}
                {fare?.isWeekend && <div className="absolute top-0.5 right-1 w-1 h-1 rounded-full bg-[var(--color-secondary)]" />}
              </button>
            );
          })}
        </div>
      </Card>

      {showFareDetail && selectedDayData && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">
                {new Date(selectedDayData.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h4>
              {selectedDayData.cheapestFare !== null && (
                <span className="text-sm text-green-400">From {formatCurrency(selectedDayData.cheapestFare)}</span>
              )}
            </div>

            <div className="space-y-2">
              {selectedDayData.trains.map((t) => (
                <div key={t.trainNumber} className="flex items-center justify-between p-3 glass rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Train size={14} className="text-[var(--color-primary)]" />
                      <span className="font-medium text-sm">{t.trainName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1"><Clock size={12} />{formatTime(t.departureTime)} - {formatTime(t.arrivalTime)}</span>
                      <span>{t.distanceKm} km</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[var(--color-primary)]">{formatCurrency(t.fare)}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)]">base fare</div>
                    {t.fareBreakup && (
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">+₹{t.fareBreakup.reservationFee} resv · ₹{t.fareBreakup.superfastCharge} superfast</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedDayData.trains.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No trains available on this date</p>
            )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
