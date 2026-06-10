import client from './client';
import type { ApiResponse, QueueInfo } from '@/types';

export const queueApi = {
  join: (deviceFingerprint: string) =>
    client.post<ApiResponse<QueueInfo>>('/queue/join', { deviceFingerprint }),

  getStatus: (params: { token: string; deviceFingerprint: string }) =>
    client.get<ApiResponse<QueueInfo>>('/queue/status', { params }),
};
