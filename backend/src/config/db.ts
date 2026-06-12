import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool: pg.Pool;

function translateQuery(sql: string): string {
  let pgSql = sql;
  
  // Convert SQLite function datetime('now') -> NOW()
  pgSql = pgSql.replace(/datetime\('now'\)/gi, 'NOW()');
  // Convert SQLite function datetime(col) -> col
  pgSql = pgSql.replace(/datetime\(([^)]+)\)/gi, '$1');
  
  // Convert ? placeholder to $1, $2, $3...
  let index = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${index++}`);
  
  return pgSql;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'railflow',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function getDb() {
  const p = getPool();
  
  return {
    async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
      const pgSql = translateQuery(sql);
      const res = await p.query(pgSql, params);
      return res.rows[0];
    },
    async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const pgSql = translateQuery(sql);
      const res = await p.query(pgSql, params);
      return res.rows;
    },

    async run(sql: string, params: any[] = []): Promise<{ changes: number; lastID?: number }> {
      let pgSql = translateQuery(sql);
      const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
      const hasReturning = pgSql.toUpperCase().includes('RETURNING');
      if (isInsert && !hasReturning) {
        pgSql += ' RETURNING *';
      }

      const res = await p.query(pgSql, params);
      const lastID = isInsert && res.rows[0]?.id ? Number(res.rows[0].id) : undefined;
      return {
        changes: res.rowCount ?? 0,
        lastID,
      };
    },

    async exec(sql: string): Promise<void> {
      const pgSql = translateQuery(sql);
      await p.query(pgSql);
    }
  };
}

export async function initDb() {
  const bootPool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: 'postgres',
    max: 1,
  });
  
  try {
    const dbCheck = await bootPool.query("SELECT 1 FROM pg_database WHERE datname = 'railflow'");
    if (dbCheck.rowCount === 0) {
      console.log("Database 'railflow' does not exist. Creating database...");
      await bootPool.query("CREATE DATABASE railflow");
      console.log("Database 'railflow' created successfully.");
    }
  } catch (e: any) {
    console.error("Warning during database presence check:", e.message);
  } finally {
    await bootPool.end();
  }

  const p = getPool();

  // Add columns that may not exist if the table was created before PRD v2 schema update
  // These are safe ALTER TABLE ADD COLUMN IF NOT EXISTS operations (PG 9.6+)
  const columnMigrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS social_provider VARCHAR(50)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS social_id VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel VARCHAR(255)`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255)`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_payment_id VARCHAR(100)`,
  ];
  for (const cmd of columnMigrations) {
    try { await p.query(cmd); } catch { }
  }

  try {
    await seedData();
  } catch (e: any) {
    console.warn('[DB] Seed data failed (non-fatal):', e.message);
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    console.log('Database pool closed.');
  }
}

async function seedData() {
  const p = getPool();

  // Seed users
  try {
    const userCountRes = await p.query('SELECT COUNT(*) as count FROM users');
    const userCount = Number(userCountRes.rows[0].count);
    if (userCount === 0) {
      console.log('Seeding initial users into PostgreSQL...');
      const hashedPwd = await bcrypt.hash('password123', 10);
      await p.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', ['admin@railflow.com', hashedPwd, 'Admin']);
      await p.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', ['superadmin@railflow.com', hashedPwd, 'Super Admin']);
      await p.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id', ['passenger@railflow.com', hashedPwd, 'Passenger']);
    }
  } catch (e: any) { console.warn('[Seed] users skipped:', e.message); }

  // Seed wallets
  try {
    const walletCountRes = await p.query('SELECT COUNT(*) as count FROM wallets');
    if (Number(walletCountRes.rows[0].count) === 0) {
      const passengerExists = await p.query("SELECT id FROM users WHERE email = 'passenger@railflow.com'");
      if (passengerExists.rows[0]?.id) {
        const uid = passengerExists.rows[0].id;
        await p.query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [uid, 500.0]);
        await p.query(
          'INSERT INTO wallet_transactions (wallet_id, type, amount, description) VALUES ((SELECT id FROM wallets WHERE user_id = $1), $2, $3, $4)',
          [uid, 'CREDIT', 500.0, 'Welcome bonus']
        );
      }
    }
  } catch (e: any) { console.warn('[Seed] wallets skipped (table may not exist):', e.message); }

  // Seed trains and seats
  try {
    const trainCountRes = await p.query('SELECT COUNT(*) as count FROM trains');
    if (Number(trainCountRes.rows[0].count) === 0) {
      console.log('Seeding initial trains and seats into PostgreSQL...');
      const trainsToSeed = [
        { train_number: '12951', name: 'Mumbai Rajdhani Express', from_station: 'Mumbai Central (MMCT)', to_station: 'New Delhi (NDLS)', departure_time: '17:00', arrival_time: '08:30', base_fare: 2200.0 },
        { train_number: '12626', name: 'Kerala Express', from_station: 'New Delhi (NDLS)', to_station: 'Trivandrum Central (TVC)', departure_time: '20:10', arrival_time: '21:50', base_fare: 950.0 },
        { train_number: '22691', name: 'Rajdhani Express', from_station: 'Bangalore City (SBC)', to_station: 'Hazrat Nizamuddin (NZM)', departure_time: '20:00', arrival_time: '05:55', base_fare: 2400.0 },
      ];
      for (const t of trainsToSeed) {
        await p.query(
          `INSERT INTO trains (train_number, name, from_station, to_station, departure_time, arrival_time, base_fare) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [t.train_number, t.name, t.from_station, t.to_station, t.departure_time, t.arrival_time, t.base_fare]
        );
        const coachConfigs = [
          { coach_class: '1A', coach_label: 'A1', seat_count: 9 },
          { coach_class: '3A', coach_label: 'B1', seat_count: 18 },
          { coach_class: 'SL', coach_label: 'S1', seat_count: 18 },
        ];
        for (const config of coachConfigs) {
          for (let i = 1; i <= config.seat_count; i++) {
            await p.query(
              `INSERT INTO seats (train_number, coach_class, coach_label, seat_number, status) VALUES ($1, $2, $3, $4, 'AVAILABLE')`,
              [t.train_number, config.coach_class, config.coach_label, i]
            );
          }
        }
      }
    }
  } catch (e: any) { console.warn('[Seed] trains/seats skipped:', e.message); }

  // Seed a sample booking
  try {
    const bookingCountRes = await p.query('SELECT COUNT(*) as count FROM bookings');
    if (Number(bookingCountRes.rows[0].count) === 0) {
      const passengerExists = await p.query("SELECT id FROM users WHERE email = 'passenger@railflow.com'");
      const trainExists = await p.query("SELECT 1 FROM trains WHERE train_number = '12951'");
      const uid = passengerExists.rows[0]?.id;
      if (uid && trainExists.rowCount && trainExists.rowCount > 0) {
        const bookingPnr = Math.floor(1000000000 + Math.random() * 9000000000).toString();
        const bookingRes = await p.query(
          `INSERT INTO bookings (user_id, train_number, pnr, status, price, passengers) VALUES ($1, $2, $3, 'CONFIRMED', $4, $5) RETURNING id`,
          [uid, '12951', bookingPnr, 2200.0, JSON.stringify([{ name: 'John Doe', age: 30, gender: 'M', aadhaar: '123412341234' }, { name: 'Jane Doe', age: 28, gender: 'F', aadhaar: '567856785678' }])]
        );
        const bookingId = bookingRes.rows[0]?.id;
        if (bookingId) {
          await p.query(
            `INSERT INTO payments (user_id, booking_id, transaction_id, amount, payment_method, status) VALUES ($1, $2, $3, $4, $5, 'SUCCESS')`,
            [uid, bookingId, 'TXN' + Date.now() + 'SEED', 2200.0, 'UPI']
          );
          await p.query(
            `UPDATE seats SET status = 'BOOKED', booking_id = $1 WHERE train_number = $2 AND coach_label = $3 AND seat_number IN (1, 2)`,
            [bookingId, '12951', 'A1']
          );
        }
      }
    }
  } catch (e: any) { console.warn('[Seed] sample booking skipped:', e.message); }

  // Seed stations
  try {
    const stationCountRes = await p.query('SELECT COUNT(*) as count FROM stations');
    if (Number(stationCountRes.rows[0].count) === 0) {
      console.log('Seeding stations into PostgreSQL...');
      const stations = [
        { code: 'NDLS', name: 'New Delhi Railway Station', city: 'Delhi', state: 'Delhi', zone: 'Northern Railway', lat: 28.6417, lng: 77.2200 },
        { code: 'MMCT', name: 'Mumbai Central', city: 'Mumbai', state: 'Maharashtra', zone: 'Western Railway', lat: 18.9696, lng: 72.8194 },
        { code: 'TVC', name: 'Thiruvananthapuram Central', city: 'Thiruvananthapuram', state: 'Kerala', zone: 'Southern Railway', lat: 8.4875, lng: 76.9525 },
        { code: 'SBC', name: 'KSR Bengaluru City Junction', city: 'Bengaluru', state: 'Karnataka', zone: 'South Western Railway', lat: 12.9783, lng: 77.5713 },
        { code: 'NZM', name: 'Hazrat Nizamuddin', city: 'Delhi', state: 'Delhi', zone: 'Northern Railway', lat: 28.5913, lng: 77.2507 },
        { code: 'BCT', name: 'Mumbai Central (Churchgate)', city: 'Mumbai', state: 'Maharashtra', zone: 'Western Railway', lat: 18.9400, lng: 72.8300 },
        { code: 'ADI', name: 'Ahmedabad Junction', city: 'Ahmedabad', state: 'Gujarat', zone: 'Western Railway', lat: 23.0225, lng: 72.5714 },
        { code: 'MAS', name: 'Chennai Central', city: 'Chennai', state: 'Tamil Nadu', zone: 'Southern Railway', lat: 13.0827, lng: 80.2750 },
        { code: 'HWH', name: 'Howrah Junction', city: 'Kolkata', state: 'West Bengal', zone: 'Eastern Railway', lat: 22.5851, lng: 88.3426 },
        { code: 'PNBE', name: 'Patna Junction', city: 'Patna', state: 'Bihar', zone: 'East Central Railway', lat: 25.6180, lng: 85.1390 },
        { code: 'LKO', name: 'Lucknow Charbagh', city: 'Lucknow', state: 'Uttar Pradesh', zone: 'Northern Railway', lat: 26.8300, lng: 80.9200 },
        { code: 'BPL', name: 'Bhopal Junction', city: 'Bhopal', state: 'Madhya Pradesh', zone: 'West Central Railway', lat: 23.2700, lng: 77.4100 },
        { code: 'JP', name: 'Jaipur Junction', city: 'Jaipur', state: 'Rajasthan', zone: 'North Western Railway', lat: 26.9200, lng: 75.7900 },
        { code: 'VGLJ', name: 'Vagatoria (Gwalior)', city: 'Gwalior', state: 'Madhya Pradesh', zone: 'North Central Railway', lat: 26.2200, lng: 78.1800 },
        { code: 'BRC', name: 'Vadodara Junction', city: 'Vadodara', state: 'Gujarat', zone: 'Western Railway', lat: 22.3100, lng: 73.1800 },
        { code: 'ST', name: 'Surat', city: 'Surat', state: 'Gujarat', zone: 'Western Railway', lat: 21.2100, lng: 72.8400 },
        { code: 'NGP', name: 'Nagpur Junction', city: 'Nagpur', state: 'Maharashtra', zone: 'Central Railway', lat: 21.1500, lng: 79.0900 },
        { code: 'KRNT', name: 'Kurnool City', city: 'Kurnool', state: 'Andhra Pradesh', zone: 'South Central Railway', lat: 15.8300, lng: 78.0500 },
      ];
      for (const s of stations) {
        await p.query(
          `INSERT INTO stations (code, name, city, state, zone, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING`,
          [s.code, s.name, s.city, s.state, s.zone, s.lat, s.lng]
        );
      }
    }
  } catch (e: any) { console.warn('[Seed] stations skipped:', e.message); }

  // Seed train routes
  try {
    const routeCountRes = await p.query('SELECT COUNT(*) as count FROM train_routes');
    if (Number(routeCountRes.rows[0].count) === 0) {
      console.log('Seeding train routes into PostgreSQL...');
      const allRoutes: { train: string; stops: { stop: number; station: string; arrival: string | null; departure: string | null; dist: number; day: number }[] }[] = [
        { train: '12951', stops: [
          { stop: 1, station: 'MMCT', arrival: null, departure: '17:00', dist: 0, day: 1 },
          { stop: 2, station: 'BCT', arrival: '17:15', departure: '17:20', dist: 5, day: 1 },
          { stop: 3, station: 'ST', arrival: '19:35', departure: '19:40', dist: 265, day: 1 },
          { stop: 4, station: 'BRC', arrival: '21:20', departure: '21:25', dist: 392, day: 1 },
          { stop: 5, station: 'BPL', arrival: '02:00', departure: '02:10', dist: 827, day: 2 },
          { stop: 6, station: 'VGLJ', arrival: '04:20', departure: '04:22', dist: 1052, day: 2 },
          { stop: 7, station: 'NDLS', arrival: '08:30', departure: null, dist: 1384, day: 2 },
        ]},
        { train: '12626', stops: [
          { stop: 1, station: 'NDLS', arrival: null, departure: '20:10', dist: 0, day: 1 },
          { stop: 2, station: 'LKO', arrival: '01:55', departure: '02:05', dist: 497, day: 2 },
          { stop: 3, station: 'PNBE', arrival: '06:50', departure: '07:00', dist: 990, day: 2 },
          { stop: 4, station: 'NGP', arrival: '15:20', departure: '15:30', dist: 1765, day: 2 },
          { stop: 5, station: 'KRNT', arrival: '21:10', departure: '21:12', dist: 2096, day: 2 },
          { stop: 6, station: 'MAS', arrival: '04:30', departure: '04:55', dist: 2491, day: 3 },
          { stop: 7, station: 'TVC', arrival: '21:50', departure: null, dist: 3184, day: 3 },
        ]},
        { train: '22691', stops: [
          { stop: 1, station: 'SBC', arrival: null, departure: '20:00', dist: 0, day: 1 },
          { stop: 2, station: 'KRNT', arrival: '23:10', departure: '23:12', dist: 367, day: 1 },
          { stop: 3, station: 'NGP', arrival: '03:30', departure: '03:40', dist: 1053, day: 2 },
          { stop: 4, station: 'BPL', arrival: '07:50', departure: '07:55', dist: 1595, day: 2 },
          { stop: 5, station: 'VGLJ', arrival: '10:20', departure: '10:22', dist: 1913, day: 2 },
          { stop: 6, station: 'NZM', arrival: '05:55', departure: null, dist: 2364, day: 2 },
        ]},
      ];
      for (const route of allRoutes) {
        for (const r of route.stops) {
          await p.query(
            `INSERT INTO train_routes (train_number, station_code, stop_number, arrival_time, departure_time, distance_km, day_count) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [route.train, r.station, r.stop, r.arrival, r.departure, r.dist, r.day]
          );
        }
      }
      // Platform numbers
      await p.query("UPDATE train_routes SET platform = '3' WHERE train_number = '12951' AND station_code = 'MMCT' AND platform IS NULL");
      await p.query("UPDATE train_routes SET platform = '2' WHERE train_number = '12951' AND station_code = 'NDLS' AND platform IS NULL");
      await p.query("UPDATE train_routes SET platform = '1' WHERE train_number = '12626' AND station_code = 'NDLS' AND platform IS NULL");
      await p.query("UPDATE train_routes SET platform = '4' WHERE train_number = '12626' AND station_code = 'TVC' AND platform IS NULL");
      await p.query("UPDATE train_routes SET platform = '5' WHERE train_number = '22691' AND station_code = 'SBC' AND platform IS NULL");
      await p.query("UPDATE train_routes SET platform = '3' WHERE train_number = '22691' AND station_code = 'NZM' AND platform IS NULL");
    }
  } catch (e: any) { console.warn('[Seed] train_routes skipped (table may not exist):', e.message); }

  // Seed events and event seats
  try {
    const eventCountRes = await p.query('SELECT COUNT(*) as count FROM events');
    if (Number(eventCountRes.rows[0].count) === 0) {
      console.log('Seeding events into PostgreSQL...');
      const events = [
        { name: 'A.R. Rahman Live in Concert', category: 'CONCERT', venue: 'Jawaharlal Nehru Stadium', city: 'Delhi', description: 'Experience the magic of A.R. Rahman live', date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), base_price: 1500, total_seats: 200, available_seats: 200 },
        { name: 'IPL Final 2026', category: 'SPORT', venue: 'Wankhede Stadium', city: 'Mumbai', description: 'IPL 2026 Grand Finale', date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), base_price: 5000, total_seats: 500, available_seats: 500 },
        { name: 'Shakespeare in the Park', category: 'THEATRE', venue: 'Central Park', city: 'Bengaluru', description: "A Midsummer Night's Dream", date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), base_price: 800, total_seats: 100, available_seats: 100 },
      ];
      for (const e of events) {
        const eventRes = await p.query(
          `INSERT INTO events (name, category, venue, city, description, date, base_price, total_seats, available_seats, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE') RETURNING id`,
          [e.name, e.category, e.venue, e.city, e.description, e.date, e.base_price, e.total_seats, e.available_seats]
        );
        const eventId = eventRes.rows[0]?.id;
        if (eventId) {
          const sections = ['VIP', 'GOLD', 'SILVER'];
          const prices = [e.base_price * 2, e.base_price, e.base_price * 0.6];
          const rows = ['A', 'B', 'C', 'D', 'E'];
          for (let si = 0; si < sections.length; si++) {
            for (const row of rows) {
              const seatsPerRow = si === 0 ? 8 : 12;
              for (let sn = 1; sn <= seatsPerRow; sn++) {
                await p.query(
                  `INSERT INTO event_seats (event_id, section, row_label, seat_number, price, status) VALUES ($1, $2, $3, $4, $5, 'AVAILABLE')`,
                  [eventId, sections[si], row, sn, prices[si]]
                );
              }
            }
          }
        }
      }
    }
  } catch (e: any) { console.warn('[Seed] events/event_seats skipped (table may not exist):', e.message); }

  // Seed coupons
  try {
    const couponCountRes = await p.query('SELECT COUNT(*) as count FROM coupons');
    if (Number(couponCountRes.rows[0].count) === 0) {
      console.log('Seeding coupons...');
      await p.query(`INSERT INTO coupons (code, discount_percent, discount_max_amount, min_cart_value, usage_limit, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
        ['WELCOME10', 10, 100, 500, 1000, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()]);
      await p.query(`INSERT INTO coupons (code, discount_percent, discount_max_amount, min_cart_value, usage_limit, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')`,
        ['FLAT50', 0, 50, 300, 500, new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()]);
    }
  } catch (e: any) { console.warn('[Seed] coupons skipped (table may not exist):', e.message); }

  // Seed train coaches
  try {
    const coachCountRes = await p.query('SELECT COUNT(*) as count FROM train_coaches');
    if (Number(coachCountRes.rows[0].count) === 0) {
      console.log('Seeding train coach composition...');
      const coachData = [
        { train: '12951', coaches: [{ class: '1A', label: 'A1', pos: 1, seats: 9 }, { class: '3A', label: 'B1', pos: 2, seats: 18 }, { class: 'SL', label: 'S1', pos: 3, seats: 18 }] },
        { train: '12626', coaches: [{ class: '1A', label: 'A1', pos: 1, seats: 9 }, { class: '3A', label: 'B1', pos: 2, seats: 18 }, { class: 'SL', label: 'S1', pos: 3, seats: 18 }] },
        { train: '22691', coaches: [{ class: '1A', label: 'A1', pos: 1, seats: 9 }, { class: '3A', label: 'B1', pos: 2, seats: 18 }, { class: 'SL', label: 'S1', pos: 3, seats: 18 }] },
      ];
      for (const tc of coachData) {
        for (const c of tc.coaches) {
          await p.query(`INSERT INTO train_coaches (train_number, coach_class, coach_label, position_from_engine, total_seats) VALUES ($1, $2, $3, $4, $5)`,
            [tc.train, c.class, c.label, c.pos, c.seats]);
        }
      }
    }
  } catch (e: any) { console.warn('[Seed] train_coaches skipped (table may not exist):', e.message); }

  // Seed live train status
  try {
    const liveCountRes = await p.query('SELECT COUNT(*) as count FROM live_train_status');
    if (Number(liveCountRes.rows[0].count) === 0) {
      console.log('Seeding live train status...');
      await p.query(`INSERT INTO live_train_status (train_number, current_station, status, delay_minutes, speed_kmh, next_station, expected_arrival) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 hour')`, ['12951', 'ST', 'DEPARTED', 0, 95, 'BRC']);
      await p.query(`INSERT INTO live_train_status (train_number, current_station, status, delay_minutes, speed_kmh, next_station, expected_arrival) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '2 hours')`, ['12626', 'PNBE', 'DEPARTED', 15, 80, 'NGP']);
      await p.query(`INSERT INTO live_train_status (train_number, current_station, status, delay_minutes, speed_kmh, next_station, expected_arrival) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '3 hours')`, ['22691', 'SBC', 'ON_TIME', 0, 110, 'KRNT']);
    }
  } catch (e: any) { console.warn('[Seed] live_train_status skipped (table may not exist):', e.message); }
}
