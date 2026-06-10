import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bell, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { notificationsApi } from '@/api/notifications';
import { formatDate } from '@/utils/format';

const typeIcon: Record<string, any> = {
  EMAIL: Mail,
  SMS: MessageSquare,
  PUSH: Smartphone,
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getHistory({ limit: 50 }),
  });

  const { data: prefsRes } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationsApi.getPreferences(),
  });

  const prefs = prefsRes?.data.data;

  const togglePref = useMutation({
    mutationFn: (data: any) => notificationsApi.updatePreferences(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      toast.success('Preferences updated');
    },
  });

  const notifications = res?.data.data || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Notifications</h1>

      {isLoading ? <Skeleton className="h-24" count={5} /> : (
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">
              <Bell size={48} className="mx-auto opacity-30 mb-3" />
              <p>No notifications yet</p>
            </div>
          ) : (
            notifications.map((n: any, i: number) => {
              const Icon = typeIcon[n.type] || Bell;
              return (
                <motion.div key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <Card className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/20 flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-[var(--color-primary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{n.subject}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{formatDate(n.createdAt)}</span>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">{n.body}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={n.status === 'SENT' ? 'success' : 'warning'}>{n.status}</Badge>
                        <span className="text-xs text-[var(--color-text-muted)]">{n.type} · {n.channel}</span>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      )}

      {/* Preferences */}
      <Card>
        <h2 className="font-semibold mb-4">Notification Preferences</h2>
        <div className="space-y-3">
          {[
            { key: 'emailEnabled', label: 'Email Notifications' },
            { key: 'smsEnabled', label: 'SMS Notifications' },
            { key: 'pushEnabled', label: 'Push Notifications' },
            { key: 'bookingUpdates', label: 'Booking Updates' },
            { key: 'paymentUpdates', label: 'Payment Updates' },
            { key: 'promotional', label: 'Promotional Offers' },
          ].map((p) => {
            const checked = prefs?.[p.key as keyof typeof prefs];
            return (
              <div key={p.key} className="flex items-center justify-between">
                <span className="text-sm">{p.label}</span>
                <button
                  onClick={() => togglePref.mutate({ [p.key]: !checked })}
                  className={`w-12 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
