import client from './client';
import type { ApiResponse, User } from '@/types';

export const authApi = {
  register: (data: { email?: string; password: string; phone?: string; aadhaar?: string; role?: string }) =>
    client.post<ApiResponse<{ userId: number; email?: string; phone?: string; role: string; aadhaar?: string }>>('/auth/register', data),

  sendAadhaarOtp: (data: { aadhaar: string; phone: string }) =>
    client.post<ApiResponse<{ message: string }>>('/auth/aadhaar/send-otp', data),

  verifyAadhaarOtp: (data: { aadhaar: string; code: string }) =>
    client.post<ApiResponse<{ message: string }>>('/auth/aadhaar/verify-otp', data),

  registerPhone: (data: { phone: string; password: string }) =>
    client.post<ApiResponse<{ userId: number; phone: string }>>('/auth/register/phone', data),

  sendOtp: (data: { phone: string }) =>
    client.post<ApiResponse<{ message: string }>>('/auth/send-otp', data),

  verifyOtp: (data: { phone: string; code: string }) =>
    client.post<ApiResponse<{ accessToken: string; role: string; userId: number }>>('/auth/verify-otp', data),

  verifyEmail: (data: { token: string }) =>
    client.post<ApiResponse<null>>('/auth/verify-email', data),

  login: (data: { email: string; password: string }) =>
    client.post<ApiResponse<{ accessToken: string; role: string }> | { status: 'mfa_required'; mfaToken: string }>('/auth/login', data),

  loginPhone: (data: { phone: string; password: string }) =>
    client.post<ApiResponse<{ accessToken: string; role: string }>>('/auth/login/phone', data),

  socialLogin: (data: { provider: 'google' | 'apple'; token: string; email?: string; name?: string }) =>
    client.post<ApiResponse<{ accessToken: string; role: string }>>('/auth/social', data),

  mfaVerify: (data: { email: string; code: string }) =>
    client.post<ApiResponse<{ accessToken: string; role: string }>>('/auth/mfa/verify', data),

  mfaSetup: () =>
    client.post<ApiResponse<{ secret: string; otpauthUrl: string; qrCode: string }>>('/auth/mfa/setup'),

  mfaConfirm: (data: { code: string }) =>
    client.post<ApiResponse<null>>('/auth/mfa/confirm', data),

  logout: () =>
    client.post<ApiResponse<null>>('/auth/logout'),

  refresh: () =>
    client.post<{ accessToken: string }>('/auth/refresh'),

  getProfile: () =>
    client.get<ApiResponse<User>>('/users/profile'),

  getPassengers: () =>
    client.get<ApiResponse<{ id: number; name: string; maskedAadhaar: string }[]>>('/users/passengers'),

  addPassenger: (data: { name: string; aadhaar: string }) =>
    client.post<ApiResponse<{ id: number; name: string; maskedAadhaar: string }>>('/users/passengers', data),

  terminateSession: () =>
    client.post<ApiResponse<null>>('/users/sessions/terminate'),
};
