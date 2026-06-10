import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Sparkles, Train } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { scheduleApi } from '@/api/schedule';
import { loyaltyApi } from '@/api/loyalty';
import { formatCurrency, formatTime } from '@/utils/format';

export default function Recommendations() {
  const { data: vikalpRes, isLoading } = useQuery({
    queryKey: ['vikalp', 'NDLS', 'BCT'],
    queryFn: () => scheduleApi.vikalp({ from: 'NDLS', to: 'BCT' }),
  });

  const { data: loyaltyRecsRes } = useQuery({
    queryKey: ['loyalty-recommendations'],
    queryFn: () => loyaltyApi.getRecommendations(),
  });

  const alternates = vikalpRes?.data.data || [];
  const recs = loyaltyRecsRes?.data.data || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
          <Sparkles className="text-white" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Recommendations</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Personalized suggestions for your travel</p>
        </div>
      </div>

      {/* Vikalp Alternates */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Train className="text-[var(--color-primary)]" size={18} />
          <h2 className="font-semibold">Alternate Trains (Vikalp)</h2>
        </div>
        {isLoading ? <Skeleton className="h-16" count={3} /> : alternates.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">No alternate trains found</p>
        ) : (
          <div className="space-y-3">
            {alternates.map((alt: any, i: number) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div className="glass rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{alt.trainName} ({alt.trainNumber})</div>
                    <div className="text-sm text-[var(--color-text-muted)]">{formatTime(alt.departureTime)} - {formatTime(alt.arrivalTime)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-[var(--color-primary)]">{formatCurrency(alt.estimatedFare)}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{alt.travelDistance} km</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      {/* Loyalty Recommendations */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="text-[var(--color-warning)]" size={18} />
          <h2 className="font-semibold">Personalized For You</h2>
        </div>
        {recs.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">Check back later for personalized recommendations</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {recs.map((r: any, i: number) => (
              <div key={i} className="glass rounded-lg p-4 space-y-2">
                <Badge variant="info">{r.type}</Badge>
                <div className="font-medium">{r.title}</div>
                <div className="text-sm text-[var(--color-text-muted)]">{r.description}</div>
                <Button size="sm" variant="primary">View Details</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
