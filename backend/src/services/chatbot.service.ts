import { getDb } from '../config/db';
import logger from '../utils/logger';

interface Intent {
  name: string;
  patterns: RegExp[];
  keywords: { word: string; weight: number }[];
  contextRequired: boolean;
}

interface ChatResponse {
  intent: string;
  answer: string;
  confidence: number;
  contextUsed: boolean;
  suggestions?: string[];
}

const STATIC_INTENTS: Intent[] = [
  {
    name: 'greeting',
    patterns: [/^(hi|hello|hey|good\s*(morning|afternoon|evening)|namaste|hola)\b/i],
    keywords: [{ word: 'hi', weight: 5 }, { word: 'hello', weight: 5 }, { word: 'hey', weight: 4 }],
    contextRequired: false,
  },
  {
    name: 'booking_status',
    patterns: [/(booking|ticket|pnr)\s*(status|track|find|check|details)/i, /(status|details)\s*(of|for)?\s*(my)?\s*(booking|ticket|pnr)/i, /where\s*(is|are)\s*(my)?\s*(booking|ticket)/i],
    keywords: [{ word: 'pnr', weight: 8 }, { word: 'status', weight: 5 }, { word: 'booking', weight: 4 }, { word: 'ticket', weight: 4 }, { word: 'track', weight: 5 }],
    contextRequired: false,
  },
  {
    name: 'cancel_booking',
    patterns: [/cancel\s*(my)?\s*(booking|ticket|trip)/i, /how\s*(to|do\s*i|can\s*i)\s*cancel/i, /refund\s*(my)?\s*(booking|ticket)/i],
    keywords: [{ word: 'cancel', weight: 8 }, { word: 'cancellation', weight: 8 }, { word: 'refund', weight: 6 }],
    contextRequired: false,
  },
  {
    name: 'refund_policy',
    patterns: [/refund\s*(policy|rules|status|time|process)/i, /cancellation\s*(policy|rules|charges)/i, /how\s*(long|much\stime)\s*(for|does)\s*refund/i],
    keywords: [{ word: 'refund', weight: 5 }, { word: 'policy', weight: 5 }, { word: 'cancellation', weight: 4 }, { word: 'charges', weight: 5 }],
    contextRequired: false,
  },
  {
    name: 'loyalty_points',
    patterns: [/(loyalty|reward|points)\s*(balance|check|status|earn|redeem)/i, /how\s*(many|much)\s*points/i, /my\s*points/i, /redeem\s*points/i],
    keywords: [{ word: 'points', weight: 8 }, { word: 'loyalty', weight: 7 }, { word: 'reward', weight: 5 }, { word: 'redeem', weight: 6 }],
    contextRequired: true,
  },
  {
    name: 'loyalty_tier',
    patterns: [/(my\s*)?(tier|status|level|membership)\s*(in\s*)?(loyalty|reward)?/i, /what\s*(is\s*my|tier\s*am\s*i)/i, /how\s*to\s*(upgrade|reach\s*next\s*tier)/i],
    keywords: [{ word: 'tier', weight: 8 }, { word: 'upgrade', weight: 5 }, { word: 'silver', weight: 4 }, { word: 'gold', weight: 4 }, { word: 'platinum', weight: 4 }],
    contextRequired: true,
  },
  {
    name: 'train_schedule',
    patterns: [/(train|schedule|timetable|timing)\s*(between|from|to|for)?/i, /when\s*(does|is|will)\s*(train|the\s*train)/i, /what\s*time\s*(does|is)\s*(train|departure)/i],
    keywords: [{ word: 'schedule', weight: 7 }, { word: 'train', weight: 5 }, { word: 'timing', weight: 6 }, { word: 'departure', weight: 5 }, { word: 'arrival', weight: 5 }],
    contextRequired: false,
  },
  {
    name: 'seat_availability',
    patterns: [/(seat|berth|available|vacancy)\s*(availability|check|status)?/i, /is\s*(seat|berth|space)\s*(available|free)/i, /any\s*(seat|berth)\s*(available|free|empty)/i],
    keywords: [{ word: 'available', weight: 6 }, { word: 'seat', weight: 5 }, { word: 'berth', weight: 5 }, { word: 'vacancy', weight: 6 }],
    contextRequired: false,
  },
  {
    name: 'payment_issue',
    patterns: [/(payment|pay)\s*(issue|failed|error|problem|not\sworking)/i, /transaction\s*(failed|declined|error)/i, /money\s*(deducted|debited)\s*but/i],
    keywords: [{ word: 'payment', weight: 7 }, { word: 'failed', weight: 6 }, { word: 'transaction', weight: 5 }, { word: 'error', weight: 4 }, { word: 'declined', weight: 6 }],
    contextRequired: false,
  },
  {
    name: 'waitlist_rac',
    patterns: [/(waitlist|rac|wl|confirmed)\s*(status|chance|probability)?/i, /what\s*is\s*(waitlist|rac)/i, /will\s*(my|i)\s*(get|confirm)\s*(waitlist|rac)/i, /waitlist\s*(position|number)/i],
    keywords: [{ word: 'waitlist', weight: 8 }, { word: 'rac', weight: 7 }, { word: 'wl', weight: 6 }, { word: 'confirmed', weight: 4 }],
    contextRequired: false,
  },
  {
    name: 'contact_support',
    patterns: [/(contact|customer\s*support|help|complaint|grievance)\s*(number|email|address|chat)?/i, /speak\s*(to|with)\s*(agent|human|representative|person)/i, /toll\s*free/i],
    keywords: [{ word: 'contact', weight: 6 }, { word: 'support', weight: 5 }, { word: 'complaint', weight: 5 }, { word: 'grievance', weight: 5 }, { word: 'help', weight: 3 }],
    contextRequired: false,
  },
  {
    name: 'change_booking',
    patterns: [/(change|modify|reschedule|update|edit)\s*(my)?\s*(booking|ticket|date|seat|journey)/i, /date\s*(change|modify|reschedule)/i, /boarding\s*(point|station)\s*(change|modify)/i],
    keywords: [{ word: 'change', weight: 6 }, { word: 'modify', weight: 6 }, { word: 'reschedule', weight: 7 }, { word: 'date', weight: 3 }],
    contextRequired: false,
  },
  {
    name: 'fare_enquiry',
    patterns: [/(fare|price|cost|rate|charge|amount)\s*(of|for|between|from|to)?/i, /how\s*much\s*(does|is|for)\s*(ticket|fare|booking)/i, /ticket\s*(price|cost|rate)/i],
    keywords: [{ word: 'fare', weight: 7 }, { word: 'price', weight: 6 }, { word: 'cost', weight: 5 }, { word: 'ticket', weight: 3 }, { word: 'rate', weight: 5 }],
    contextRequired: false,
  },
  {
    name: 'luggage_policy',
    patterns: [/(luggage|baggage|bag|cargo|parcel)\s*(policy|allow|limit|weight|rules)/i, /how\s*much\s*(luggage|baggage|bag)\s*(allowed|permit)/i],
    keywords: [{ word: 'luggage', weight: 7 }, { word: 'baggage', weight: 7 }, { word: 'bag', weight: 4 }, { word: 'allowed', weight: 4 }],
    contextRequired: false,
  },
  {
    name: 'tatkal',
    patterns: [/tatkal\s*(booking|quota|timing|time|charges|fee)?/i, /premium\s*tatkal/i, /how\s*to\s*book\s*tatkal/i],
    keywords: [{ word: 'tatkal', weight: 9 }, { word: 'premium', weight: 3 }, { word: 'quota', weight: 4 }],
    contextRequired: false,
  },
];

const RESPONSES: Record<string, (context?: any) => string> = {
  greeting: () => 'Welcome to RailFlow! How can I assist you today? You can ask me about bookings, PNR status, train schedules, loyalty points, cancellations, refunds, and more.',
  booking_status: () => 'You can check your booking status using your PNR number. Use the PNR enquiry at GET /api/v1/bookings/pnr/:pnr. Would you like me to look up a specific booking?',
  cancel_booking: () => 'To cancel a booking, go to POST /api/v1/bookings/cancel/:pnr. Cancellation charges may apply based on your cancellation policy. Refunds are processed within 5-7 business days.',
  refund_policy: () => 'Refund Policy: Cancellations made 48+ hours before departure get 75% refund, 24-48 hours get 50%, and less than 24 hours get 25%. Refunds are processed within 5-7 business days to the original payment method.',
  loyalty_points: (ctx) => {
    if (ctx?.points !== undefined) {
      return `You currently have ${ctx.points} points (${ctx.tier} tier). You earn ${ctx.multiplier}x points on every booking. Check your full history at GET /api/v1/loyalty/history.`;
    }
    return 'Loyalty points are earned on every booking at a rate determined by your tier. Bronze: 1x, Silver: 1.2x, Gold: 1.5x, Platinum: 2x. Check your balance at GET /api/v1/loyalty/points.';
  },
  loyalty_tier: (ctx) => {
    if (ctx?.tier) {
      const nextTier = ctx.tier === 'BRONZE' ? 'SILVER (1,000 pts)' : ctx.tier === 'SILVER' ? 'GOLD (5,000 pts)' : ctx.tier === 'GOLD' ? 'PLATINUM (20,000 pts)' : 'PLATINUM (max tier)';
      return `Your current tier is ${ctx.tier}. You have ${ctx.lifetimePoints || 0} lifetime points. Next tier: ${nextTier}. Each tier offers better point multipliers and exclusive rewards.`;
    }
    return 'RailFlow has 4 tiers: BRONZE (0+ pts), SILVER (1,000+), GOLD (5,000+), and PLATINUM (20,000+). Higher tiers earn more points per booking. Check your tier at GET /api/v1/loyalty/points.';
  },
  train_schedule: () => 'You can search train schedules at GET /api/v1/schedule?from=STATION_CODE&to=STATION_CODE. All schedules show departure, arrival times, and available classes.',
  seat_availability: () => 'Seat availability can be checked at GET /api/v1/trains/:trainNumber?date=YYYY-MM-DD. Real-time availability is shown with seat numbers and coach layout.',
  payment_issue: () => 'If you experienced a payment issue, please check your transaction history at GET /api/v1/payments. If money was deducted but booking is not confirmed, contact support with your transaction ID and we will resolve it within 24 hours.',
  waitlist_rac: () => 'Waitlist (WL) and RAC (Reservation Against Cancellation) are managed automatically. Check your WL/RAC status at GET /api/v1/bookings/waitlist/status/:pnr. RAC tickets allow boarding with seat sharing.',
  contact_support: () => 'RailFlow Support: Email support@railflow.com | Toll Free: 1800-123-RAIL | Live chat available 24/7. For urgent issues, please call our helpline. Response time: < 2 hours for emails.',
  change_booking: () => 'Booking modifications (date/seat change) are currently available for confirmed bookings. Use POST /api/v1/bookings/change/:pnr. Change fees may apply. Same-day changes are not permitted.',
  fare_enquiry: () => 'Ticket fares vary by train class, route, and demand surge. Use GET /api/v1/trains to search routes with live pricing. Tatkal and peak hour surcharges may apply.',
  luggage_policy: () => 'Luggage Policy: General compartment: 40 kg, Sleeper: 40 kg, AC 3-tier: 40 kg, AC 2-tier: 50 kg, AC 1st Class: 70 kg. Hand baggage: 2 pieces per passenger.',
  tatkal: () => 'Tatkal Booking: Window opens at 10:00 AM (AC classes) and 11:00 AM (Sleeper) one day before departure. Tatkal charges are 30% of base fare for AC and 15% for Sleeper. Limited quota available.',
};

export class ChatbotService {

  static async classifyIntent(message: string): Promise<{ intent: Intent; score: number }> {
    const db = await getDb();
    const trainingData: any[] = await db.all(
      "SELECT intent, pattern, response, context_required FROM chatbot_training WHERE active = 1"
    );

    let bestIntent: Intent | null = null;
    let bestScore = 0;

    for (const intent of STATIC_INTENTS) {
      let score = 0;
      for (const pattern of intent.patterns) {
        if (pattern.test(message)) {
          score += 10;
          break;
        }
      }
      for (const kw of intent.keywords) {
        const regex = new RegExp('\\b' + kw.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (regex.test(message)) {
          score += kw.weight;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    for (const row of trainingData) {
      const pattern = new RegExp(row.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*'), 'i');
      let score = pattern.test(message) ? 12 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = {
          name: row.intent,
          patterns: [pattern],
          keywords: [],
          contextRequired: !!row.context_required,
        };
      }
    }

    return { intent: bestIntent || STATIC_INTENTS[0], score: bestScore };
  }

  static async getResponse(message: string, userId?: number): Promise<ChatResponse> {
    const { intent, score } = await this.classifyIntent(message);
    const confidence = Math.min(1, score / 15);

    let context: any = undefined;
    let contextUsed = false;

    if (intent.contextRequired && userId) {
      contextUsed = true;
      const db = await getDb();
      if (intent.name === 'loyalty_points' || intent.name === 'loyalty_tier') {
        const account = await db.get<{ points: number; lifetime_points: number; tier: string }>(
          'SELECT points, lifetime_points, tier FROM loyalty_accounts WHERE user_id = $1',
          [userId]
        );
        if (account) {
          const { LoyaltyService } = require('./loyalty.service');
          const { multiplier } = LoyaltyService.getTier(account.lifetime_points);
          context = { points: account.points, lifetimePoints: account.lifetime_points, tier: account.tier, multiplier };
        }
      }
      if (intent.name === 'booking_status') {
        const bookings = await db.all<any[]>(
          "SELECT pnr, status, created_at FROM bookings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3",
          [userId]
        );
        if (bookings && bookings.length > 0) {
          context = { recentBookings: bookings };
        }
      }
    }

    const responder = RESPONSES[intent.name];
    let answer: string;
    if (responder) {
      answer = responder(context);
    } else {
      answer = 'I understand your query but need more information. Could you please provide more details or contact support at support@railflow.com?';
    }

    if (score < 5) {
      answer = 'I\'m not entirely sure I understood your question. Here\'s what I can help with:\n' +
        '• Check booking / PNR status\n' +
        '• Cancel or modify bookings\n' +
        '• Loyalty points and tiers\n' +
        '• Train schedules and seat availability\n' +
        '• Refund policy and payment issues\n' +
        '• Waitlist/RAC status\n' +
        '• Tatkal booking\n\n' +
        answer;
    }

    const suggestions = this.getSuggestions(intent.name);

    logger.info({ msg: '[Chatbot] Query', intent: intent.name, confidence, contextUsed });
    return { intent: intent.name, answer, confidence, contextUsed, suggestions };
  }

  static getSuggestions(intent: string): string[] {
    const all: Record<string, string[]> = {
      booking_status: ['Check my recent bookings', 'What is my PNR status', 'Show my upcoming trips'],
      cancel_booking: ['Cancel my last booking', 'What is the cancellation policy', 'How long for refund'],
      loyalty_points: ['How many points do I have', 'Redeem my points', 'What rewards are available'],
      loyalty_tier: ['What is my current tier', 'How to reach Platinum', 'Tier benefits'],
      train_schedule: ['Show trains from Delhi to Mumbai', 'Schedule for 12345', 'Train between stations'],
      seat_availability: ['Check seat availability', 'Available seats tomorrow'],
      payment_issue: ['Payment failed', 'Money deducted but no ticket'],
      waitlist_rac: ['My waitlist status', 'What is RAC', 'Waitlist confirmation chances'],
      tatkal: ['Tatkal booking time', 'Tatkal charges', 'Premium Tatkal'],
    };
    return all[intent] || ['Check booking status', 'Loyalty points balance', 'Train schedules', 'Contact support'];
  }

  static async addTrainingData(intent: string, pattern: string, response: string, contextRequired: boolean = false): Promise<void> {
    const db = await getDb();
    await db.run(
      `INSERT INTO chatbot_training (intent, pattern, response, context_required) VALUES ($1, $2, $3, $4)`,
      [intent.toLowerCase(), pattern.toLowerCase(), response, contextRequired ? 1 : 0]
    );
    logger.info({ msg: '[Chatbot] Training data added', intent, pattern });
  }
}
