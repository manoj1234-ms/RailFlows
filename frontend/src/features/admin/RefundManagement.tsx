import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { adminApi } from '@/api/admin';
import { formatCurrency, formatDate } from '@/utils/format';

export default function RefundManagement() {
  const [page, setPage] = useState(1);

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['admin-refunds', page],
    queryFn: () => adminApi.getRefundList({ page, limit: 20 }),
  });

  const { data: analyticsRes } = useQuery({
    queryKey: ['admin-refund-analytics'],
    queryFn: () => adminApi.getRefundAnalytics(),
  });

  const refunds = listRes?.data.data || [];
  const analytics = analyticsRes?.data.data;

  const handleReview = async (id: number, action: 'APPROVE' | 'REJECT') => {
    try {
      await adminApi.reviewRefund(id, action);
      toast.success(`Refund ${action.toLowerCase()}d`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Action failed');
    }
  };

  const handleRetry = async (id: number) => {
    try {
      await adminApi.retryRefund(id);
      toast.success('Gateway retry initiated');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Retry failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Refund Management</h1>

      {analytics && (
        <div className="grid grid-cols-3 gap-4">
          <Card><div className="text-2xl font-bold">{analytics.totalRefunds || 0}</div><div className="text-sm text-[var(--color-text-muted)]">Total Requests</div></Card>
          <Card><div className="text-2xl font-bold text-[var(--color-success)]">{analytics.approved || 0}</div><div className="text-sm text-[var(--color-text-muted)]">Approved</div></Card>
          <Card><div className="text-2xl font-bold text-[var(--color-danger)]">{analytics.pending || 0}</div><div className="text-sm text-[var(--color-text-muted)]">Pending</div></Card>
        </div>
      )}

      {isLoading ? <Skeleton className="h-20" count={5} /> : (
        <div className="space-y-3">
          {refunds.map((r: any, i: number) => (
            <motion.div key={r.id || i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Booking #{r.bookingId}</span>
                    <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : 'warning'}>{r.status || 'PENDING'}</Badge>
                  </div>
                  <div className="text-sm text-[var(--color-text-muted)]">
                    Amount: {formatCurrency(r.amount || 0)} · {r.reason?.slice(0, 50)}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">{r.createdAt ? formatDate(r.createdAt) : ''}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleReview(r.id, 'APPROVE')}>
                    <Check size={14} className="text-[var(--color-success)]" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleReview(r.id, 'REJECT')}>
                    <X size={14} className="text-[var(--color-danger)]" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleRetry(r.id)}>
                    <RefreshCw size={14} className="text-[var(--color-warning)]" />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {listRes?.data.pagination && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-[var(--color-text-muted)]">Page {page} of {listRes.data.pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= (listRes.data.pagination.totalPages || 1)} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
