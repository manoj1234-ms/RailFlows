import client from './client';
import type { ApiResponse } from '@/types';

export const stationsApi = {
  autocomplete: (params: { q: string; limit?: number }) =>
    client.get<ApiResponse<{ code: string; name: string; city: string; state: string }[]>>('/stations/autocomplete', { params }),

  getNearby: (params: { lat: number; lng: number; radius?: number }) =>
    client.get<ApiResponse<any[]>>('/stations/nearby', { params }),

  getByCode: (code: string) =>
    client.get<ApiResponse<any>>(`/stations/${code}`),

  list: (params?: { limit?: number; offset?: number }) =>
    client.get<ApiResponse<any[]>>('/stations', { params }),
};
