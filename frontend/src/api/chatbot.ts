import client from './client';
import type { ApiResponse } from '@/types';

export const chatbotApi = {
  ask: (message: string) =>
    client.post<ApiResponse<{ reply: string }>>('/chatbot/ask', { message }),

  askAuthenticated: (message: string) =>
    client.post<ApiResponse<{ reply: string }>>('/chatbot/ask/authenticated', { message }),

  train: (data: { intent: string; pattern: string; response: string; contextRequired?: boolean }) =>
    client.post<ApiResponse<null>>('/chatbot/train', data),
};
