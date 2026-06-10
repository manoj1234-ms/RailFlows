import client from './client';
import type { ApiResponse, LoyaltyAccount, LoyaltyTransaction } from '@/types';

export const loyaltyApi = {
  getPoints: () =>
    client.get<ApiResponse<LoyaltyAccount>>('/loyalty/points'),

  getHistory: (params?: { page?: number; limit?: number }) =>
    client.get<ApiResponse<LoyaltyTransaction[]>>('/loyalty/history', { params }),

  redeem: (points: number) =>
    client.post<ApiResponse<any>>('/loyalty/redeem', { points }),

  predict: () =>
    client.get<ApiResponse<any>>('/loyalty/predict'),

  getRecommendations: () =>
    client.get<ApiResponse<any[]>>('/loyalty/recommendations'),

  getRewards: () =>
    client.get<ApiResponse<any[]>>('/loyalty/rewards'),
};
