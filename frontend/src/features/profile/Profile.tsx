import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { User, Mail, Shield, Smartphone, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { formatDate } from '@/utils/format';

export default function Profile() {
  const { user } = useAuthStore();

  const { data: passengersRes, isLoading: loadingPassengers } = useQuery({
    queryKey: ['passengers'],
    queryFn: () => authApi.getPassengers(),
  });

  const terminateSession = useMutation({
    mutationFn: () => authApi.terminateSession(),
    onSuccess: () => toast.success('Session terminated'),
  });

  const passengers = passengersRes?.data.data || [];

  const roleColors: Record<string, string> = {
    Admin: 'warning',
    'Super Admin': 'danger',
    Passenger: 'info',
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Profile</h1>

      {/* Profile Card */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center">
              <User size={32} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{user?.email || 'User'}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={(roleColors[user?.role || ''] || 'default') as any}>{user?.role}</Badge>
                <span className="text-xs text-[var(--color-text-muted)]">Joined {user?.createdAt ? formatDate(user.createdAt) : 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="glass rounded-lg p-4 flex items-center gap-3">
              <Mail size={18} className="text-[var(--color-text-muted)]" />
              <div>
                <div className="text-xs text-[var(--color-text-muted)]">Email</div>
                <div className="text-sm">{user?.email}</div>
              </div>
            </div>
            <div className="glass rounded-lg p-4 flex items-center gap-3">
              <Shield size={18} className="text-[var(--color-text-muted)]" />
              <div>
                <div className="text-xs text-[var(--color-text-muted)]">MFA</div>
                <div className="text-sm">{user?.mfaEnabled ? 'Enabled' : 'Disabled'}</div>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Saved Passengers */}
      <Card>
        <h2 className="font-semibold mb-4">Saved Passengers</h2>
        {loadingPassengers ? <Skeleton className="h-16" count={2} /> : passengers.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No saved passengers</p>
        ) : (
          <div className="space-y-3">
            {passengers.map((p: any) => (
              <div key={p.id} className="glass rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{p.maskedAadhaar}</div>
                </div>
                <Button variant="ghost" size="sm"><Trash2 size={14} className="text-[var(--color-danger)]" /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Active Sessions */}
      <Card>
        <h2 className="font-semibold mb-4">Active Sessions</h2>
        <div className="space-y-3">
          {(user?.activeSessions || []).map((s: any) => (
            <div key={s.sessionId} className="glass rounded-lg p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Smartphone size={14} className="text-[var(--color-text-muted)]" />
                  <span className="text-sm font-medium">{s.isCurrent ? 'Current Session' : 'Other Device'}</span>
                  {s.isCurrent && <Badge variant="info">Active</Badge>}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">{s.ipAddress} · {s.userAgent.slice(0, 50)}...</div>
              </div>
              {!s.isCurrent && (
                <Button variant="ghost" size="sm" onClick={() => terminateSession.mutate()}>
                  <LogOut size={14} className="text-[var(--color-danger)]" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
