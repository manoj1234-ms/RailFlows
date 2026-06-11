import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Search, RefreshCw, Train, Clock, MapPin, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { bookingsApi } from '@/api/bookings';
import { formatDate, pnrColor } from '@/utils/format';

const STATUS_COLORS: Record<string, string> = {
  WAITLIST: 'warning',
  RAC: 'info',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
};

export default function PnrStatus() {
  const [pnrInput, setPnrInput] = useState('');
  const [activePnr, setActivePnr] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: res, isLoading, isError, refetch } = useQuery({
    queryKey: ['pnr-status', activePnr],
    queryFn: () => bookingsApi.getByPnr(activePnr),
    enabled: !!activePnr,
    refetchInterval: autoRefresh ? 30000 : false,
  });

  const handleSearch = () => {
    if (!pnrInput.trim()) return;
    setActivePnr(pnrInput.trim().toUpperCase());
  };

  useEffect(() => {
    if (activePnr && autoRefresh) {
      const interval = setInterval(() => refetch(), 30000);
      return () => clearInterval(interval);
    }
  }, [activePnr, autoRefresh, refetch]);

  const booking = res?.data.data;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">PNR Status</h1>
        <p className="text-[var(--color-text-muted)] text-sm">Track your waitlist, RAC, or confirmed booking</p>
      </div>

      <Card className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="Enter 10-digit PNR number"
              value={pnrInput}
              onChange={(e) => setPnrInput(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10))}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} loading={isLoading}>
            <Search size={16} /> Check Status
          </Button>
        </div>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-48" />
        </div>
      )}

      {isError && (
        <Card className="text-center py-8 text-[var(--color-text-muted)] space-y-3">
          <Train size={40} className="mx-auto opacity-30" />
          <p className="text-[var(--color-danger)]">PNR not found or an error occurred</p>
          <p className="text-sm">Please check the PNR number and try again</p>
        </Card>
      )}

      {booking && !isLoading && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={(STATUS_COLORS[booking.status] || 'default') as any}>
                  {booking.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold text-[var(--color-primary)]">PNR: {booking.pnr}</span>
                <button
                  onClick={() => { setAutoRefresh(!autoRefresh); }}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${autoRefresh ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                  title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                >
                  <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div className="glass rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-lg">
                <Train size={20} className="text-[var(--color-primary)]" />
                {booking.trainName} ({booking.trainNumber})
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <MapPin size={14} />
                {booking.fromStation} → {booking.toStation}
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Clock size={14} />
                Booked on {formatDate(booking.createdAt)}
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Users size={14} />
                {booking.passengers?.length || 0} passenger(s)
              </div>
            </div>

            {booking.status === 'WAITLIST' || booking.status === 'RAC' ? (
              <div className={`p-4 rounded-lg ${booking.status === 'RAC' ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-orange-500/10 border border-orange-500/30'}`}>
                <p className="text-sm font-medium">
                  {booking.status === 'RAC'
                    ? 'Your booking is under Reservation Against Cancellation (RAC)'
                    : 'Your booking is on the waitlist'}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Status auto-refreshes every 30 seconds. You will be notified when confirmed.
                </p>
              </div>
            ) : booking.status === 'CONFIRMED' ? (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <p className="text-sm font-medium text-green-400">✓ Booking Confirmed</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Your seats are confirmed. Download your e-ticket below.</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  try {
                    const blob = await bookingsApi.downloadTicket(booking.pnr);
                    const url = window.URL.createObjectURL(blob.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `eticket-${booking.pnr}.pdf`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                  } catch { /* ignore */ }
                }}
              >
                Download Ticket
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const text = `🎫 RailFlow Booking\nPNR: ${booking.pnr}\nTrain: ${booking.trainName} (${booking.trainNumber})\nStatus: ${booking.status}\nRoute: ${booking.fromStation} → ${booking.toStation}`;
                  navigator.clipboard.writeText(text);
                }}
              >
                Copy Details
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {!activePnr && !isLoading && !booking && (
        <Card className="text-center py-12 text-[var(--color-text-muted)] space-y-3">
          <Search size={48} className="mx-auto opacity-30" />
          <p className="text-lg">Enter a PNR number to check status</p>
          <p className="text-sm">You can find your PNR on your booking confirmation</p>
        </Card>
      )}
    </div>
  );
}
