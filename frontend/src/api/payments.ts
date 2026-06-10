import client from './client';
import type { ApiResponse, PaymentMethod, Payment, Wallet } from '@/types';

export const paymentsApi = {
  getMethods: () =>
    client.get<ApiResponse<{ methods: PaymentMethod[]; pciCompliance: string }>>('/payments/methods'),

  initiate: (data: { bookingId: number; amount: number; paymentMethod: string; idempotencyKey?: string }) =>
    client.post<ApiResponse<{ paymentId: number; transactionId: string }>>('/payments/initiate', data),

  verify: (data: { transactionId: string }) =>
    client.post<ApiResponse<{ paymentId: number; transactionId: string }>>('/payments/verify', data),

  refund: (data: { transactionId: string; amount?: number }) =>
    client.post<ApiResponse<null>>('/payments/refund', data),

  getStatus: (transactionId: string) =>
    client.get<ApiResponse<Payment>>(`/payments/status/${transactionId}`),

  getHistory: () =>
    client.get<ApiResponse<Payment[]>>('/payments/history'),

  walletTopup: (amount: number) =>
    client.post<ApiResponse<{ balance: number }>>('/payments/wallet/topup', { amount }),

  getWallet: () =>
    client.get<ApiResponse<Wallet>>('/payments/wallet'),

  applyCoupon: (data: { code: string; cartValue: number }) =>
    client.post<ApiResponse<{ code: string; discountPercent: number; discountAmount: number; originalTotal: number; discountedTotal: number }>>('/payments/coupon/apply', data),
};
