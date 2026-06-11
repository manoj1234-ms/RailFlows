import { useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle, Download, Share2, MessageCircle, Ticket, User, IndianRupee, Train } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { bookingsApi } from '@/api/bookings';
import { formatDate, formatCurrency } from '@/utils/format';

const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' };

function TicketPreview({ booking, pnr }: { booking: any; pnr: string }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="bg-white text-black rounded-xl p-6 space-y-4 shadow-lg" style={{ fontFamily: 'monospace' }}>
      <div className="text-center border-b-2 border-dashed border-gray-300 pb-4">
        <div className="text-xl font-bold tracking-wide">RAILFLOW</div>
        <div className="text-xs text-gray-500">Indian Railways e-Ticket</div>
      </div>
      <div className="flex justify-between items-center">
        <div>
          <div className="text-lg font-bold">{booking.trainName}</div>
          <div className="text-xs text-gray-500">{booking.trainNumber}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">{booking.fromStation} → {booking.toStation}</div>
        </div>
      </div>
      <div className="border-t border-dashed border-gray-300 pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">PNR</span>
          <span className="font-bold">{pnr}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <span className="font-bold text-green-600">{booking.status}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Date</span>
          <span className="font-bold">{formatDate(booking.createdAt)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Passengers</span>
          <span className="font-bold">{booking.passengers?.length || 0}</span>
        </div>
      </div>
      {booking.passengers && booking.passengers.length > 0 && (
        <div className="border-t border-dashed border-gray-300 pt-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Age</th>
                <th className="text-left py-1">Gender</th>
                <th className="text-left py-1">Seat</th>
              </tr>
            </thead>
            <tbody>
              {booking.passengers.map((p: any, i: number) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="py-1 font-medium">{p.name}</td>
                  <td className="py-1">{p.age}</td>
                  <td className="py-1">{GENDER_LABEL[p.gender] || p.gender}</td>
                  <td className="py-1">{p.seat || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t-2 border-dashed border-gray-300 pt-4 flex justify-between text-sm">
        <span className="text-gray-500">Total Fare</span>
        <span className="font-bold text-lg">{formatCurrency(booking.price)}</span>
      </div>
      <div className="text-center text-[10px] text-gray-400 pt-2 border-t border-gray-200">
        This is a computer-generated e-ticket. Valid with valid Photo ID.
      </div>
    </div>
  );
}

export default function BookingSuccess() {
  const [searchParams] = useSearchParams();
  const pnr = searchParams.get('pnr') || '';

  const { data: res, isLoading } = useQuery({
    queryKey: ['booking', pnr],
    queryFn: () => bookingsApi.getByPnr(pnr),
    enabled: !!pnr,
  });

  const booking = res?.data.data;

  const handleDownload = async () => {
    try {
      const blob = await bookingsApi.downloadTicket(pnr);
      const url = window.URL.createObjectURL(blob.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eticket-${pnr}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Ticket downloaded');
    } catch {
      toast.error('Download failed');
    }
  };

  const shareText = useMemo(() => {
    if (!booking) return `RailFlow Booking Confirmed! PNR: ${pnr}`;
    return `🎫 RailFlow Booking Confirmed!\nPNR: ${booking.pnr}\nTrain: ${booking.trainName} (${booking.trainNumber})\nRoute: ${booking.fromStation} → ${booking.toStation}\nBook your tickets at railflow.app`;
  }, [booking, pnr]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'RailFlow Booking', text: shareText });
        return;
      } catch { /* user cancelled */ }
    }
    navigator.clipboard.writeText(shareText);
    toast.success('Booking details copied!');
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  if (isLoading) return <div className="max-w-lg mx-auto px-4 py-16"><Skeleton className="h-64" /></div>;

  return (
    <div className="max-w-lg mx-auto px-4 py-16">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full bg-[var(--color-success)]/20 flex items-center justify-center">
          <CheckCircle className="text-[var(--color-success)]" size={40} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Booking Confirmed!</h1>
          <p className="text-[var(--color-text-muted)] text-sm">Your e-ticket is ready</p>
        </div>

        {booking && (
          <Card className="text-left space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant={booking.status === 'CONFIRMED' ? 'success' : 'warning'}>{booking.status}</Badge>
              <span className="text-sm font-mono font-bold text-[var(--color-primary)]">PNR: {booking.pnr}</span>
            </div>

            <div className="glass rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Train size={18} className="text-[var(--color-primary)]" />
                {booking.trainName} ({booking.trainNumber})
              </div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {booking.fromStation} → {booking.toStation}
              </div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {formatDate(booking.createdAt)}
              </div>
            </div>

            {booking.passengers && booking.passengers.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <User size={14} /> Passengers
                </h3>
                <div className="glass rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
                        <th className="text-left p-2">Name</th>
                        <th className="text-left p-2">Age</th>
                        <th className="text-left p-2">Gender</th>
                        <th className="text-left p-2">Seat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {booking.passengers.map((p: any, i: number) => (
                        <tr key={i} className="border-b border-[var(--color-border)]/50 last:border-0">
                          <td className="p-2 font-medium">{p.name}</td>
                          <td className="p-2">{p.age}</td>
                          <td className="p-2">{GENDER_LABEL[p.gender] || p.gender}</td>
                          <td className="p-2">{p.seat || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <IndianRupee size={14} /> Fare Summary
              </h3>
              <div className="glass rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Base Fare</span>
                  <span>{formatCurrency(booking.price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Convenience Fee</span>
                  <span className="text-[var(--color-success)]">FREE</span>
                </div>
                <div className="flex justify-between border-t border-[var(--color-border)] pt-2 font-semibold">
                  <span>Total Paid</span>
                  <span className="text-[var(--color-primary)]">{formatCurrency(booking.price)}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Ticket size={14} /> e-Ticket Preview
              </h3>
              <TicketPreview booking={booking} pnr={pnr} />
            </div>

            <div className="flex gap-3">
              <Button onClick={handleDownload} variant="outline" className="flex-1">
                <Download size={16} /> Download PDF
              </Button>
              <Button onClick={handleWhatsApp} variant="outline" className="flex-1">
                <MessageCircle size={16} /> WhatsApp
              </Button>
              <Button onClick={handleShare} variant="outline" className="flex-1">
                <Share2 size={16} /> Share
              </Button>
            </div>
          </Card>
        )}

        <div className="flex justify-center gap-4">
          <Link to="/my-trips"><Button variant="outline">My Trips</Button></Link>
          <Link to="/search"><Button>Book Another</Button></Link>
        </div>
      </motion.div>
    </div>
  );
}
