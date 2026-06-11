import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/api/admin';

const AnalyticsCharts = lazy(() => import('./AnalyticsCharts'));

export default function AnalyticsPage() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  if (isLoading) return <div className="max-w-6xl mx-auto px-4 py-8"><Skeleton className="h-64" count={2} /></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <Suspense fallback={<div className="space-y-8"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>}>
        <AnalyticsCharts analytics={res?.data.data} />
      </Suspense>
    </div>
  );
}