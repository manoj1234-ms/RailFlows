import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/api/admin';

const statusColor: Record<string, 'success' | 'warning' | 'danger'> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
};

export default function ServiceMonitoring() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-service-health'],
    queryFn: () => adminApi.getServiceHealth(),
  });

  const health = res?.data.data;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Service Monitoring</h1>

      {isLoading ? <Skeleton className="h-24" count={6} /> : (
        <>
          {health?.host && (
            <Card>
              <h2 className="font-semibold mb-4">Host Metrics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-[var(--color-text-muted)]">Platform: </span>{health.host.platform}</div>
                <div><span className="text-[var(--color-text-muted)]">Arch: </span>{health.host.arch}</div>
                <div><span className="text-[var(--color-text-muted)]">CPU Cores: </span>{health.host.cpuCount}</div>
                <div><span className="text-[var(--color-text-muted)]">RSS: </span>{health.host.processMemory.rss}</div>
              </div>
            </Card>
          )}

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {health?.microservices?.map((svc: any, i: number) => (
              <motion.div key={svc.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{svc.name}</h3>
                    <Badge variant={statusColor[svc.status] || 'default'}>{svc.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-[var(--color-text-muted)]">Uptime: </span>{svc.uptime}</div>
                    <div><span className="text-[var(--color-text-muted)]">Latency: </span>{svc.latencyMs}ms</div>
                    <div><span className="text-[var(--color-text-muted)]">CPU: </span>{svc.cpuUsage}</div>
                    <div><span className="text-[var(--color-text-muted)]">Memory: </span>{svc.memoryBytes}</div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
