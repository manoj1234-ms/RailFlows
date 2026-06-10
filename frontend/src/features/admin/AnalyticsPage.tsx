import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/api/admin';
import { formatCurrency } from '@/utils/format';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6C63FF', '#00D4FF', '#00E676', '#FFC107', '#FF5252', '#FF80AB'];

export default function AnalyticsPage() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  const analytics = res?.data.data;

  if (isLoading) return <div className="max-w-6xl mx-auto px-4 py-8"><Skeleton className="h-64" count={2} /></div>;

  const routeData = (analytics?.routeDemand || []).slice(0, 10).map((r: any) => ({
    name: r.route.length > 15 ? r.route.slice(0, 15) + '...' : r.route,
    bookings: r.bookingCount,
    revenue: r.routeRevenue,
  }));

  const peakData = (analytics?.peakHours || []).map((p: any) => ({
    name: p.hour.split('(')[0].trim(),
    value: p.bookings,
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Analytics</h1>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Route Demand */}
        <Card>
          <h2 className="font-semibold mb-4">Route Demand (Top 10)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={routeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                labelStyle={{ color: 'var(--color-text)' }}
              />
              <Bar dataKey="bookings" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Peak Hours */}
        <Card>
          <h2 className="font-semibold mb-4">Peak Hours Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={peakData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {peakData.map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Route Revenue Table */}
      <Card>
        <h2 className="font-semibold mb-4">Revenue by Route</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 text-[var(--color-text-muted)] font-medium">Route</th>
                <th className="text-right py-3 text-[var(--color-text-muted)] font-medium">Bookings</th>
                <th className="text-right py-3 text-[var(--color-text-muted)] font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(analytics?.routeDemand || []).map((r: any, i: number) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-3">{r.route}</td>
                  <td className="py-3 text-right">{r.bookingCount}</td>
                  <td className="py-3 text-right font-medium">{formatCurrency(r.routeRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
