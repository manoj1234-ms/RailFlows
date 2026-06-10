import { Pool } from 'pg';

const migrations: { id: string; up: (pool: Pool) => Promise<void> }[] = [];

function register(id: string, up: (pool: Pool) => Promise<void>) {
  migrations.push({ id, up });
}

register('001_initial_schema', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL CHECK(role IN ('Guest','Passenger','Agent','Operator','Admin','Super Admin')),
      mfa_secret VARCHAR(255),
      mfa_enabled INTEGER DEFAULT 0,
      phone VARCHAR(20) UNIQUE,
      email_verified INTEGER DEFAULT 0,
      phone_verified INTEGER DEFAULT 0,
      verification_token VARCHAR(255),
      verification_expires TIMESTAMP,
      social_provider VARCHAR(50),
      social_id VARCHAR(255),
      name VARCHAR(255),
      refresh_token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('002_trains_and_bookings', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trains (
      id SERIAL PRIMARY KEY,
      train_number VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      from_station VARCHAR(255) NOT NULL,
      to_station VARCHAR(255) NOT NULL,
      departure_time VARCHAR(50) NOT NULL,
      arrival_time VARCHAR(50) NOT NULL,
      base_fare REAL NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      train_number VARCHAR(50) REFERENCES trains(train_number),
      pnr VARCHAR(50) UNIQUE NOT NULL,
      status VARCHAR(50) NOT NULL CHECK(status IN ('PENDING','CONFIRMED','CANCELLED','REFUNDED','RAC','WAITLIST')),
      price REAL NOT NULL,
      passengers TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('003_seats_and_queue', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seats (
      id SERIAL PRIMARY KEY,
      train_number VARCHAR(50) REFERENCES trains(train_number) ON DELETE CASCADE NOT NULL,
      coach_class VARCHAR(50) NOT NULL,
      coach_label VARCHAR(50) NOT NULL,
      seat_number INTEGER NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','LOCKED','BOOKED')),
      locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      lock_expires_at TIMESTAMP,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
      UNIQUE(train_number, coach_label, seat_number)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_tokens (
      token VARCHAR(255) PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      queue_position INTEGER NOT NULL,
      estimated_wait_seconds INTEGER NOT NULL,
      booking_window_expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('004_payments_notifications', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
      transaction_id VARCHAR(100) UNIQUE NOT NULL,
      amount REAL NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','SUCCESS','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
      idempotency_key VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL CHECK(type IN ('EMAIL','SMS','PUSH')),
      channel VARCHAR(255) NOT NULL,
      subject VARCHAR(255),
      body TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','SENT','FAILED','READ')),
      reference_type VARCHAR(50),
      reference_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('005_events_and_stations', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      code VARCHAR(10) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      zone VARCHAR(100) NOT NULL,
      latitude REAL NOT NULL DEFAULT 0,
      longitude REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50) NOT NULL CHECK(category IN ('CONCERT','SPORT','THEATRE','CONFERENCE','FESTIVAL','OTHER')),
      venue VARCHAR(255) NOT NULL,
      city VARCHAR(100) NOT NULL,
      description TEXT,
      date TIMESTAMP NOT NULL,
      door_open TIMESTAMP,
      base_price REAL NOT NULL,
      total_seats INTEGER NOT NULL,
      available_seats INTEGER NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD_OUT','CANCELLED','COMPLETED')),
      image_url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('006_refunds_and_devices', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refunds (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      reason VARCHAR(500),
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','APPROVED','PROCESSING','COMPLETED','REJECTED')),
      initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id VARCHAR(255) NOT NULL,
      device_name VARCHAR(255),
      refresh_token TEXT,
      refresh_token_expires_at TIMESTAMP,
      last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, device_id)
    );
  `);
});

register('007_account_lockout', async (pool) => {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP
  `);
});

register('008_loyalty_chatbot', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 0,
      lifetime_points INTEGER NOT NULL DEFAULT 0,
      tier VARCHAR(20) NOT NULL DEFAULT 'BRONZE'
        CHECK(tier IN ('BRONZE','SILVER','GOLD','PLATINUM')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL CHECK(type IN ('EARNED','REDEEMED','EXPIRED','BONUS')),
      description VARCHAR(500),
      reference_type VARCHAR(50),
      reference_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_rewards (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      points_required INTEGER NOT NULL,
      tier_required VARCHAR(20) NOT NULL DEFAULT 'BRONZE'
        CHECK(tier_required IN ('BRONZE','SILVER','GOLD','PLATINUM')),
      category VARCHAR(50),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatbot_training (
      id SERIAL PRIMARY KEY,
      intent VARCHAR(100) NOT NULL,
      pattern TEXT NOT NULL,
      response TEXT NOT NULL,
      context_required INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user ON loyalty_accounts(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_user ON loyalty_transactions(user_id, created_at)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chatbot_training_intent ON chatbot_training(intent, active)
  `);
});

register('009_refund_engine', async (pool) => {
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS risk_score REAL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS processing_eta_hours INTEGER DEFAULT 24
  `);
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS gateway_response VARCHAR(500)
  `);
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS gateway_retry_count INTEGER DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id)
  `);
  await pool.query(`
    ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_pct REAL
  `);
});

register('010_queue_concurrency', async (pool) => {
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS queue_position_seq START WITH 1;
  `);
  await pool.query(`
    SELECT setval('queue_position_seq', COALESCE((SELECT MAX(queue_position) FROM queue_tokens), 0) + 1, false);
  `);
});

register('011_aadhaar_auth', async (pool) => {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhaar VARCHAR(20) UNIQUE;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhaar_verified INTEGER DEFAULT 0;
  `);
});

register('012_otp_storage', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_otps (
      key VARCHAR(255) PRIMARY KEY,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL
    );
  `);
});

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const migration of migrations) {
    const exists = await pool.query(
      'SELECT id FROM schema_migrations WHERE id = $1',
      [migration.id]
    );
    if (exists.rowCount === 0) {
      console.log(`[Migration] Applying ${migration.id}...`);
      await migration.up(pool);
      await pool.query(
        'INSERT INTO schema_migrations (id) VALUES ($1)',
        [migration.id]
      );
      console.log(`[Migration] ${migration.id} applied.`);
    }
  }

  await createIndexes(pool);
}

async function createIndexes(pool: Pool) {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_pnr ON bookings(pnr)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)',
    'CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_seats_train_number ON seats(train_number)',
    'CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status)',
    'CREATE INDEX IF NOT EXISTS idx_seats_lock ON seats(locked_by, lock_expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)',
    'CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds(booking_id)',
    'CREATE INDEX IF NOT EXISTS idx_refunds_user_id ON refunds(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_queue_tokens_user_id ON queue_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_queue_tokens_window ON queue_tokens(booking_window_expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor, action)',
    'CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id)',
  ];
  for (const idx of indexes) {
    await pool.query(idx);
  }
}
