import client from './client';
import type { ApiResponse, Train, TrainDetail, Seat } from '@/types';

export const trainsApi = {
  search: (params: { from: string; to: string; date: string }) =>
    client.get<ApiResponse<Train[]>>('/trains/search', { params }),

  searchRange: (params: { from: string; to: string; startDate: string; endDate: string }) =>
    client.get<ApiResponse<any[]>>('/trains/search/range', { params }),

  getDetails: (id: string) =>
    client.get<ApiResponse<TrainDetail>>(`/trains/${id}`),

  getCoach: (id: string, coachClass: string) =>
    client.get<ApiResponse<{ trainNumber: string; coachClass: string; seats: Seat[] }>>(`/trains/${id}/coach`, {
      params: { class: coachClass },
    }),

  fareCalendar: (params: { from: string; to: string }) =>
    client.get<ApiResponse<any[]>>('/trains/fare/calendar', { params }),
};
