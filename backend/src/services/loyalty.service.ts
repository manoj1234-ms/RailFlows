import { getDb } from '../config/db';
import logger from '../utils/logger';

interface PointsPrediction {
  predictedPointsNext30Days: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  estimatedMonthsToNextTier: number;
}

interface RewardRecommendation {
  rewardId: number;
  name: string;
  description: string;
  pointsRequired: number;
  category: string;
  matchScore: number;
}

const TIER_THRESHOLDS = [
  { tier: 'PLATINUM', minPoints: 20000, multiplier: 2.0 },
  { tier: 'GOLD', minPoints: 5000, multiplier: 1.5 },
  { tier: 'SILVER', minPoints: 1000, multiplier: 1.2 },
  { tier: 'BRONZE', minPoints: 0, multiplier: 1.0 },
];

export class LoyaltyService {

  static getTier(points: number): { tier: string; multiplier: number } {
    for (const t of TIER_THRESHOLDS) {
      if (points >= t.minPoints) return { tier: t.tier, multiplier: t.multiplier };
    }
    return { tier: 'BRONZE', multiplier: 1.0 };
  }

  static async getOrCreateAccount(userId: number): Promise<{ id: number; points: number; lifetimePoints: number; tier: string; multiplier: number }> {
    const db = await getDb();
    let account = await db.get<{ id: number; points: number; lifetime_points: number; tier: string }>(
      'SELECT id, points, lifetime_points, tier FROM loyalty_accounts WHERE user_id = $1',
      [userId]
    );
    if (!account) {
      await db.run(
        'INSERT INTO loyalty_accounts (user_id, points, lifetime_points, tier) VALUES ($1, 0, 0, $2)',
        [userId, 'BRONZE']
      );
      account = await db.get<{ id: number; points: number; lifetime_points: number; tier: string }>(
        'SELECT id, points, lifetime_points, tier FROM loyalty_accounts WHERE user_id = $1',
        [userId]
      );
    }
    const { tier, multiplier } = this.getTier(account!.lifetime_points);
    return { id: account!.id, points: account!.points, lifetimePoints: account!.lifetime_points, tier, multiplier };
  }

  static async earnPoints(userId: number, bookingAmount: number, bookingId?: number): Promise<{ pointsEarned: number; tier: string }> {
    const account = await this.getOrCreateAccount(userId);
    const pointsEarned = Math.floor(bookingAmount * account.multiplier);

    const db = await getDb();
    await db.run('UPDATE loyalty_accounts SET points = points + $1, lifetime_points = lifetime_points + $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [pointsEarned, pointsEarned, userId]
    );

    const newLifetime = account.lifetimePoints + pointsEarned;
    const { tier } = this.getTier(newLifetime);
    await db.run('UPDATE loyalty_accounts SET tier = $1 WHERE user_id = $2', [tier, userId]);

    await db.run(
      `INSERT INTO loyalty_transactions (user_id, points, type, description, reference_type, reference_id)
       VALUES ($1, $2, 'EARNED', $3, $4, $5)`,
      [userId, pointsEarned, `Earned from booking (₹${bookingAmount})`, 'BOOKING', bookingId ? String(bookingId) : null]
    );

    logger.info({ msg: '[Loyalty] Points earned', userId, pointsEarned, tier });
    return { pointsEarned, tier };
  }

  static async redeemPoints(userId: number, pointsToRedeem: number): Promise<{ success: boolean; discount: number; remainingPoints: number }> {
    const account = await this.getOrCreateAccount(userId);
    if (account.points < pointsToRedeem) {
      return { success: false, discount: 0, remainingPoints: account.points };
    }
    const discount = Math.floor(pointsToRedeem * 0.5);
    const db = await getDb();
    await db.run('UPDATE loyalty_accounts SET points = points - $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [pointsToRedeem, userId]
    );
    await db.run(
      `INSERT INTO loyalty_transactions (user_id, points, type, description)
       VALUES ($1, $2, 'REDEEMED', $3)`,
      [userId, -pointsToRedeem, `Redeemed ${pointsToRedeem} points for ₹${discount} discount`]
    );
    logger.info({ msg: '[Loyalty] Points redeemed', userId, pointsToRedeem, discount });
    return { success: true, discount, remainingPoints: account.points - pointsToRedeem };
  }

  static async getTransactionHistory(userId: number, page: number = 1, limit: number = 20): Promise<{ transactions: any[]; total: number }> {
    const db = await getDb();
    const offset = (page - 1) * limit;
    const countResult = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM loyalty_transactions WHERE user_id = $1', [userId]
    );
    const total = countResult?.count ?? 0;
    const transactions = await db.all(
      `SELECT * FROM loyalty_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return { transactions, total };
  }

  static async getAvailableRewards(userId: number): Promise<any[]> {
    const account = await this.getOrCreateAccount(userId);
    const db = await getDb();
    const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const userTierIndex = tierOrder.indexOf(account.tier);
    const eligibleTiers = tierOrder.slice(0, userTierIndex + 1);

    const rewards = await db.all(
      `SELECT * FROM loyalty_rewards WHERE active = 1 AND tier_required IN (${eligibleTiers.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY points_required`,
      eligibleTiers
    );
    return rewards.map(r => ({ ...r, canAfford: account.points >= r.points_required }));
  }

  static async predictPoints(userId: number): Promise<PointsPrediction> {
    const db = await getDb();
    const transactions: { points: number; created_at: string }[] = await db.all(
      `SELECT points, created_at FROM loyalty_transactions
       WHERE user_id = $1 AND type = 'EARNED' ORDER BY created_at ASC`,
      [userId]
    );

    if (!transactions || transactions.length < 2) {
      const account = await this.getOrCreateAccount(userId);
      const { tier } = this.getTier(account.lifetimePoints);
      const nextTier = this.getNextTierPoints(account.lifetimePoints);
      return {
        predictedPointsNext30Days: Math.max(100, Math.floor(account.lifetimePoints * 0.1)),
        confidence: 0.3,
        trend: 'stable',
        estimatedMonthsToNextTier: nextTier > 0 ? Math.ceil(nextTier / Math.max(100, account.lifetimePoints * 0.1)) : 0,
      };
    }

    const data = transactions.map((t, i) => ({ x: i, y: Math.abs(t.points) }));
    const n = data.length;
    const sumX = data.reduce((s, d) => s + d.x, 0);
    const sumY = data.reduce((s, d) => s + d.y, 0);
    const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
    const sumXX = data.reduce((s, d) => s + d.x * d.x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const predictedPointsNext30Days = Math.max(0, Math.round(slope * (n + 30) + intercept));

    const avg = sumY / n;
    const ssRes = data.reduce((s, d) => s + (d.y - (slope * d.x + intercept)) ** 2, 0);
    const ssTot = data.reduce((s, d) => s + (d.y - avg) ** 2, 0);
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    const confidence = Math.min(1, Math.max(0.1, r2 * (1 - 1 / Math.sqrt(n))));

    let trend: 'up' | 'down' | 'stable';
    if (slope > 5) trend = 'up';
    else if (slope < -5) trend = 'down';
    else trend = 'stable';

    const account2 = await this.getOrCreateAccount(userId);
    const nextTierPoints = this.getNextTierPoints(account2.lifetimePoints);
    const monthlyAvg = predictedPointsNext30Days;
    const estimatedMonthsToNextTier = nextTierPoints > 0 && monthlyAvg > 0
      ? Math.ceil(nextTierPoints / monthlyAvg)
      : 0;

    return { predictedPointsNext30Days, confidence: Math.round(confidence * 100) / 100, trend, estimatedMonthsToNextTier };
  }

  static async getRecommendations(userId: number): Promise<RewardRecommendation[]> {
    const account = await this.getOrCreateAccount(userId);
    const db = await getDb();
    const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const userTierIndex = tierOrder.indexOf(account.tier);
    const eligibleTiers = tierOrder.slice(0, userTierIndex + 1);

    const bookings: { price: number; created_at: string }[] = await db.all(
      "SELECT price, created_at FROM bookings WHERE user_id = $1 AND status = 'CONFIRMED' ORDER BY created_at DESC LIMIT 10",
      [userId]
    );
    const avgBookingAmount = bookings.length > 0
      ? bookings.reduce((s, b) => s + b.price, 0) / bookings.length
      : 500;

    const allRewards: any[] = await db.all(
      `SELECT * FROM loyalty_rewards WHERE active = 1 AND tier_required IN (${eligibleTiers.map((_, i) => `$${i + 1}`).join(',')})`,
      eligibleTiers
    );

    const scored: RewardRecommendation[] = allRewards.map((r: any) => {
      let score = account.points >= r.points_required ? 10 : Math.max(0, 10 - (r.points_required - account.points) / 100);
      if (r.category === 'UPGRADE' || r.category === 'DISCOUNT') score += 3;
      if (avgBookingAmount > 1000 && r.points_required > 1000) score += 2;
      return {
        rewardId: r.id,
        name: r.name,
        description: r.description,
        pointsRequired: r.points_required,
        category: r.category || 'GENERAL',
        matchScore: Math.round(score * 10) / 10,
      };
    });

    return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
  }

  private static getNextTierPoints(currentLifetime: number): number {
    for (const t of TIER_THRESHOLDS) {
      if (currentLifetime < t.minPoints) return t.minPoints - currentLifetime;
    }
    return 0;
  }
}
