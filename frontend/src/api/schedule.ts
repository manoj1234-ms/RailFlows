import client from './client';
import type { ApiResponse } from '@/types';

export const scheduleApi = {
  getSchedule: (number: string) =>
    client.get<ApiResponse<any>>(`/schedule/${number}`),

  getLiveStatus: (number: string) =>
    client.get<ApiResponse<any>>(`/schedule/${number}/live`),

  getAllRunning: () =>
    client.get<ApiResponse<any[]>>('/schedule/live/all'),

  fareEnquiry: (params: { from: string; to: string }) =>
    client.get<ApiResponse<any[]>>('/schedule/fare/enquiry', { params }),

  betweenStations: (params: { from: string; to: string }) =>
    client.get<ApiResponse<any[]>>('/schedule/between/stations', { params }),

  vikalp: (params: { from: string; to: string; prefer?: string }) =>
    client.get<ApiResponse<any[]>>('/schedule/vikalp/alternates', { params }),
};
