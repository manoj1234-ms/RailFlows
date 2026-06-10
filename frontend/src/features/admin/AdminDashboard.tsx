import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart3, Activity, Shield, Users, ArrowRight, TrendingUp, DollarSign, Ticket, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/api/admin';
import { formatCurrency } from '@/utils/format';

const modules = [
  { icon: BarChart3, label: 'Analytics', to: '/admin/analytics', color: 'from-blue-500 to-cyan-500' },
  { icon: Activity, label: 'Queue Monitor', to: '/admin/queue', color: 'from-green-500 to-emerald-500' },
  { icon: Shield, label: 'Services', to: '/admin/services', color: 'from-purple-500 to-pink-500' },
  { icon: Shield, label: 'Refunds', to: '/admin/refunds', color: 'from-orange-500 to-red-500' },
  { icon: Users, label: 'Users', to: '/admin/users', color: 'from-indigo-500 to-purple-500' },
  { icon: Activity, label: 'Audit Logs', to: '/admin/audit-logs', color: 'from-gray-500 to-slate-500' },
];

export default function AdminDashboard() {
  const { data: analyticsRes, isLoading } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminApi.getAnalytics(),
  });

  const analytics = analyticsRes?.data.data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <span className="text-sm glass px-3 py-1 rounded-lg">Super Admin</span>
      </div>

      {isLoading ? <Skeleton className="h-24" count={4} /> : analytics && (
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <div className="flex items-center gap-3">
              <Ticket className="text-[var(--color-primary)]" size={24} />
              <div>
                <div className="text-2xl font-bold">{analytics.totalBookings}</div>
                <div className="text-sm text-[var(--color-text-muted)]">Total Bookings</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <DollarSign className="text-[var(--color-success)]" size={24} />
              <div>
                <div className="text-2xl font-bold">{formatCurrency(analytics.totalRevenue)}</div>
                <div className="text-sm text-[var(--color-text-muted)]">Total Revenue</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <TrendingUp className="text-[var(--color-warning)]" size={24} />
              <div>
                <div className="text-2xl font-bold">{analytics.routeDemand?.length || 0}</div>
                <div className="text-sm text-[var(--color-text-muted)]">Active Routes</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <Clock className="text-[var(--color-secondary)]" size={24} />
              <div>
                <div className="text-2xl font-bold">{analytics.peakHours?.length || 0}</div>
                <div className="text-sm text-[var(--color-text-muted)]">Peak Hours Tracked</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">Management Modules</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {modules.map((m) => (
            <Link key={m.to} to={m.to}>
              <Card hover className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${m.color} flex items-center justify-center`}>
                  <m.icon className="text-white" size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{m.label}</div>
                </div>
                <ArrowRight size={16} className="text-[var(--color-text-muted)]" />
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Peak Hours */}
      {analytics?.peakHours && (
        <Card>
          <h2 className="font-semibold mb-4">Peak Hours Distribution</h2>
          <div className="space-y-3">
            {analytics.peakHours.map((p: any) => (
              <div key={p.hour} className="flex items-center gap-4">
                <div className="text-sm w-48">{p.hour}</div>
                <div className="flex-1 h-4 glass rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] rounded-full"
                    style={{ width: `${(p.bookings / analytics.totalBookings) * 100}%` }}
                  />
                </div>
                <div className="text-sm w-16 text-right">{p.bookings}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
