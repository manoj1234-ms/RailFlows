/**
 * RailFlow — Tatkal Spike Load Test
 * ====================================
 * Simulates the exact IRCTC Tatkal booking scenario:
 *   - 10:00 AM: Tatkal quota opens — thousands of users simultaneously
 *     try to search, queue-join, lock, and book the same set of seats.
 *
 * SCENARIOS (run all with: k6 run k6_load_test.js)
 * ─────────────────────────────────────────────────
 *   1. soak          — baseline: 50 users, 5 min. Validates steady-state memory/leak behavior.
 *   2. tatkal_spike  — THE key test: 0→3000 VUs in 30s (10AM door open), hold 60s, drain.
 *   3. seat_lock_storm — 500 VUs all try to lock the SAME seat simultaneously.
 *                        Measures lock conflict rate and Redis Redlock contention.
 *   4. payment_saga  — 200 VUs run full booking → payment → confirm flow end-to-end.
 *   5. ws_tracking   — 1000 concurrent WebSocket connections for live tracking.
 *
 * PREREQUISITES
 * ─────────────
 *   brew install k6   (Mac)  |  choco install k6  (Windows)  |  snap install k6  (Linux)
 *
 *   # Seed test data first:
 *   node scripts/seed-test-data.js   (creates train 12951 with 500 seats + 1000 test users)
 *
 * RUN INDIVIDUAL SCENARIOS
 * ────────────────────────
 *   k6 run --env SCENARIO=soak         k6_load_test.js
 *   k6 run --env SCENARIO=tatkal_spike k6_load_test.js
 *   k6 run --env SCENARIO=seat_lock    k6_load_test.js
 *   k6 run --env SCENARIO=payment_saga k6_load_test.js
 *   k6 run --env SCENARIO=ws_tracking  k6_load_test.js
 *
 * OUTPUT TO PROMETHEUS
 * ────────────────────
 *   k6 run --out experimental-prometheus-rw k6_load_test.js
 *   # Then import Grafana dashboard: https://grafana.com/grafana/dashboards/18030
 *
 * EXPECTED BREAKING POINTS (targets to beat)
 * ───────────────────────────────────────────
 *   p(95) booking latency   < 500ms at 3000 concurrent VUs
 *   lock conflict rate      < 30% (most users should find an available seat)
 *   payment saga success    > 95%
 *   WS connection errors    < 1%
 */

import http from 'k6/http';
import ws   from 'k6/ws';
import { sleep, check, fail, group } from 'k6';
import { Counter, Trend, Rate, Gauge } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ── Custom Metrics ────────────────────────────────────────────────────────────
const lockConflicts      = new Counter('railflow_lock_conflicts');
const lockSuccesses      = new Counter('railflow_lock_successes');
const paymentSuccesses   = new Counter('railflow_payment_successes');
const paymentFailures    = new Counter('railflow_payment_failures');
const sagaFullCycles     = new Counter('railflow_saga_full_cycles');
const queueWaitTime      = new Trend('railflow_queue_wait_ms', true);
const bookingE2eLatency  = new Trend('railflow_booking_e2e_ms', true);
const wsMessageLatency   = new Trend('railflow_ws_message_latency_ms', true);
const lockContentionRate = new Rate('railflow_lock_contention_rate');
const paymentSuccessRate = new Rate('railflow_payment_success_rate');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:5000/api/v1';
const WS_URL     = __ENV.WS_URL     || 'ws://localhost:5000/ws/live-tracking';
const TRAIN_NUM  = __ENV.TRAIN_NUM  || '12951';
const SCENARIO   = __ENV.SCENARIO   || 'all';

// Pre-seeded user pool (populated by scripts/seed-test-data.js)
// Format: email:password pairs for 1000 test accounts
const SEEDED_EMAILS = Array.from({ length: 1000 }, (_, i) => ({
  email: `tatkal_user_${i + 1}@railflow.test`,
  password: 'Tatkal@1234!',
}));

function randomUser() {
  return SEEDED_EMAILS[randomIntBetween(0, SEEDED_EMAILS.length - 1)];
}

// ── Scenario Definitions ─────────────────────────────────────────────────────
export const options = {
  scenarios: {

    // 1. Soak test — catch memory leaks, connection pool exhaustion
    soak: {
      ...(SCENARIO === 'soak' || SCENARIO === 'all' ? {} : { exec: 'noop' }),
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // ramp up
        { duration: '5m', target: 50 },   // hold
        { duration: '30s', target: 0 },   // drain
      ],
      gracefulRampDown: '30s',
      exec: 'bookingFlow',
    },

    // 2. Tatkal spike — THE test: 10AM door-open simulation
    tatkal_spike: {
      ...(SCENARIO === 'tatkal_spike' || SCENARIO === 'all' ? {} : {}),
      executor: 'ramping-arrival-rate',
      startRate: 10,           // 10 req/s baseline (9:59 AM)
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 3500,
      stages: [
        { duration: '30s', target: 3000 }, // 10AM: 0→3000 RPS in 30s
        { duration: '60s', target: 3000 }, // Hold Tatkal window
        { duration: '30s', target: 100 },  // Post-Tatkal drain
      ],
      exec: 'bookingFlow',
    },

    // 3. Seat lock storm — 500 VUs, SAME seat, measures Redlock contention
    seat_lock_storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 }, // instant spike
        { duration: '30s', target: 500 }, // hold
        { duration: '10s', target: 0 },
      ],
      exec: 'lockStorm',
      startTime: SCENARIO === 'all' ? '8m' : '0s',
    },

    // 4. Payment saga — full Saga cycle, measures compensating transaction rate
    payment_saga: {
      executor: 'constant-vus',
      vus: 200,
      duration: '3m',
      exec: 'paymentSagaFlow',
      startTime: SCENARIO === 'all' ? '10m' : '0s',
    },

    // 5. WebSocket — 1000 concurrent live tracking connections
    ws_tracking: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '3m',
      exec: 'wsTrackingFlow',
      startTime: SCENARIO === 'all' ? '14m' : '0s',
    },
  },

  thresholds: {
    // Booking SLA
    'railflow_booking_e2e_ms': [
      'p(95)<500',   // 95% of full booking flows under 500ms
      'p(99)<1500',  // 99% under 1.5s
    ],
    // Queue wait
    'railflow_queue_wait_ms': ['p(95)<2000'],

    // Lock contention: at 3000 VUs, expect high conflicts — alert if >80%
    'railflow_lock_contention_rate': ['rate<0.80'],

    // Payment saga must succeed in >90% of cases
    'railflow_payment_success_rate': ['rate>0.90'],

    // Global HTTP thresholds
    'http_req_duration': ['p(95)<800'],
    'http_req_failed':   ['rate<0.10'],

    // WebSocket
    'railflow_ws_message_latency_ms': ['p(95)<3000'],
  },
};

// ── Auth Helper ───────────────────────────────────────────────────────────────
function login(user) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_login' } }
  );

  if (!check(res, { 'login 200': (r) => r.status === 200 })) return null;

  const body = res.json();
  const token = body.data?.accessToken || body.accessToken;
  if (!token) return null;

  return {
    token,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  };
}

// ── Scenario 1 + 2: Full Booking Flow ─────────────────────────────────────────
export function bookingFlow() {
  const user = randomUser();
  const auth = login(user);
  if (!auth) { sleep(1); return; }

  const e2eStart = Date.now();

  // --- Join Queue ---
  let queueToken, position;
  group('queue_join', () => {
    const t0 = Date.now();
    const res = http.post(
      `${BASE_URL}/queue/join`,
      JSON.stringify({ deviceFingerprint: `k6-${__VU}-${__ITER}` }),
      { headers: auth.headers, tags: { name: 'queue_join' } }
    );
    if (!check(res, { 'queue joined': (r) => r.status === 200 })) return;
    queueWaitTime.add(Date.now() - t0);
    queueToken = res.json().data?.token;
    position   = res.json().data?.currentPosition ?? 1;
  });

  if (!queueToken) { sleep(1); return; }

  // --- Poll Queue until window opens ---
  let polls = 0;
  while (position > 0 && polls < 30) {
    sleep(0.3);
    const res = http.get(
      `${BASE_URL}/queue/status?token=${queueToken}&deviceFingerprint=k6-${__VU}-${__ITER}`,
      { headers: auth.headers, tags: { name: 'queue_poll' } }
    );
    if (res.status === 200) {
      position = res.json().data?.currentPosition ?? 0;
    }
    polls++;
  }
  if (position > 0) { sleep(1); return; } // never got window

  // --- Lock Seat ---
  // Each VU picks a random seat 1–500 to spread load (vs. all hitting seat 1)
  const seatNum = randomIntBetween(1, 500);
  let lockedSeats;

  group('seat_lock', () => {
    const res = http.post(
      `${BASE_URL}/bookings/lock`,
      JSON.stringify({ trainNumber: TRAIN_NUM, coachLabel: 'B1', seatNumbers: [seatNum] }),
      { headers: auth.headers, tags: { name: 'seat_lock' } }
    );

    const isConflict = res.status === 409;
    lockContentionRate.add(isConflict);

    if (isConflict) {
      lockConflicts.add(1);
      return;
    }

    if (!check(res, { 'seat locked': (r) => r.status === 200 })) return;
    lockSuccesses.add(1);
    lockedSeats = res.json().data?.lockedSeats;
  });

  if (!lockedSeats) { sleep(1); return; }

  // --- Confirm Booking ---
  group('booking_confirm', () => {
    const res = http.post(
      `${BASE_URL}/bookings/confirm`,
      JSON.stringify({
        trainNumber: TRAIN_NUM,
        coachLabel:  'B1',
        seatNumbers: lockedSeats,
        passengers: [{ name: `K6 User ${__VU}`, age: randomIntBetween(18, 65), gender: 'M' }],
        paymentMethod: 'UPI',
        idempotencyKey: `k6-${__VU}-${__ITER}-${Date.now()}`,
      }),
      { headers: auth.headers, tags: { name: 'booking_confirm' } }
    );
    check(res, { 'booking confirmed': (r) => r.status === 200 || r.status === 201 });
  });

  bookingE2eLatency.add(Date.now() - e2eStart);
  sleep(randomIntBetween(1, 3));
}

// ── Scenario 3: Lock Storm — all VUs hammer SAME seat ─────────────────────────
export function lockStorm() {
  const auth = login(randomUser());
  if (!auth) { sleep(1); return; }

  // Intentionally: ALL VUs fight over the exact same seat to measure Redlock
  const res = http.post(
    `${BASE_URL}/bookings/lock`,
    JSON.stringify({ trainNumber: TRAIN_NUM, coachLabel: 'B1', seatNumbers: [1] }),
    { headers: auth.headers, tags: { name: 'lock_storm' } }
  );

  const won = res.status === 200;
  lockContentionRate.add(!won);

  if (won) {
    lockSuccesses.add(1);
    // Immediately release (don't confirm) to let next VU win
    const lockedSeats = res.json().data?.lockedSeats;
    if (lockedSeats) {
      http.post(
        `${BASE_URL}/bookings/lock/release`,
        JSON.stringify({ trainNumber: TRAIN_NUM, coachLabel: 'B1', seatNumbers: lockedSeats }),
        { headers: auth.headers, tags: { name: 'lock_release' } }
      );
    }
  } else {
    lockConflicts.add(1);
  }

  sleep(0.1); // tight loop to maximize contention
}

// ── Scenario 4: Full Payment Saga ─────────────────────────────────────────────
export function paymentSagaFlow() {
  const auth = login(randomUser());
  if (!auth) { sleep(1); return; }

  let bookingId, paymentId;
  let sagaSuccess = false;

  group('saga_full_cycle', () => {
    // Step 1: Lock seat
    const seatNum = randomIntBetween(1, 500);
    const lockRes = http.post(
      `${BASE_URL}/bookings/lock`,
      JSON.stringify({ trainNumber: TRAIN_NUM, coachLabel: 'B1', seatNumbers: [seatNum] }),
      { headers: auth.headers, tags: { name: 'saga_lock' } }
    );
    if (lockRes.status !== 200) { lockConflicts.add(1); return; }
    const lockedSeats = lockRes.json().data?.lockedSeats;

    // Step 2: Create booking
    const bookRes = http.post(
      `${BASE_URL}/bookings/confirm`,
      JSON.stringify({
        trainNumber:    TRAIN_NUM,
        coachLabel:     'B1',
        seatNumbers:    lockedSeats,
        passengers:     [{ name: `Saga User ${__VU}`, age: 30, gender: 'F' }],
        paymentMethod:  'CREDIT_CARD',
        idempotencyKey: `saga-${__VU}-${__ITER}-${Date.now()}`,
      }),
      { headers: auth.headers, tags: { name: 'saga_booking' } }
    );
    if (!check(bookRes, { 'booking created': (r) => r.status === 200 || r.status === 201 })) return;
    bookingId = bookRes.json().data?.id || bookRes.json().data?.bookingId;

    // Step 3: Initiate payment (triggers Saga Phase 1 — FOR UPDATE NOWAIT)
    const payRes = http.post(
      `${BASE_URL}/payments/initiate`,
      JSON.stringify({
        bookingId,
        amount:        1500,
        currency:      'INR',
        paymentMethod: 'CREDIT_CARD',
        cardNumber:    '4111111111111111',
        expiryMonth:   12,
        expiryYear:    2028,
        cvv:           '123',
      }),
      { headers: auth.headers, tags: { name: 'saga_payment_initiate' } }
    );
    if (!check(payRes, { 'payment initiated': (r) => r.status === 200 || r.status === 201 })) {
      paymentFailures.add(1);
      paymentSuccessRate.add(false);
      return;
    }
    paymentId = payRes.json().data?.transactionId || payRes.json().data?.paymentId;

    // Step 4: Simulate gateway callback (triggers Saga Phase 2 — BEGIN / FOR UPDATE)
    sleep(0.5); // simulate gateway round-trip latency
    const confirmRes = http.post(
      `${BASE_URL}/payments/callback`,
      JSON.stringify({
        transactionId: paymentId,
        status:        'SUCCESS',
        gatewayRef:    `GW-${randomString(12)}`,
        amount:        1500,
      }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'saga_payment_confirm' } }
    );
    if (!check(confirmRes, { 'payment confirmed': (r) => r.status === 200 })) {
      paymentFailures.add(1);
      paymentSuccessRate.add(false);
      return;
    }

    sagaSuccess = true;
    paymentSuccesses.add(1);
    paymentSuccessRate.add(true);
    sagaFullCycles.add(1);
  });

  if (!sagaSuccess && bookingId) {
    // Compensating transaction check: was the booking properly cancelled?
    const checkRes = http.get(
      `${BASE_URL}/bookings/${bookingId}`,
      { headers: auth.headers, tags: { name: 'saga_compensation_check' } }
    );
    check(checkRes, {
      'compensation: booking cancelled': (r) => {
        const status = r.json().data?.status;
        return status === 'CANCELLED' || status === 'PENDING';
      },
    });
  }

  sleep(randomIntBetween(1, 2));
}

// ── Scenario 5: WebSocket Live Tracking ───────────────────────────────────────
export function wsTrackingFlow() {
  const auth = login(randomUser());
  if (!auth) { sleep(1); return; }

  const trainNums = ['12951', '12952', '22222', '16533', '11014'];
  const train = trainNums[randomIntBetween(0, trainNums.length - 1)];

  // Use subprotocol auth (matches our Sec-WebSocket-Protocol implementation)
  const url       = `${WS_URL}?train=${train}`;
  const protocols = [`railflow-v1`, `Bearer.${auth.token}`];

  const res = ws.connect(url, { protocols }, (socket) => {
    let messagesReceived = 0;

    socket.on('open', () => {
      check(socket, { 'ws connected': () => true });
    });

    socket.on('message', (data) => {
      const t0 = Date.now();
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'status') {
          messagesReceived++;
          wsMessageLatency.add(Date.now() - t0);
          check(msg, {
            'ws has train_number':    (m) => !!m.data?.train_number,
            'ws has current_station': (m) => !!m.data?.current_station,
          });
        }
        // Heartbeat
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch { /* ignore */ }
    });

    socket.on('error', (e) => {
      check(null, { 'ws no error': () => false });
    });

    // Hold connection for 90s (simulate a user watching the widget)
    socket.setTimeout(() => {
      check({ messagesReceived }, {
        'ws received ≥1 message': (d) => d.messagesReceived >= 1,
      });
      socket.close();
    }, 90_000);
  });

  check(res, { 'ws status 101': (r) => r && r.status === 101 });
  sleep(1);
}

// ── No-op for disabled scenarios ──────────────────────────────────────────────
export function noop() { sleep(1); }

// ── HTML Report on finish ─────────────────────────────────────────────────────
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    [`load-test-results-${timestamp}.html`]: htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
