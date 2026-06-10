import client from './client';
import type { ApiResponse, Notification, NotificationPreferences } from '@/types';

export const notificationsApi = {
  send: (data: { type: string; channel: string; subject?: string; body: string; referenceType?: string; referenceId?: string }) =>
    client.post<ApiResponse<null>>('/notifications/send', data),

  getHistory: (params?: { limit?: number; offset?: number }) =>
    client.get<ApiResponse<Notification[]>>('/notifications/history', { params }),

  getPreferences: () =>
    client.get<ApiResponse<NotificationPreferences>>('/notifications/preferences'),

  updatePreferences: (data: Partial<NotificationPreferences>) =>
    client.put<ApiResponse<null>>('/notifications/preferences', data),
};
