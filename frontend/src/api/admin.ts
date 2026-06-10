import client from './client';
import type { ApiResponse, AdminAnalytics, ServiceHealth, AuditLog } from '@/types';

export const adminApi = {
  getAnalytics: () =>
    client.get<ApiResponse<AdminAnalytics>>('/admin/analytics'),

  getQueueMetrics: () =>
    client.get<ApiResponse<any>>('/admin/queue-metrics'),

  getServiceHealth: () =>
    client.get<ApiResponse<ServiceHealth>>('/admin/service-health'),

  getAuditLogs: (params?: { page?: number; limit?: number }) =>
    client.get<ApiResponse<AuditLog[]>>('/admin/audit-logs', { params }),

  getRefundAnalytics: () =>
    client.get<ApiResponse<any>>('/admin/refunds/analytics'),

  getRefundList: (params?: { page?: number; limit?: number }) =>
    client.get<ApiResponse<any[]>>('/admin/refunds/list', { params }),

  reviewRefund: (refundId: number, action: 'APPROVE' | 'REJECT') =>
    client.post<ApiResponse<any>>(`/admin/refunds/review/${refundId}`, { action }),

  retryRefund: (refundId: number) =>
    client.post<ApiResponse<any>>(`/admin/refunds/retry-gateway/${refundId}`),
};
