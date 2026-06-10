import client from './client';
import type { ApiResponse } from '@/types';

export const platformApi = {
  bookTicket: (data: { stationCode: string; passengerName: string; passengerAge: number }) =>
    client.post<ApiResponse<{ pnr: string }>>('/platform/ticket', data),

  bookUnreserved: (data: { fromStation: string; toStation: string; passengerName: string; passengerAge: number }) =>
    client.post<ApiResponse<{ pnr: string }>>('/platform/unreserved', data),

  getTicket: (pnr: string) =>
    client.get<ApiResponse<any>>(`/platform/ticket/${pnr}`),

  getMyTickets: () =>
    client.get<ApiResponse<any[]>>('/platform/my-tickets'),

  cancelTicket: (pnr: string) =>
    client.post<ApiResponse<null>>(`/platform/cancel/${pnr}`),
};
