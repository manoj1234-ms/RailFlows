import { getDb } from '../config/db';

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();
const THRESHOLD = 5;
const TIMEOUT_MS = 30000;

export class CircuitBreaker {
  static getState(name: string): CircuitBreakerState {
    if (!circuitBreakers.has(name)) {
      circuitBreakers.set(name, { failures: 0, lastFailure: 0, state: 'CLOSED' });
    }
    return circuitBreakers.get(name)!;
  }

  static async call<T>(name: string, fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    const cb = this.getState(name);

    if (cb.state === 'OPEN') {
      if (Date.now() - cb.lastFailure > TIMEOUT_MS) {
        cb.state = 'HALF_OPEN';
      } else {
        return fallback();
      }
    }

    try {
      const result = await fn();
      cb.failures = 0;
      cb.state = 'CLOSED';
      return result;
    } catch (error) {
      cb.failures++;
      cb.lastFailure = Date.now();
      if (cb.failures >= THRESHOLD) {
        cb.state = 'OPEN';
        console.warn(`[CircuitBreaker] ${name} OPENED after ${cb.failures} failures`);
      }
      return fallback();
    }
  }

  static getMetrics(): any[] {
    const metrics: any[] = [];
    for (const [name, state] of circuitBreakers.entries()) {
      metrics.push({ name, state: state.state, failures: state.failures });
    }
    return metrics;
  }
}

export class SurgePricingService {
  static readonly PEAK_HOURS = [
    { start: 8, end: 10, multiplier: 1.5 },
    { start: 17, end: 19, multiplier: 1.3 },
  ];

  static readonly TATKAL_WINDOW = { start: 10, end: 11, multiplier: 1.8 };

  static getMultiplier(): number {
    const now = new Date();
    const hour = now.getHours();

    // Tatkal window (10-11 AM): highest surge
    if (hour >= this.TATKAL_WINDOW.start && hour < this.TATKAL_WINDOW.end) {
      return this.TATKAL_WINDOW.multiplier;
    }

    // Peak hours
    for (const peak of this.PEAK_HOURS) {
      if (hour >= peak.start && hour < peak.end) {
        return peak.multiplier;
      }
    }

    return 1.0;
  }

  static calculatePrice(baseFare: number, passengerCount: number, availableSeats: number, totalSeats: number): number {
    const surge = this.getMultiplier();
    const demandMultiplier = 1 + (1 - availableSeats / totalSeats) * 0.5;
    const finalMultiplier = Math.max(surge, demandMultiplier);
    return Math.round(baseFare * passengerCount * finalMultiplier);
  }
}
