import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Star, TrendingUp, Gift } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { loyaltyApi } from '@/api/loyalty';
import { formatDate } from '@/utils/format';

const tierColors: Record<string, string> = {
  Silver: 'from-gray-400 to-gray-300',
  Gold: 'from-yellow-500 to-amber-400',
  Platinum: 'from-purple-500 to-pink-400',
};

export default function LoyaltyPage() {
  const { data: pointsRes, isLoading: loadingPoints } = useQuery({
    queryKey: ['loyalty-points'],
    queryFn: () => loyaltyApi.getPoints(),
  });

  const { data: historyRes, isLoading: loadingHistory } = useQuery({
    queryKey: ['loyalty-history'],
    queryFn: () => loyaltyApi.getHistory({ page: 1, limit: 20 }),
  });

  const { data: predictRes } = useQuery({
    queryKey: ['loyalty-predict'],
    queryFn: () => loyaltyApi.predict(),
  });

  const { data: rewardsRes } = useQuery({
    queryKey: ['loyalty-rewards'],
    queryFn: () => loyaltyApi.getRewards(),
  });

  const account = pointsRes?.data.data;
  const transactions = historyRes?.data.data || [];
  const prediction = predictRes?.data.data;
  const rewards = rewardsRes?.data.data || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Loyalty Program</h1>

      {loadingPoints ? <Skeleton className="h-40" /> : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className={`bg-gradient-to-br ${tierColors[account?.tier || 'Silver']} text-white border-0`}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star size={20} />
                  <span className="text-sm opacity-80">{account?.tier} Member</span>
                </div>
                <Badge variant="info">{account?.tier}</Badge>
              </div>
              <div className="text-4xl font-bold">{account?.points || 0}</div>
              <div className="text-sm opacity-80">Loyalty Points</div>
              <div className="flex gap-4 text-sm opacity-80">
                <span>Earned: {account?.totalEarned || 0}</span>
                <span>Redeemed: {account?.totalRedeemed || 0}</span>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* ML Prediction */}
      {prediction && (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-[var(--color-primary)]" size={18} />
            <h2 className="font-semibold">Points Prediction (30 days)</h2>
          </div>
          <div className="text-2xl font-bold text-[var(--color-primary)]">{prediction.predictedPoints || 'N/A'} points</div>
          <p className="text-sm text-[var(--color-text-muted)]">Expected earnings based on your booking patterns</p>
        </Card>
      )}

      {/* Rewards */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Gift className="text-[var(--color-warning)]" size={18} />
          <h2 className="font-semibold">Available Rewards</h2>
        </div>
        {rewards.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No rewards available</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {rewards.map((r: any, i: number) => (
              <div key={i} className="glass rounded-lg p-4 space-y-2">
                <div className="font-medium">{r.name}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{r.description}</div>
                <div className="flex items-center justify-between">
                  <Badge variant="info">{r.pointsRequired} points</Badge>
                  <Button size="sm" variant="primary">Redeem</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* History */}
      <Card>
        <h2 className="font-semibold mb-4">Points History</h2>
        {loadingHistory ? <Skeleton className="h-12" count={3} /> : transactions.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                <div>
                  <div className="text-sm">{tx.description}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{formatDate(tx.createdAt)}</div>
                </div>
                <div className={`text-sm font-semibold ${tx.type === 'EARNED' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {tx.type === 'EARNED' ? '+' : '-'}{tx.points} pts
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
