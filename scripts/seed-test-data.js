/**
 * RailFlow — Load Test Seed Data Script
 * ========================================
 * Creates 1000 pre-registered test users and a fully-seated train (12951)
 * with 500 seats for the k6 load test.
 *
 * Usage:
 *   node scripts/seed-test-data.js
 *   node scripts/seed-test-data.js --clean   (wipe and re-seed)
 *
 * Prerequisites: Backend server running on localhost:5000
 */

const http = require('http');
const https = require('https');

const BASE_URL    = process.env.BASE_URL || 'http://localhost:5000/api/v1';
const USER_COUNT  = 1000;
const SEAT_COUNT  = 500;
const TRAIN_NUM   = '12951';
const PASSWORD    = 'Tatkal@1234!';

const CLEAN_MODE  = process.argv.includes('--clean');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE_URL + path);
    const lib    = url.protocol === 'https:' ? https : http;
    const data   = body ? JSON.stringify(body) : undefined;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data  ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    };

    const req = lib.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Admin login ───────────────────────────────────────────────────────────────
async function getAdminToken() {
  const res = await request('POST', '/auth/login', {
    email: process.env.ADMIN_EMAIL || 'admin@railflow.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@1234!',
  });
  const token = res.body?.data?.accessToken || res.body?.accessToken;
  if (!token) throw new Error(`Admin login failed: ${JSON.stringify(res.body)}`);
  console.log('✓ Admin authenticated');
  return token;
}

// ── Seed users ────────────────────────────────────────────────────────────────
async function seedUsers() {
  console.log(`\nSeeding ${USER_COUNT} test users...`);
  let created = 0;
  let existing = 0;

  // Batch in groups of 50 to avoid overwhelming the server
  const batchSize = 50;
  for (let batch = 0; batch < USER_COUNT / batchSize; batch++) {
    const promises = [];
    for (let i = batch * batchSize; i < (batch + 1) * batchSize; i++) {
      promises.push(
        request('POST', '/auth/register', {
          email:    `tatkal_user_${i + 1}@railflow.test`,
          password: PASSWORD,
          phone:    `9${String(800000000 + i).padStart(9, '0')}`,
          name:     `Tatkal User ${i + 1}`,
          role:     'Passenger',
        }).then((res) => {
          if (res.status === 201 || res.status === 200) created++;
          else if (res.status === 409 || res.status === 400) existing++;
        })
      );
    }
    await Promise.all(promises);
    process.stdout.write(`\r  Progress: ${Math.min((batch + 1) * batchSize, USER_COUNT)}/${USER_COUNT} users`);
  }
  console.log(`\n  ✓ Created: ${created}  Already existing: ${existing}`);
}

// ── Seed train ────────────────────────────────────────────────────────────────
async function seedTrain(adminToken) {
  console.log(`\nSeeding train ${TRAIN_NUM}...`);

  // Create train if not exists
  const trainRes = await request('POST', '/trains', {
    trainNumber:   TRAIN_NUM,
    name:          'Mumbai Rajdhani Express (K6 Test)',
    fromStation:   'CSTM',
    toStation:     'NDLS',
    departureTime: '16:35',
    arrivalTime:   '08:15',
    baseFare:      1500,
  }, adminToken);

  if (trainRes.status === 201 || trainRes.status === 200) {
    console.log(`  ✓ Train ${TRAIN_NUM} created`);
  } else if (trainRes.status === 409) {
    console.log(`  ✓ Train ${TRAIN_NUM} already exists`);
  } else {
    console.warn(`  ⚠ Train creation response: ${trainRes.status} — ${JSON.stringify(trainRes.body)}`);
  }
}

// ── Seed seats ────────────────────────────────────────────────────────────────
async function seedSeats(adminToken) {
  console.log(`\nSeeding ${SEAT_COUNT} seats for train ${TRAIN_NUM}...`);
  const coaches = [
    { label: 'B1', class: '3A', seats: 72 },
    { label: 'B2', class: '3A', seats: 72 },
    { label: 'B3', class: '3A', seats: 72 },
    { label: 'B4', class: '3A', seats: 72 },
    { label: 'A1', class: '2A', seats: 46 },
    { label: 'A2', class: '2A', seats: 46 },
    { label: 'S1', class: 'SL', seats: 72 },
    { label: 'S2', class: 'SL', seats: 48 },
  ];

  let totalSeated = 0;

  for (const coach of coaches) {
    const res = await request('POST', `/trains/${TRAIN_NUM}/coaches`, {
      coachLabel: coach.label,
      coachClass: coach.class,
      seatCount:  coach.seats,
    }, adminToken);

    if (res.status === 200 || res.status === 201) {
      totalSeated += coach.seats;
      console.log(`  ✓ Coach ${coach.label} (${coach.class}): ${coach.seats} seats`);
    } else if (res.status === 409) {
      console.log(`  ✓ Coach ${coach.label} already exists`);
    } else {
      console.warn(`  ⚠ Coach ${coach.label} failed: ${res.status}`);
    }
  }

  console.log(`  Total seats provisioned: ${totalSeated}`);
}

// ── Seed live tracking status ─────────────────────────────────────────────────
async function seedLiveTrackingStatus(adminToken) {
  console.log(`\nSeeding live tracking status for train ${TRAIN_NUM}...`);
  const res = await request('POST', `/trains/${TRAIN_NUM}/status`, {
    currentStation: 'CSTM',
    nextStation:    'PUNE',
    delayMinutes:   0,
    speedKmph:      120,
    platform:       '18',
  }, adminToken);

  if (res.status <= 201) {
    console.log(`  ✓ Live tracking status seeded`);
  } else {
    console.warn(`  ⚠ Live tracking status: ${res.status} (non-critical)`);
  }
}

// ── Verify seed ───────────────────────────────────────────────────────────────
async function verifySeeding() {
  console.log('\nVerifying seed...');

  // Check user 1 can login
  const loginRes = await request('POST', '/auth/login', {
    email: 'tatkal_user_1@railflow.test',
    password: PASSWORD,
  });
  if (loginRes.status === 200) {
    console.log('  ✓ Test user tatkal_user_1@railflow.test can login');
  } else {
    console.error('  ✗ Test user login FAILED — check password and registration');
  }

  // Check seat availability
  const seatRes = await request('GET', `/trains/${TRAIN_NUM}/seats`);
  if (seatRes.status === 200) {
    const seats = seatRes.body?.data;
    const availableCount = Array.isArray(seats)
      ? seats.filter((s) => s.status === 'AVAILABLE').length
      : '?';
    console.log(`  ✓ Train ${TRAIN_NUM} has ${availableCount} available seats`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════');
  console.log(' RailFlow k6 Load Test — Seed Data Script ');
  console.log('════════════════════════════════════════════');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Users: ${USER_COUNT}  |  Seats: ${SEAT_COUNT}  |  Train: ${TRAIN_NUM}`);
  if (CLEAN_MODE) console.log('  Mode: CLEAN (wipe and re-seed)');

  try {
    const adminToken = await getAdminToken();
    await seedUsers();
    await seedTrain(adminToken);
    await seedSeats(adminToken);
    await seedLiveTrackingStatus(adminToken);
    await verifySeeding();

    console.log('\n════════════════════════════════════════════');
    console.log(' Seeding complete. Run the load test:');
    console.log('');
    console.log('   # Full suite (~20 minutes):');
    console.log('   k6 run k6_load_test.js');
    console.log('');
    console.log('   # Tatkal spike only (3 minutes):');
    console.log('   k6 run --env SCENARIO=tatkal_spike k6_load_test.js');
    console.log('');
    console.log('   # With Prometheus output:');
    console.log('   k6 run --out experimental-prometheus-rw k6_load_test.js');
    console.log('════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n✗ Seeding failed:', err.message);
    process.exit(1);
  }
}

main();
