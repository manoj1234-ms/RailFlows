import { useState, createElement, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { User, Sofa, Eye, CreditCard, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { bookingsApi } from '@/api/bookings';
import { useBookingStore } from '@/store/bookingStore';
import { BOOKING_STEPS, GENDER_OPTIONS, PAYMENT_METHODS } from '@/utils/constants';

function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-150, 150], [8, -8]);
  const rotateY = useTransform(x, [-150, 150], [-8, 8]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  };
  const handleMouseLeave = () => { x.set(0); y.set(0); };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function BookingFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const store = useBookingStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const step = parseInt(stepParam) as 1 | 2 | 3 | 4;
      if (step >= 1 && step <= 4 && store.bookingStep !== step) {
        store.setStep(step);
      }
    }
  }, []);

  const [passengerForms, setPassengerForms] = useState<{ name: string; age: number; gender: string; aadhaar: string }[]>(() => {
    if (store.passengers.length > 0) return store.passengers as any;
    return Array.from({ length: Math.max(1, store.passengerCount) }, () => ({ name: '', age: 0, gender: 'M', aadhaar: '' }));
  });

  const handlePassengerChange = (i: number, field: string, value: any) => {
    const updated = [...passengerForms];
    (updated[i] as any)[field] = value;
    setPassengerForms(updated);
  };

  const addPassenger = () => {
    if (passengerForms.length >= 6) { toast.error('Max 6 passengers'); return; }
    setPassengerForms([...passengerForms, { name: '', age: 0, gender: 'M', aadhaar: '' }]);
  };

  const removePassenger = (i: number) => {
    if (passengerForms.length <= 1) return;
    setPassengerForms(passengerForms.filter((_, idx) => idx !== i));
  };

  const saveForms = () => store.setPassengers(passengerForms as any);

  const handleBack = () => {
    saveForms();
    navigate(`/train/${store.trainNumber}/coach`);
  };

  const joinQueue = () => {
    if (passengerForms.some((p) => !p.name || p.age < 1 || p.aadhaar.length !== 12)) {
      toast.error('Fill all passenger details correctly');
      return;
    }
    if (!store.aadhaarConsentGiven) {
      toast.error('Aadhaar processing consent is required to join queue');
      return;
    }
    saveForms();
    navigate('/queue');
  };

  const confirmBooking = async () => {
    setLoading(true);
    const idempotencyKey = `book_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    store.setIdempotencyKey(idempotencyKey);

    try {
      const { data } = await bookingsApi.confirm({
        trainNumber: store.trainNumber!,
        coachLabel: store.coachLabel!,
        seatNumbers: store.seatNumbers,
        passengers: store.passengers,
        aadhaarConsentGiven: store.aadhaarConsentGiven,
        paymentMethod: store.paymentMethod || 'UPI',
        idempotencyKey,
      });
      toast.success('Booking confirmed!');
      navigate(`/booking/success?pnr=${data.data.pnr}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Booking failed');
    } finally {
      setLoading(false);
    }
  };

  const goToPayment = () => {
    store.setStep(4);
    navigate('/payment');
  };

  const stepIcons = [User, Sofa, Eye, CreditCard];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Progress Bar */}
      <div className="flex items-center justify-between">
        {BOOKING_STEPS.map((s, i) => (
          <div key={s.step} className="flex items-center">
            <div className={`flex items-center gap-2 ${store.bookingStep >= s.step ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${store.bookingStep >= s.step ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-border)]'}`}>
                {createElement(stepIcons[i], { size: 16 })}
              </div>
              <span className="text-sm hidden md:inline">{s.label}</span>
            </div>
            {i < BOOKING_STEPS.length - 1 && <div className={`w-12 md:w-20 h-px mx-2 ${store.bookingStep > s.step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Passenger Details */}
      {store.bookingStep === 1 && (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <TiltCard>
          <Card className="space-y-6" style={{ transformStyle: 'preserve-3d' }}>
            <h2 className="text-lg font-semibold">Passenger Details</h2>
            {passengerForms.map((p, i) => (
              <div key={i} className="p-4 glass rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Passenger {i + 1}</span>
                  {passengerForms.length > 1 && (
                    <button onClick={() => removePassenger(i)} className="text-xs text-[var(--color-danger)] cursor-pointer">Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Full Name" placeholder="e.g. Rahul Sharma" value={p.name} onChange={(e) => handlePassengerChange(i, 'name', e.target.value)} />
                  <Input label="Age" type="number" placeholder="25" value={p.age || ''} onChange={(e) => handlePassengerChange(i, 'age', parseInt(e.target.value) || 0)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-[var(--color-text-muted)]">Gender</label>
                    <select
                      value={p.gender}
                      onChange={(e) => handlePassengerChange(i, 'gender', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                    >
                      {GENDER_OPTIONS.map((g) => (<option key={g.value} value={g.value}>{g.label}</option>))}
                    </select>
                  </div>
                  <Input label="Aadhaar Number" placeholder="123456789012" value={p.aadhaar} onChange={(e) => handlePassengerChange(i, 'aadhaar', e.target.value)} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addPassenger}>+ Add Passenger</Button>
            
            {/* Aadhaar Consent Checkbox */}
            <div className="flex items-start gap-2.5 p-3 glass rounded-lg my-2 text-left">
              <input
                type="checkbox"
                id="aadhaar-consent"
                checked={store.aadhaarConsentGiven}
                onChange={(e) => store.setAadhaarConsentGiven(e.target.checked)}
                className="mt-1 accent-[var(--color-primary)] cursor-pointer"
              />
              <label htmlFor="aadhaar-consent" className="text-xs text-[var(--color-text-muted)] leading-relaxed cursor-pointer select-none">
                I hereby declare that I have obtained explicit consent from all passengers to share their Aadhaar numbers for identity verification and ticket booking purposes in compliance with the DPDP Act 2023.
              </label>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={handleBack}>
                <ChevronLeft size={18} /> Back
              </Button>
              <Button onClick={joinQueue}>Join Queue</Button>
            </div>
          </Card>
          </TiltCard>
        </motion.div>
      )}

      {/* Step 2/3: Review (after auto-allocate) */}
      {store.bookingStep === 2 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <TiltCard>
          <Card className="space-y-6" style={{ transformStyle: 'preserve-3d' }}>
            <h2 className="text-lg font-semibold">Review & Pay</h2>
            <div className="space-y-3">
              <div className="glass rounded-lg p-4 space-y-2">
                <div className="text-sm text-[var(--color-text-muted)]">Train: <span className="text-[var(--color-text)] font-medium">{store.trainNumber}</span></div>
                <div className="text-sm text-[var(--color-text-muted)]">Coach: <span className="text-[var(--color-text)] font-medium">{store.coachLabel}</span></div>
                <div className="text-sm text-[var(--color-text-muted)]">Seats: <span className="text-[var(--color-text)] font-medium">{store.seatNumbers.sort((a, b) => a - b).join(', ') || 'Auto-allocated'}</span></div>
                <div className="text-sm text-[var(--color-text-muted)]">Passengers: <span className="text-[var(--color-text)] font-medium">{store.passengers.length}</span></div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--color-text-muted)]">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  {PAYMENT_METHODS.map((pm) => (
                    <button
                      key={pm.value}
                      onClick={() => store.setPaymentMethod(pm.value)}
                      className={`p-3 rounded-lg text-sm text-left transition-colors cursor-pointer ${store.paymentMethod === pm.value ? 'bg-[var(--color-primary)]/20 border border-[var(--color-primary)]' : 'glass border border-[var(--color-border)]'}`}
                    >
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => navigate('/queue')}>Re-queue</Button>
              <Button onClick={goToPayment} disabled={!store.paymentMethod}>Proceed to Payment</Button>
            </div>
          </Card>
          </TiltCard>
        </motion.div>
      )}

      {/* Step 4: Confirm */}
      {store.bookingStep === 4 && (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <TiltCard>
          <Card className="space-y-6 text-center" style={{ transformStyle: 'preserve-3d' }}>
            <div className="w-16 h-16 mx-auto rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <CreditCard className="text-[var(--color-primary)]" size={28} />
            </div>
            <h2 className="text-lg font-semibold">Confirm & Pay</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Click confirm to complete your booking via {store.paymentMethod}</p>
            <Button onClick={confirmBooking} loading={loading} size="lg" className="animate-pulse-glow">
              Confirm Booking
            </Button>
          </Card>
          </TiltCard>
        </motion.div>
      )}
    </div>
  );
}
