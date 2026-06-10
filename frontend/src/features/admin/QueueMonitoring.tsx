import { useQuery } from '@tanstack/react-query';
import { Activity, Users, Clock, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { adminApi } from '@/api/admin';

export default function QueueMonitoring() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-queue-metrics'],
    queryFn: () => adminApi.getQueueMetrics(),
  });

  const metrics = res?.data.data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Queue Monitoring</h1>

      {isLoading ? <Skeleton className="h-32" count={4} /> : (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            <Card>
              <div className="flex items-center gap-3">
                <Users className="text-[var(--color-primary)]" size={24} />
                <div>
                  <div className="text-2xl font-bold">{metrics?.activeUsers || 0}</div>
                  <div className="text-sm text-[var(--color-text-muted)]">Active Queue</div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <TrendingUp className="text-[var(--color-success)]" size={24} />
                <div>
                  <div className="text-2xl font-bold">{metrics?.throughput || 0}/min</div>
                  <div className="text-sm text-[var(--color-text-muted)]">Throughput</div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <Clock className="text-[var(--color-warning)]" size={24} />
                <div>
                  <div className="text-2xl font-bold">{metrics?.avgWaitTime || 0}s</div>
                  <div className="text-sm text-[var(--color-text-muted)]">Avg Wait Time</div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <Activity className="text-[var(--color-secondary)]" size={24} />
                <div>
                  <Badge variant={metrics?.health === 'HEALTHY' ? 'success' : 'warning'}>{metrics?.health || 'HEALTHY'}</Badge>
                  <div className="text-sm text-[var(--color-text-muted)] mt-1">Queue Health</div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
