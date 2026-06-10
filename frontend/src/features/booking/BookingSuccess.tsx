import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle, Download, Share2, MessageCircle, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { bookingsApi } from '@/api/bookings';
import { formatDate } from '@/utils/format';

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
              <Badge variant="success">CONFIRMED</Badge>
              <span className="text-sm font-mono font-bold text-[var(--color-primary)]">PNR: {booking.pnr}</span>
            </div>

            <div className="glass rounded-lg p-4 space-y-2">
              <div className="font-semibold">{booking.trainName} ({booking.trainNumber})</div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {booking.fromStation} → {booking.toStation}
              </div>
              <div className="text-sm">{formatDate(booking.createdAt)}</div>
            </div>

            <div className="flex items-center justify-center">
              <div className="w-32 h-32 bg-white rounded-lg flex items-center justify-center">
                <Ticket size={64} className="text-black" />
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleDownload} variant="outline" className="flex-1">
                <Download size={16} /> Download
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
