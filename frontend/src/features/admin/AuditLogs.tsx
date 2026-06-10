import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { adminApi } from '@/api/admin';
import { formatDate } from '@/utils/format';

export default function AuditLogs() {
  const [page, setPage] = useState(1);

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', page],
    queryFn: () => adminApi.getAuditLogs({ page, limit: 20 }),
  });

  const logs = res?.data.data || [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Audit Logs</h1>

      {isLoading ? <Skeleton className="h-12" count={10} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Timestamp</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Actor</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Action</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">IP</th>
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-3 text-xs">{log.timestamp ? formatDate(log.timestamp) : ''}</td>
                  <td className="py-3">{log.actor}</td>
                  <td className="py-3"><Badge variant="info">{log.action}</Badge></td>
                  <td className="py-3 text-xs">{log.ip}</td>
                  <td className="py-3 text-xs max-w-xs truncate">{log.payload || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {res?.data.pagination && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-[var(--color-text-muted)]">Page {page} of {res.data.pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= (res.data.pagination.totalPages || 1)} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
