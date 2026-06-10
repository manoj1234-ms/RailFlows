export interface User {
  id: number;
  email: string;
  role: 'Guest' | 'Passenger' | 'Agent' | 'Operator' | 'Admin' | 'Super Admin';
  mfaEnabled: boolean;
  createdAt: string;
  activeSessions?: Session[];
}

export interface Session {
  sessionId: string;
  ipAddress: string;
  userAgent: string;
  isCurrent: boolean;
  lastActive: string;
}

export interface SavedPassenger {
  id: number;
  name: string;
  maskedAadhaar: string;
}

export interface Train {
  id: number;
  trainNumber: string;
  name: string;
  fromStation: string;
  toStation: string;
  departureTime: string;
  arrivalTime: string;
  baseFare: number;
  availableSeatsCount?: number;
  totalSeatsCount?: number;
  fareBreakup?: FareBreakup;
}

export interface FareCalendarDay {
  date: string;
  dayName: string;
  isWeekend: boolean;
  cheapestFare: number | null;
  cheapestTrain: string | null;
  trains: FareCalendarTrain[];
}

export interface FareCalendarTrain {
  trainNumber: string;
  trainName: string;
  departureTime: string;
  arrivalTime: string;
  distanceKm: number;
  fare: number;
  isWeekend: boolean;
  fareBreakup: FareBreakup;
}

export interface FareBreakup {
  baseFare: number;
  reservationFee: number;
  superfastCharge: number;
  convenienceFee: number;
  totalWithCharges: number;
}

export interface TrainDetail extends Train {
  totalDistance: number;
  coachComposition: Coach[];
  route: RouteStop[];
}

export interface Coach {
  class: '1A' | '2A' | '3A' | 'SL' | '2S' | 'CC' | 'EC' | 'GN';
  label: string;
  positionFromEngine: number;
  totalSeats: number;
}

export interface RouteStop {
  stopNumber: number;
  stationCode: string;
  stationName: string;
  city: string;
  arrivalTime: string;
  departureTime: string;
  distanceKm: number;
  dayCount: number;
  platform: number;
}

export interface Seat {
  id: number;
  coachLabel: string;
  seatNumber: number;
  status: 'AVAILABLE' | 'BOOKED' | 'LOCKED';
  remainingSeconds: number;
}

export interface Booking {
  id: number;
  pnr: string;
  trainNumber: string;
  trainName: string;
  fromStation: string;
  toStation: string;
  departureTime: string;
  arrivalTime: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';
  price: number;
  createdAt: string;
  passengers?: Passenger[];
}

export interface Passenger {
  name: string;
  age: number;
  gender: 'M' | 'F' | 'O';
  maskedAadhaar?: string;
  seat?: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: 'UPI' | 'CARD' | 'NETBANKING';
  icon: string;
}

export interface QueueInfo {
  token: string;
  userId: number;
  originalPosition: number;
  currentPosition: number;
  estimatedWaitSeconds: number;
  bookingWindowExpiresAt: string | null;
}

export interface WaitlistEntry {
  pnr: string;
  trainNumber: string;
  trainName: string;
  fromStation: string;
  toStation: string;
  coachClass: string;
  passengers: number;
  status: 'WAITLIST' | 'RAC';
  waitlistNumber: number;
  createdAt: string;
}

export interface LoyaltyAccount {
  points: number;
  tier: 'Silver' | 'Gold' | 'Platinum';
  totalEarned: number;
  totalRedeemed: number;
}

export interface LoyaltyTransaction {
  id: number;
  type: 'EARNED' | 'REDEEMED' | 'EXPIRED';
  points: number;
  description: string;
  createdAt: string;
}

export interface Notification {
  id: number;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  channel: string;
  subject: string;
  body: string;
  status: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  bookingUpdates: boolean;
  paymentUpdates: boolean;
  promotional: boolean;
}

export interface Wallet {
  balance: number;
  transactions: WalletTransaction[];
}

export interface WalletTransaction {
  id: number;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  createdAt: string;
}

export interface Payment {
  transactionId: string;
  bookingId: number;
  pnr: string;
  amount: number;
  paymentMethod: string;
  status: string;
  bookingStatus: string;
  createdAt: string;
}

export interface Event {
  id: number;
  name: string;
  category: string;
  city: string;
  venue: string;
  date: string;
  price: number;
  imageUrl?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data: T;
  source?: 'cache' | 'database';
  pagination?: Pagination;
}

export interface AdminAnalytics {
  totalBookings: number;
  totalRevenue: number;
  routeDemand: { route: string; bookingCount: number; routeRevenue: number }[];
  peakHours: { hour: string; bookings: number }[];
}

export interface ServiceHealth {
  host: {
    platform: string;
    arch: string;
    hostname: string;
    cpuCount: number;
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    processMemory: { rss: string; heapTotal: string; heapUsed: string };
  };
  microservices: {
    name: string;
    status: string;
    uptime: string;
    latencyMs: number;
    cpuUsage: string;
    memoryBytes: string;
  }[];
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  ip: string;
  payload: string | null;
  timestamp: string;
}
