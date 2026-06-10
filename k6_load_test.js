import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const lockConflictCounter = new Counter('lock_conflicts');
const lockSuccessCounter = new Counter('lock_successes');
const queueJoinTime = new Trend('queue_join_latency');

export const options = {
  stages: [
    { duration: '5s', target: 20 },  // Slow ramp-up (9:59 AM)
    { duration: '15s', target: 100 }, // Vertical peak wall (10:00 AM)
    { duration: '10s', target: 0 },   // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% of requests must finish within 400ms
    http_req_failed: ['rate<0.05'],   // Less than 5% failed requests
  },
};

const BASE_URL = 'http://localhost:5000/api/v1';

export default function () {
  const vuId = __VU;
  const iterationId = __ITER;
  const email = `k6_user_${vuId}_${iterationId}_${Date.now()}@test.com`;
  const password = 'Password123!';
  const phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`; // Random 10 digit number

  // Step 1: Register User
  let regRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({
      email: email,
      password: password,
      phone: phone,
      role: 'Passenger'
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(regRes, {
    'register success': (r) => r.status === 201 || r.status === 200,
  });

  if (regRes.status !== 201 && regRes.status !== 200) {
    sleep(1);
    return;
  }

  // Step 2: Login User
  let loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: email,
      password: password
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const loginSuccess = check(loginRes, {
    'login success': (r) => r.status === 200,
  });

  if (!loginSuccess) {
    sleep(1);
    return;
  }

  const token = loginRes.json().accessToken;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Step 3: Join Virtual Queue
  const joinStart = Date.now();
  let queueRes = http.post(
    `${BASE_URL}/queue/join`,
    JSON.stringify({ deviceFingerprint: `k6-device-${vuId}` }),
    { headers: authHeaders }
  );
  queueJoinTime.add(Date.now() - joinStart);

  const inQueue = check(queueRes, {
    'joined queue': (r) => r.status === 200,
  });

  if (!inQueue) {
    sleep(1);
    return;
  }

  const queueToken = queueRes.json().data.token;

  // Step 4: Poll Queue Status until window opens (position === 0)
  let position = queueRes.json().data.currentPosition;
  let attempts = 0;
  
  while (position > 0 && attempts < 25) {
    attempts++;
    sleep(0.5); // poll every 500ms

    let statusRes = http.get(
      `${BASE_URL}/queue/status?token=${queueToken}&deviceFingerprint=k6-device-${vuId}`,
      { headers: authHeaders }
    );

    if (statusRes.status === 200) {
      position = statusRes.json().data.currentPosition;
    } else {
      break;
    }
  }

  if (position !== 0) {
    sleep(1);
    return;
  }

  // Step 5: Lock Seat (concurrency collision point)
  // All VUs will try to lock the exact same seat: Coach B1, Seat 12
  let lockRes = http.post(
    `${BASE_URL}/bookings/lock`,
    JSON.stringify({
      trainNumber: '12951',
      coachLabel: 'B1',
      seatNumbers: [12]
    }),
    { headers: authHeaders }
  );

  const lockCheck = check(lockRes, {
    'lock completed (200 or 409)': (r) => r.status === 200 || r.status === 409,
  });

  if (lockRes.status === 200) {
    lockSuccessCounter.add(1);
    
    // Step 6: Confirm Booking for successfully locked seat
    const lockedSeats = lockRes.json().data.lockedSeats;
    const idempotencyKey = `k6_idem_${Date.now()}_${vuId}`;
    
    let confirmRes = http.post(
      `${BASE_URL}/bookings/confirm`,
      JSON.stringify({
        trainNumber: '12951',
        coachLabel: 'B1',
        seatNumbers: lockedSeats,
        passengers: [
          { name: 'K6 Concurrency User', age: 30, gender: 'M', aadhaar: '123456789012' }
        ],
        paymentMethod: 'UPI',
        idempotencyKey: idempotencyKey
      }),
      { headers: authHeaders }
    );

    check(confirmRes, {
      'confirm completed': (r) => r.status === 200,
    });
  } else if (lockRes.status === 409) {
    lockConflictCounter.add(1);
  }

  sleep(1);
}
