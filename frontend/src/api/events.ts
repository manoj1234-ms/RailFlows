import client from './client';
import type { ApiResponse, Event } from '@/types';

export const eventsApi = {
  list: (params?: { category?: string; city?: string; page?: number; limit?: number }) =>
    client.get<ApiResponse<Event[]>>('/events', { params }),

  getById: (id: number) =>
    client.get<ApiResponse<Event>>(`/events/${id}`),

  getSeats: (id: number) =>
    client.get<ApiResponse<any>>(`/events/${id}/seats`),

  lockSeats: (data: { eventId: number; section: string; rowLabel: string; seatNumbers: number[] }) =>
    client.post<ApiResponse<any>>('/events/seats/lock', data),

  book: (data: { eventId: number; section: string; rowLabel: string; seatNumbers: number[]; totalPrice: number }) =>
    client.post<ApiResponse<any>>('/events/book', data),
};
