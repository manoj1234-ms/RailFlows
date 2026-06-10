import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, Users, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { queueApi } from '@/api/queue';
import { bookingsApi } from '@/api/bookings';
import { useBookingStore } from '@/store/bookingStore';
import type { QueueInfo } from '@/types';

function generateFingerprint(): string {
  const nav = navigator.userAgent + navigator.language;
  let hash = 0;
  for (let i = 0; i < nav.length; i++) {
    hash = ((hash << 5) - hash) + nav.charCodeAt(i);
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

export default function QueuePage() {
  const navigate = useNavigate();
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [joining, setJoining] = useState(true);
  const [deviceFp] = useState(generateFingerprint);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joiningRef = useRef(false);

  const allocateAndRedirect = useCallback(async () => {
    const state = useBookingStore.getState();
    if (state.seatNumbers.length > 0) {
      state.setStep(2);
      navigate('/booking?step=2');
      return;
    }
    try {
      const { data } = await bookingsApi.allocateSeats({
        trainNumber: state.trainNumber!,
        coachLabel: state.coachLabel!,
        passengerCount: state.passengerCount,
      });
      useBookingStore.getState().setSeats(data.data.lockedSeats);
      useBookingStore.getState().setStep(2);
      toast.success(`Seats allocated: ${data.data.lockedSeats.join(', ')}`);
      setTimeout(() => navigate('/booking?step=2'), 800);
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.error(err.response?.data?.message || 'No seats available');
      } else if (err.response?.status === 403) {
        toast.error('Booking window expired. Re-queuing...');
        navigate('/queue');
      } else {
        toast.error(err.response?.data?.message || 'Allocation failed');
      }
    }
  }, [navigate]);

  const joinQueue = useCallback(async () => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    try {
      const { data } = await queueApi.join(deviceFp);
      const info = data.data;
      setQueueInfo(info);
      if (info.currentPosition === 0 && info.bookingWindowExpiresAt) {
        return allocateAndRedirect();
      }
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || 'Failed to join queue';
      if (msg.includes('expired') || msg.includes('suspended')) {
        toast.error(msg + ' — Retrying...');
        setTimeout(() => joinQueue(), 2000);
      } else {
        toast.error(msg);
      }
    } finally {
      setJoining(false);
      joiningRef.current = false;
    }
  }, [deviceFp, allocateAndRedirect]);

  useEffect(() => {
    joinQueue();
  }, [joinQueue]);

  useEffect(() => {
    if (!queueInfo) return;
    const poll = () => {
      queueApi.getStatus({ token: queueInfo.token, deviceFingerprint: deviceFp })
        .then(({ data }) => {
          const info = data.data;
          setQueueInfo(info);
          if (info.currentPosition === 0 && info.bookingWindowExpiresAt) {
            if (pollRef.current) clearInterval(pollRef.current);
            allocateAndRedirect();
          }
        })
        .catch((err: any) => {
          if (err.response?.status === 403) {
            toast.error(err.response?.data?.message || 'Queue access denied');
          }
        });
    };
    pollRef.current = setInterval(poll, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [queueInfo, deviceFp, navigate, allocateAndRedirect]);

  const isReady = queueInfo && queueInfo.currentPosition === 0 && queueInfo.bookingWindowExpiresAt;
  const pct = queueInfo && queueInfo.originalPosition > 0
    ? Math.round((1 - queueInfo.currentPosition / queueInfo.originalPosition) * 100)
    : 0;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg space-y-6">
        <Card className="text-center space-y-8 py-12">
          {joining && !queueInfo ? (
            <div className="space-y-6">
              <div className="w-20 h-20 mx-auto rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
                <Loader2 className="text-[var(--color-primary)] animate-spin" size={36} />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold">Joining Queue...</h1>
                <p className="text-[var(--color-text-muted)] text-sm">Please wait while we secure your spot</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {isReady ? (
                <div className="w-24 h-24 mx-auto rounded-full bg-[var(--color-success)]/20 flex items-center justify-center">
                  <Users className="text-[var(--color-success)]" size={40} />
                </div>
              ) : (
                <div className="relative w-24 h-24 mx-auto">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-border)" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-primary)" strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 42}`}
                      strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
                      strokeLinecap="round"
                      className="transition-all duration-1000 ease-linear"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold">{queueInfo?.currentPosition ?? '-'}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h1 className="text-2xl font-bold">
                  {isReady ? 'Your Turn!' : `${queueInfo?.currentPosition ?? '-'} person${queueInfo?.currentPosition !== 1 ? 's' : ''} ahead of you`}
                </h1>
                <p className="text-[var(--color-text-muted)] text-sm">
                  {isReady
                    ? 'Your booking window is now open. Proceed to book your seats.'
                    : 'Hold tight — you\'re moving up the queue'}
                </p>
              </div>

              {!isReady && queueInfo && queueInfo.estimatedWaitSeconds > 0 && (
                <div className="flex items-center justify-center gap-2 text-[var(--color-text-muted)] text-sm">
                  <Clock size={16} />
                  <span>Est. wait ~{queueInfo.estimatedWaitSeconds >= 60
                    ? `${Math.ceil(queueInfo.estimatedWaitSeconds / 60)} min`
                    : `${queueInfo.estimatedWaitSeconds} sec`}</span>
                </div>
              )}

              {!isReady && queueInfo && (
                <div className="w-full bg-[var(--color-border)] rounded-full h-2 overflow-hidden">
                  <motion.div
                    className="h-full bg-[var(--color-primary)] rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              )}

              {isReady && (
                <Button onClick={allocateAndRedirect} size="lg">
                  Proceed to Booking <ArrowRight size={18} />
                </Button>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
