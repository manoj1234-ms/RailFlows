import { getDb, initDb } from '../config/db';
import bcrypt from 'bcryptjs';

const BASE_URL = 'http://localhost:5000/api/v1';
const ROOT_URL = 'http://localhost:5000';

interface CsrfDetails {
  cookie: string;
  token: string;
}

async function getCsrfToken(): Promise<CsrfDetails> {
  const response = await fetch(`${ROOT_URL}/`);
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Failed to get CSRF cookie from server');
  }
  const match = setCookie.match(/csrfToken=([^;]+)/);
  if (!match) {
    throw new Error('Failed to parse csrfToken from set-cookie');
  }
  return {
    cookie: `csrfToken=${match[1]}`,
    token: match[1],
  };
}

async function setupTestUsers(count: number): Promise<string[]> {
  const db = await getDb();
  const emails: string[] = [];
  const hashedPwd = await bcrypt.hash('password123', 10);

  console.log(`[Load Test Setup] Pre-seeding ${count} test users in database...`);
  await db.run('DELETE FROM users WHERE email LIKE ?', ['loadtest_%']);
  
  for (let i = 1; i <= count; i++) {
    const email = `loadtest_user_${i}_${Date.now()}@railflow.com`;
    await db.run(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [email, hashedPwd, 'Passenger']
    );
    emails.push(email);
  }
  
  console.log(`[Load Test Setup] Pre-seeded ${count} test users.`);
  return emails;
}

async function runSimulation() {
  await initDb();
  const db = await getDb();

  // Clear existing queue tokens to start clean
  await db.run('DELETE FROM queue_tokens');
  // Reset sequence to starting value
  await db.run("SELECT setval('queue_position_seq', 1, false)");
  
  const userCount = 50;
  const emails = await setupTestUsers(userCount);

  // Get initial CSRF details for logins
  const csrf = await getCsrfToken();

  console.log(`\n[Load Test] Logging in ${userCount} users concurrently with CSRF tokens...`);
  const authHeaders = await Promise.all(
    emails.map(async (email) => {
      try {
        const response = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': csrf.cookie,
            'x-csrf-token': csrf.token,
          },
          body: JSON.stringify({ email, password: 'password123' }),
        });
        const data: any = await response.json();
        
        // Login updates cookies, we must capture the new session cookies (e.g. accessToken)
        const resCookies = response.headers.getSetCookie();
        const cookiesList = [csrf.cookie];
        resCookies.forEach((c) => {
          const m = c.match(/^([^=]+=[^;]+)/);
          if (m) cookiesList.push(m[1]);
        });

        if (data.status === 'success') {
          return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.accessToken}`,
            'Cookie': cookiesList.join('; '),
            'x-csrf-token': csrf.token,
          };
        }
        throw new Error(data.message);
      } catch (err: any) {
        console.error(`Login failed for ${email}:`, err.message);
        return null;
      }
    })
  );

  const activeHeaders = authHeaders.filter((h) => h !== null) as Record<string, string>[];
  console.log(`[Load Test] Successful logins: ${activeHeaders.length}/${userCount}`);

  if (activeHeaders.length === 0) {
    console.error('All logins failed. Aborting.');
    return;
  }

  console.log(`\n[Load Test] STEP 1: Simulating ${activeHeaders.length} users concurrently joining the virtual queue...`);
  const joinStart = Date.now();
  const joinResults = await Promise.all(
    activeHeaders.map(async (headers, index) => {
      try {
        const response = await fetch(`${BASE_URL}/queue/join`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ deviceFingerprint: `loadtest-fingerprint-device-${index}` }),
        });
        const data: any = await response.json();
        return { success: response.ok, status: response.status, data };
      } catch (err: any) {
        return { success: false, status: 500, error: err.message };
      }
    })
  );
  const joinEnd = Date.now();
  console.log(`[Load Test] Joined queue in ${joinEnd - joinStart}ms.`);

  // Analyze queue positions for collisions
  const queuePositions: number[] = [];
  let joinSuccesses = 0;
  joinResults.forEach((res) => {
    if (res.success && res.data?.status === 'success') {
      joinSuccesses++;
      queuePositions.push(res.data.data.originalPosition);
    }
  });

  console.log(`[Load Test] Queue Join success rate: ${joinSuccesses}/${activeHeaders.length}`);
  console.log(`[Load Test] Assigned Queue Positions:`, queuePositions.sort((a, b) => a - b));

  // Check for duplicate queue positions (concurrency race conditions check)
  const uniquePositions = new Set(queuePositions);
  const positionCollisions = queuePositions.length - uniquePositions.size;
  if (positionCollisions > 0) {
    console.warn(`\n[CONCURRENCY WARNING] Found ${positionCollisions} queue position collisions! Multiple users got the same queue position.`);
  } else {
    console.log(`\n[CONCURRENCY SUCCESS] All assigned queue positions are strictly unique! No collisions.`);
  }

  console.log(`\n[Load Test] STEP 2: Simulating polling queue status until window opens...`);
  const pollingResults = await Promise.all(
    activeHeaders.map(async (headers, index) => {
      const joinData = joinResults[index].data?.data;
      if (!joinData) return { success: false, message: 'No join data' };

      const token = joinData.token;
      const deviceFingerprint = `loadtest-fingerprint-device-${index}`;
      
      let position = joinData.currentPosition;
      let attempts = 0;
      const startTime = Date.now();

      while (position > 0 && attempts < 20) {
        attempts++;
        try {
          const response = await fetch(
            `${BASE_URL}/queue/status?token=${token}&deviceFingerprint=${deviceFingerprint}`,
            { method: 'GET', headers }
          );
          const data: any = await response.json();
          if (data.status === 'success') {
            position = data.data.currentPosition;
          } else {
            return { success: false, message: data.message };
          }
        } catch (err: any) {
          // ignore transient poll errors
        }
        await new Promise((r) => setTimeout(r, 500)); // poll every 500ms
      }

      return {
        success: position === 0,
        attempts,
        durationMs: Date.now() - startTime,
      };
    })
  );

  let pollingSuccesses = 0;
  pollingResults.forEach((res: any) => {
    if (res.success) pollingSuccesses++;
  });
  console.log(`[Load Test] Users who reached front of queue (position 0): ${pollingSuccesses}/${activeHeaders.length}`);

  console.log(`\n[Load Test] STEP 3: Simulating concurrent seat locking for seat 12951-B1-7...`);
  console.log(`[Load Test] (Multiple concurrent users will attempt to lock the EXACT same seat to verify isolation)`);

  const lockStart = Date.now();
  const lockResults = await Promise.all(
    activeHeaders.map(async (headers) => {
      try {
        const response = await fetch(`${BASE_URL}/bookings/lock`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            trainNumber: '12951',
            coachLabel: 'B1',
            seatNumbers: [7],
          }),
        });
        const data: any = await response.json();
        return { success: response.ok, status: response.status, data };
      } catch (err: any) {
        return { success: false, status: 500, error: err.message };
      }
    })
  );
  const lockEnd = Date.now();
  console.log(`[Load Test] Lock operations completed in ${lockEnd - lockStart}ms.`);

  let lockSuccesses = 0;
  let lockConflicts = 0;
  let lockAccessDenied = 0;

  lockResults.forEach((res) => {
    if (res.status === 200) {
      lockSuccesses++;
    } else if (res.status === 409) {
      lockConflicts++;
    } else if (res.status === 403) {
      lockAccessDenied++;
    }
  });

  console.log(`\n==================================================`);
  console.log(`               SIMULATION RESULTS                 `);
  console.log(`==================================================`);
  console.log(`Total Virtual Users (VUs) Simulated : ${userCount}`);
  console.log(`Queue Join Requests                : ${joinSuccesses}/${activeHeaders.length}`);
  console.log(`Queue Position Collisions           : ${positionCollisions}`);
  console.log(`Users Reaching Position 0          : ${pollingSuccesses}`);
  console.log(`Seat Lock Successes                 : ${lockSuccesses} (Must be exactly <= 1)`);
  console.log(`Seat Lock Conflict (409)            : ${lockConflicts} (Prevented double booking)`);
  console.log(`Access Denied (403 - no queue window): ${lockAccessDenied}`);
  console.log(`==================================================`);

  if (lockSuccesses > 1) {
    console.error(`[CRITICAL FAILURE] Double booking allowed! ${lockSuccesses} users successfully locked the same seat!`);
  } else {
    console.log(`[SUCCESS] Mutual exclusion preserved. Seat double booking is 100% prevented.`);
  }

  // Cleanup pre-seeded test users
  console.log(`\n[Load Test Cleanup] Cleaning up pre-seeded test users...`);
  await db.run('DELETE FROM users WHERE email LIKE ?', ['loadtest_%']);
  await db.run('DELETE FROM queue_tokens');
  console.log(`[Load Test Cleanup] Complete.`);
}

runSimulation()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Simulation crashed with error:', err);
    process.exit(1);
  });
