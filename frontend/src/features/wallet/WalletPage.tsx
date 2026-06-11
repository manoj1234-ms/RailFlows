import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Wallet, Plus, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { paymentsApi } from '@/api/payments';
import { formatCurrency, formatDate } from '@/utils/format';

export default function WalletPage() {
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => paymentsApi.getWallet(),
  });

  const wallet = res?.data.data;

  const topupMutation = useMutation({
    mutationFn: (amount: number) => paymentsApi.walletTopup(amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast.success('Wallet topped up!');
      setShowTopup(false);
      setTopupAmount('');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Top-up failed'),
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">Wallet</h1>

      {isLoading ? <Skeleton className="h-40" /> : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-gradient-to-br from-[var(--color-primary)] to-purple-700 text-white border-0">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wallet size={20} />
                <span className="text-sm opacity-80">Wallet Balance</span>
              </div>
              <div className="text-4xl font-bold">{formatCurrency(wallet?.balance || 0)}</div>
              <Button onClick={() => setShowTopup(true)} className="bg-white/20 text-white hover:bg-white/30 border-0">
                <Plus size={16} /> Add Money
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      <Card>
        <h2 className="font-semibold mb-4">Recent Transactions</h2>
        {isLoading ? (
          <Skeleton className="h-16" count={3} />
        ) : wallet?.transactions?.length === 0 ? (
          <p className="text-center text-[var(--color-text-muted)] py-8">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {wallet?.transactions?.map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.type === 'CREDIT' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    {tx.type === 'CREDIT' ? <ArrowDownRight size={14} className="text-[var(--color-success)]" /> : <ArrowUpRight size={14} className="text-[var(--color-danger)]" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{tx.description}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{formatDate(tx.created_at)}</div>
                  </div>
                </div>
                <div className={`text-sm font-semibold ${tx.type === 'CREDIT' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showTopup} onClose={() => setShowTopup(false)} title="Add Money">
        <div className="space-y-4">
          <Input type="number" label="Amount (₹)" placeholder="Enter amount" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} />
          <div className="flex gap-2">
            {[100, 500, 1000, 5000].map((amt) => (
              <button key={amt} onClick={() => setTopupAmount(String(amt))} className="px-3 py-1 text-sm rounded-lg bg-[var(--color-border)] hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer">
                ₹{amt}
              </button>
            ))}
          </div>
          <Button onClick={() => topupMutation.mutate(Number(topupAmount))} loading={topupMutation.isPending} disabled={!topupAmount || Number(topupAmount) <= 0} className="w-full">
            Add Money
          </Button>
        </div>
      </Modal>
    </div>
  );
}
