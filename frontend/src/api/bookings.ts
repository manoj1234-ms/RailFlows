import client from './client';
import type { ApiResponse, Booking, WaitlistEntry } from '@/types';

export const bookingsApi = {
  lockSeats: (data: { trainNumber: string; coachLabel: string; seatNumbers: number[] }) =>
    client.post<ApiResponse<{ lockExpiresInSeconds: number; lockedSeats: number[] }>>('/bookings/lock', data),

  allocateSeats: (data: { trainNumber: string; coachLabel: string; passengerCount: number }) =>
    client.post<ApiResponse<{ lockExpiresInSeconds: number; lockedSeats: number[] }>>('/bookings/allocate', data),

  confirm: (data: {
    trainNumber: string;
    coachLabel: string;
    seatNumbers: number[];
    passengers: { name: string; age: number; gender: string; aadhaar: string }[];
    paymentMethod: string;
    paymentDetails?: {
      upiId?: string;
      cardNumber?: string;
      cardExpiry?: string;
      cardCvv?: string;
      cardholderName?: string;
      bankName?: string;
    };
    idempotencyKey: string;
  }) => client.post<ApiResponse<{ bookingId: number; pnr: string; qrCode: string; razorpayOrderId?: string; totalPrice?: number }>>('/bookings/confirm', data),

  getByPnr: (pnr: string) =>
    client.get<ApiResponse<Booking>>(`/bookings/pnr/${pnr}`),

  getTicket: (pnr: string) =>
    client.get<ApiResponse<Booking>>(`/bookings/ticket/${pnr}`),

  getHistory: (params?: { page?: number; limit?: number }) =>
    client.get<ApiResponse<{ upcoming: Booking[]; completed: Booking[]; cancelled: Booking[]; all: Booking[] }>>('/bookings/history', { params }),

  downloadTicket: (pnr: string) =>
    client.get(`/bookings/ticket/${pnr}/download`, { responseType: 'blob' }),

  cancelPartial: (pnr: string, data: { passengerIndices: number[] }) =>
    client.post<ApiResponse<{ pnr: string; refundAmount: number; remainingPassengers: number }>>(`/bookings/cancel/${pnr}/partial`, data),

  cancel: (pnr: string) =>
    client.post<ApiResponse<{ pnr: string; status: string }>>(`/bookings/cancel/${pnr}`),

  waitlist: (data: { trainNumber: string; fromStation: string; toStation: string; coachClass: string; passengers?: number }) =>
    client.post<ApiResponse<{ pnr: string; waitlistNumber: number; status: string }>>('/bookings/waitlist', data),

  getWaitlistStatus: (pnr: string) =>
    client.get<ApiResponse<WaitlistEntry>>(`/bookings/waitlist/status/${pnr}`),

  getMyWaitlist: () =>
    client.get<ApiResponse<WaitlistEntry[]>>('/bookings/waitlist/my'),
};
