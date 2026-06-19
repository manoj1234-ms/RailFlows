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

register('013_bookings_partitioning', async (pool) => {
  /**
   * Partition the bookings table by RANGE on created_at (monthly).
   *
   * Strategy: We CANNOT convert an existing non-partitioned table in-place.
   * Instead we:
   *   1. Rename the existing table to bookings_legacy
   *   2. Create a new partitioned parent table
   *   3. Create an initial "catch-all" partition covering the epoch → now + 2 years
   *   4. Copy data from legacy to new partitioned table
   *   5. Drop legacy (safe to skip if data migration should happen offline)
   *
   * Monthly child partitions are created by a scheduled job (see cron note below).
   * For production, use pg_partman to manage child partition lifecycle automatically.
   */
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'bookings_partitioned'
    ) AS already_done
  `);

  if (rows[0].already_done) return; // idempotent guard

  // Step 1: Create new partitioned parent table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings_partitioned (
      id           SERIAL,
      user_id      INTEGER NOT NULL,
      train_number VARCHAR(50),
      pnr          VARCHAR(50) NOT NULL,
      status       VARCHAR(50) NOT NULL,
      price        REAL NOT NULL,
      passengers   TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);
  `);

  // Step 2: Create initial catch-all partition (current year + next 2 years)
  const currentYear = new Date().getFullYear();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings_p_${currentYear}
    PARTITION OF bookings_partitioned
    FOR VALUES FROM ('${currentYear}-01-01') TO ('${currentYear + 3}-01-01');
  `);

  // Step 3: Copy existing data (non-blocking – ignore if source is empty)
  await pool.query(`
    INSERT INTO bookings_partitioned (id, user_id, train_number, pnr, status, price, passengers, created_at)
    SELECT id, user_id, train_number, pnr, status, price, passengers, created_at
    FROM bookings
    ON CONFLICT DO NOTHING
  `);

  // Step 4: Composite indexes on the partitioned table for query patterns
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bkp_user_created
      ON bookings_partitioned(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bkp_pnr
      ON bookings_partitioned(pnr)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bkp_status_created
      ON bookings_partitioned(status, created_at DESC)
  `);

  // NOTE: To fully cut over, run in a maintenance window:
  //   ALTER TABLE bookings RENAME TO bookings_legacy;
  //   ALTER TABLE bookings_partitioned RENAME TO bookings;
  // Then update FK references accordingly. This migration prepares
  // the shadow table so DBA can validate before promoting.
});

register('014_audit_logs_partitioning', async (pool) => {
  /**
   * audit_logs grows unboundedly. Partition by RANGE on created_at (yearly)
   * and add BRIN index (cheap, suitable for append-only time-series).
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
      id         BIGSERIAL,
      actor      INTEGER,
      action     VARCHAR(100) NOT NULL,
      target     VARCHAR(255),
      details    JSONB,
      ip         VARCHAR(45),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, created_at)
    ) PARTITION BY RANGE (created_at);
  `);

  const year = new Date().getFullYear();
  for (let y = year; y <= year + 2; y++) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs_p_${y}
      PARTITION OF audit_logs_partitioned
      FOR VALUES FROM ('${y}-01-01') TO ('${y + 1}-01-01');
    `);
  }

  // BRIN is extremely compact for monotonically-growing timestamps
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_brin_created
      ON audit_logs_partitioned USING BRIN (created_at)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_actor_action
      ON audit_logs_partitioned(actor, action)
  `);
});

register('015_pgpartman_setup', async (pool) => {
  /**
   * pg_partman — automatic child-partition creation and maintenance.
   *
   * This migration is best-effort: pg_partman requires a superuser to
   * CREATE EXTENSION and may not be available on all hosted Postgres providers.
   * If it's unavailable, the Node.js partition-maintainer.service.ts takes over.
   *
   * If pg_partman IS available, register both partitioned tables so that
   * pg_partman's run_maintenance() (called via pg_cron or manually) creates
   * monthly bookings partitions and yearly audit_log partitions automatically.
   */
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman`);

    // Register bookings_partitioned: monthly, keep 36 months of history
    await pool.query(`
      SELECT partman.create_parent(
        p_parent_table   => 'public.bookings_partitioned',
        p_control        => 'created_at',
        p_type           => 'range',
        p_interval       => '1 month',
        p_premake        => 3
      )
    `);

    // Register audit_logs_partitioned: yearly, keep 2 years
    await pool.query(`
      SELECT partman.create_parent(
        p_parent_table   => 'public.audit_logs_partitioned',
        p_control        => 'created_at',
        p_type           => 'range',
        p_interval       => '1 year',
        p_premake        => 2
      )
    `);

    // Set retention policies via pg_partman config table
    await pool.query(`
      UPDATE partman.part_config
        SET retention = '36 months', retention_keep_table = false
      WHERE parent_table = 'public.bookings_partitioned'
    `);
    await pool.query(`
      UPDATE partman.part_config
        SET retention = '2 years', retention_keep_table = true
      WHERE parent_table = 'public.audit_logs_partitioned'
    `);

    console.log('[Migration 015] pg_partman registered for bookings_partitioned and audit_logs_partitioned');
  } catch (err: any) {
    // pg_partman not available — partition-maintainer.service.ts handles this
    console.warn(`[Migration 015] pg_partman not available (${err.message}). Falling back to Node.js partition maintainer.`);
  }
});

register('016_notification_retry', async (pool) => {
  /**
   * Delivery receipt tracking for the notification retry engine.
   * - retry_count:   how many send attempts have been made
   * - next_retry_at: when the next retry should run (NULL = not scheduled)
   * - delivered_at:  set by provider webhook when delivery confirmed
   */
  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ
  `);
  // Index for the retry worker: pick up failed notifications due for retry
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_retry
      ON notifications(status, next_retry_at)
      WHERE status = 'FAILED'
  `);
});

register('017_aadhaar_consent', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aadhaar_consents (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      pnr        VARCHAR(50) NOT NULL,
      purpose    VARCHAR(255) NOT NULL,
      ip_address VARCHAR(45) NOT NULL,
      consent_given BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
});

register('018_create_missing_tables', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      ip VARCHAR(45) NOT NULL,
      payload TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance REAL NOT NULL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL CHECK(type IN ('CREDIT','DEBIT')),
      amount REAL NOT NULL,
      description VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      discount_percent INTEGER NOT NULL,
      discount_max_amount REAL NOT NULL,
      min_cart_value REAL NOT NULL,
      usage_limit INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMP,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','EXPIRED'))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS train_coaches (
      id SERIAL PRIMARY KEY,
      train_number VARCHAR(50) REFERENCES trains(train_number) ON DELETE CASCADE NOT NULL,
      coach_class VARCHAR(50) NOT NULL,
      coach_label VARCHAR(50) NOT NULL,
      position_from_engine INTEGER NOT NULL,
      total_seats INTEGER NOT NULL,
      UNIQUE(train_number, coach_label)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS train_routes (
      id SERIAL PRIMARY KEY,
      train_number VARCHAR(50) REFERENCES trains(train_number) ON DELETE CASCADE NOT NULL,
      station_code VARCHAR(10) REFERENCES stations(code) ON DELETE CASCADE NOT NULL,
      stop_number INTEGER NOT NULL,
      arrival_time VARCHAR(50),
      departure_time VARCHAR(50),
      distance_km REAL NOT NULL,
      day_count INTEGER NOT NULL DEFAULT 1,
      platform VARCHAR(10),
      UNIQUE(train_number, station_code)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_train_status (
      id SERIAL PRIMARY KEY,
      train_number VARCHAR(50) REFERENCES trains(train_number) ON DELETE CASCADE NOT NULL,
      current_station VARCHAR(10) REFERENCES stations(code),
      status VARCHAR(50) NOT NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      speed_kmh INTEGER NOT NULL DEFAULT 0,
      next_station VARCHAR(10) REFERENCES stations(code),
      expected_arrival TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('019_saved_passengers_and_admin_mfa', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_passengers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      masked_aadhaar TEXT NOT NULL
    );
  `);

  await pool.query(`
    UPDATE users SET mfa_secret = 'JBSWY3DPEHPK3PXP', mfa_enabled = 1 WHERE email IN ('admin@railflow.com', 'superadmin@railflow.com');
  `);
});

register('020_waitlist_and_event_tables', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_waitlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      train_number VARCHAR(50) NOT NULL,
      from_station VARCHAR(10) NOT NULL,
      to_station VARCHAR(10) NOT NULL,
      coach_class VARCHAR(50) NOT NULL,
      passengers INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(50) NOT NULL,
      pnr VARCHAR(50) UNIQUE NOT NULL,
      waitlist_number INTEGER NOT NULL,
      promoted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      pnr VARCHAR(50) UNIQUE NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED',
      seats TEXT NOT NULL,
      total_price REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_seats (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      section VARCHAR(50) NOT NULL,
      row_label VARCHAR(50) NOT NULL,
      seat_number INTEGER NOT NULL,
      price REAL NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
      locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      lock_expires_at TIMESTAMP,
      booking_id INTEGER REFERENCES event_bookings(id) ON DELETE SET NULL
    );
  `);
});

register('021_live_train_status_last_updated', async (pool) => {
  await pool.query(`
    ALTER TABLE live_train_status ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);
});

register('022_add_webauthn_columns', async (pool) => {
  await pool.query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS webauthn_challenge VARCHAR(255),
    ADD COLUMN IF NOT EXISTS webauthn_user_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS webauthn_credential_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS webauthn_public_key TEXT,
    ADD COLUMN IF NOT EXISTS webauthn_counter INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS webauthn_enabled INTEGER DEFAULT 0;
  `);
});

register('023_add_platform_tickets_table', async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pnr VARCHAR(50) UNIQUE NOT NULL,
      from_station VARCHAR(10) NOT NULL REFERENCES stations(code) ON DELETE CASCADE,
      to_station VARCHAR(10) REFERENCES stations(code) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      price REAL NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      passenger_name VARCHAR(255) NOT NULL,
      passenger_age INTEGER NOT NULL,
      valid_until TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

register('024_seed_mathura_train', async (pool) => {
  // 1. Insert Stations
  await pool.query(`
    INSERT INTO stations (code, name, city, state, zone, latitude, longitude)
    VALUES 
      ('MTJ', 'Mathura Junction', 'Mathura', 'Uttar Pradesh', 'North Central Railway', 27.4924, 77.6737),
      ('NDLS', 'New Delhi Railway Station', 'Delhi', 'Delhi', 'Northern Railway', 28.6417, 77.2200)
    ON CONFLICT (code) DO NOTHING;
  `);

  // 2. Insert Train
  await pool.query(`
    INSERT INTO trains (train_number, name, from_station, to_station, departure_time, arrival_time, base_fare)
    VALUES ('14001', 'Mathura NDLS Express', 'MTJ', 'NDLS', '08:00', '10:30', 150.0)
    ON CONFLICT (train_number) DO NOTHING;
  `);

  // 3. Insert Coaches
  await pool.query(`
    INSERT INTO train_coaches (train_number, coach_class, coach_label, position_from_engine, total_seats)
    VALUES 
      ('14001', '1A', 'A1', 1, 9),
      ('14001', '3A', 'B1', 2, 18),
      ('14001', 'SL', 'S1', 3, 18)
    ON CONFLICT (train_number, coach_label) DO NOTHING;
  `);

  // 4. Insert Seats
  const coachConfigs = [
    { coach_class: '1A', coach_label: 'A1', seat_count: 9 },
    { coach_class: '3A', coach_label: 'B1', seat_count: 18 },
    { coach_class: 'SL', coach_label: 'S1', seat_count: 18 },
  ];

  for (const config of coachConfigs) {
    for (let i = 1; i <= config.seat_count; i++) {
      await pool.query(`
        INSERT INTO seats (train_number, coach_class, coach_label, seat_number, status)
        VALUES ('14001', $1, $2, $3, 'AVAILABLE')
        ON CONFLICT (train_number, coach_label, seat_number) DO NOTHING;
      `, [config.coach_class, config.coach_label, i]);
    }
  }
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
    try {
      await pool.query(idx);
    } catch (e: any) {
      console.warn(`[Migration] Index skipped (table may not exist): ${e.message}`);
    }
  }
}
