import { create } from 'zustand';

type BerthVal = 'LB' | 'MB' | 'UB' | 'SL' | 'SU';

export interface PaymentDetails {
  upiId?: string;
  paymentToken?: string;
  cardholderName?: string;
  bankName?: string;
}

interface BookingState {
  trainNumber: string | null;
  coachLabel: string | null;
  seatNumbers: number[];
  passengerCount: number;
  berthPrefs: BerthVal[];
  passengers: { name: string; age: number; gender: 'M' | 'F' | 'O'; aadhaar: string }[];
  aadhaarConsentGiven: boolean;
  paymentMethod: string | null;
  paymentDetails: PaymentDetails;
  idempotencyKey: string | null;
  bookingStep: 1 | 2 | 3 | 4;
  setStep: (step: 1 | 2 | 3 | 4) => void;
  setTrain: (trainNumber: string) => void;
  setCoach: (coachLabel: string) => void;
  setSeats: (seatNumbers: number[]) => void;
  setPassengerCount: (count: number) => void;
  setBerthPrefs: (prefs: BerthVal[]) => void;
  setPassengers: (passengers: BookingState['passengers']) => void;
  setAadhaarConsentGiven: (given: boolean) => void;
  setPaymentMethod: (method: string) => void;
  setPaymentDetails: (details: PaymentDetails) => void;
  setIdempotencyKey: (key: string) => void;
  reset: () => void;
}

const initialState = {
  trainNumber: null,
  coachLabel: null,
  seatNumbers: [],
  passengerCount: 1,
  berthPrefs: [],
  passengers: [],
  aadhaarConsentGiven: false,
  paymentMethod: null,
  paymentDetails: {} as PaymentDetails,
  idempotencyKey: null,
  bookingStep: 1 as const,
};

export const useBookingStore = create<BookingState>((set) => ({
  ...initialState,
  setStep: (step) => set({ bookingStep: step }),
  setTrain: (trainNumber) => set({ trainNumber }),
  setCoach: (coachLabel) => set({ coachLabel }),
  setSeats: (seatNumbers) => set({ seatNumbers }),
  setPassengerCount: (count) => set({ passengerCount: count }),
  setBerthPrefs: (prefs) => set({ berthPrefs: prefs }),
  setPassengers: (passengers) => set({ passengers }),
  setAadhaarConsentGiven: (aadhaarConsentGiven) => set({ aadhaarConsentGiven }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setPaymentDetails: (paymentDetails) => set({ paymentDetails }),
  setIdempotencyKey: (idempotencyKey) => set({ idempotencyKey }),
  reset: () => set(initialState),
}));
