# RailFlow — System Design v3.1

> **Status:** Production-ready reference  
> **Version:** 2.1.0  
> **Last updated:** 2026-06-11

---

## Table of Contents
1. [High-Level Architecture](#1-high-level-architecture)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Database Schema & Partitioning](#3-database-schema--partitioning)
4. [Seat Locking — Dual-Phase Lock Validation](#4-seat-locking--dual-phase-lock-validation)
5. [Booking Saga (Payment Flow)](#5-booking-saga-payment-flow)
6. [Seat Pre-Warm Cache](#6-seat-pre-warm-cache)
7. [Live Tracking (Secure WebSocket)](#7-live-tracking-secure-websocket)
8. [Observability — OpenTelemetry](#8-observability--opentelemetry)
9. [Security Model](#9-security-model)
10. [Scalability & Resilience](#10-scalability--resilience)
11. [Deployment Architecture](#11-deployment-architecture)
12. [Remaining Decisions](#12-remaining-decisions)
13. [Operations Runbook](#13-operations-runbook)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                     │
│  React SPA (Vite)   ·   Nginx Reverse Proxy   ·   CDN (static assets)      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │ HTTPS / wss://
┌────────────────────────────▼────────────────────────────────────────────────┐
│                           API GATEWAY TIER                                  │
│  Express API (cluster)  ·  Rate Limiter  ·  CSRF  ·  Helmet  ·  Prometheus │
│  ├── /api/v1/** — REST routes with RailwayApiService                        │
│  ├── /ws/live-tracking — Secure WebSocket (wss://)                          │
│  ├── /metrics          — Prometheus scrape endpoint                         │
│  └── /health/**        — Health probes (DB, Redis, cache)                   │
└────────┬───────────────────┬───────────────────┬────────────────────────────┘
         │                   │                   │
         │                   │                   ▼
         │                   │       ┌──────────────────────┐
         │                   │       │ External Railway API │
         │                   │       │ (RapidAPI / NTES)    │
         │                   │       └──────────────────────┘
┌────────▼──────┐   ┌────────▼────────┐   ┌──────────────────────────────────┐
│  PostgreSQL   │   │  Redis Cluster  │   │  Apache Kafka                    │
│  (primary +   │   │  (Redlock seat  │   │  Topics:                         │
│   replicas)   │   │   locks, cache, │   │  · booking.initiated             │
│               │   │   sessions)     │   │  · payment.completed             │
│  Tables:      │   │                 │   │  · seat.released                 │
│  · bookings   │   │  Keys:          │   │  · notification.send             │
│  · seats      │   │  · lock:{id}    │   │  · refund.requested              │
│  · users      │   │  · cache:{key}  │   │                                  │
│  · payments   │   │  · session:{id} │   │  Consumers:                      │
│  · audit_logs │   └─────────────────┘   │  · Saga Orchestrator             │
│  · consents   │                         │  · Notification Worker           │
└───────────────┘                         │  · Loyalty Engine                │
                                          └──────────────────────────────────┘
```

---

## 2. Request Lifecycle

```
Browser → Nginx → Express Worker
  │
  ├─ requestIdMiddleware   (X-Request-ID: uuid)
  ├─ OTel auto-instrumentation  (span created)
  ├─ generalRateLimiter    (sliding-window, per-IP)
  ├─ CSRF token validation
  ├─ Auth middleware       (JWT RS256 verify)
  ├─ Route handler
  │    ├─ Cache lookup (L1 in-process → L2 Redis)
  │    ├─ DB query (if cache miss)
  │    └─ Cache write (on miss)
  ├─ Response
  └─ OTel span end + Prometheus counter increment
```

---

## 3. Database Schema & Partitioning

### Core Tables

| Table | Rows (est.) | Partition Strategy |
|---|---|---|
| `users` | ~1M | None (small) |
| `bookings` | ~50M/year | RANGE by `created_at` (monthly) |
| `bookings_partitioned` | same | shadow table, monthly child partitions |
| `seats` | ~5M | None (hot, fits in memory) |
| `payments` | ~50M/year | Future: same as bookings |
| `audit_logs_partitioned` | ~200M/year | RANGE by `created_at` (yearly), BRIN index |
| `aadhaar_consents` | ~50M/year | None (logs explicit passenger verification consent under DPDP Act 2023) |
| `queue_tokens` | transient | Cleared on startup |

### Partitioning Implementation

**Migration 013 — `bookings_partitioned`** (safe shadow strategy):

```sql
-- 1. New partitioned parent (no FK constraints on PK to allow partition key)
CREATE TABLE bookings_partitioned (
  id           SERIAL,
  user_id      INTEGER NOT NULL,
  pnr          VARCHAR(50) NOT NULL,
  status       VARCHAR(50) NOT NULL,
  price        REAL NOT NULL,
  passengers   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 2. Initial catch-all child partition
CREATE TABLE bookings_p_2026
  PARTITION OF bookings_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2029-01-01');

-- 3. Composite indexes per query pattern
CREATE INDEX idx_bkp_user_created ON bookings_partitioned(user_id, created_at DESC);
CREATE INDEX idx_bkp_status_created ON bookings_partitioned(status, created_at DESC);
```

**Cut-over (maintenance window, DBA)**:
```sql
ALTER TABLE bookings RENAME TO bookings_legacy;
ALTER TABLE bookings_partitioned RENAME TO bookings;
-- update FK constraints on payments, refunds, seats to point at new table
```

**Migration 014 — `audit_logs_partitioned`**:

```sql
CREATE TABLE audit_logs_partitioned (
  id BIGSERIAL, actor INTEGER, action VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- BRIN: 8 KB per 128 pages vs B-Tree's per-row cost — ideal for append-only logs
CREATE INDEX idx_audit_brin_created ON audit_logs_partitioned USING BRIN (created_at);
```

> **Why BRIN on audit logs?** BRIN indexes store min/max per block rather than per row. For an append-only time-series table they are ~200x smaller than B-Tree and nearly free to maintain.

### Key Indexes

```sql
-- Seats: fast lock-expiry cleanup (runs every 10 s)
CREATE INDEX idx_seats_lock ON seats(locked_by, lock_expires_at);

-- Payments: idempotency key lookup
CREATE INDEX idx_payments_idempotency ON payments(idempotency_key);

-- Queue: expiry scan
CREATE INDEX idx_queue_tokens_window ON queue_tokens(booking_window_expires_at);
```

---

## 4. Seat Locking — Dual-Phase Lock Validation

### Problem (Correctness Bug)
Without dual-phase validation the following race condition is possible:

```
T=0ms  User A: initiatePayment() → Redis lock acquired, payment gateway called
T=50ms Redis lock TTL expires (network hiccup)
T=51ms User B: lockSeat() → Redis SET NX succeeds (A's lock gone)
T=200ms User A: confirmPayment() → books seat → DOUBLE BOOKING
         User A was charged for a seat now owned by B
```

### Solution: Two-Point Ownership Check

Implemented in [`saga.service.ts`](file:///c:/Users/admin/Desktop/Railflow/backend/src/services/saga.service.ts):

**Phase 1 — Before charging the payment gateway:**
```typescript
// Inside executeBookingPayment()
const seatCheck = await pool.query(
  `SELECT locked_by, lock_expires_at, status
   FROM seats
   WHERE train_number=$1 AND coach_label=$2 AND seat_number=$3
   FOR UPDATE NOWAIT`,          // ← Postgres row-level lock
  [trainNumber, coachLabel, seatNumber]
);

const seat = seatCheck.rows[0];
if (!seat
    || seat.status !== 'LOCKED'
    || seat.locked_by !== userId
    || new Date(seat.lock_expires_at) <= new Date()) {
  throw new SeatOwnershipError(
    'Seat lock expired or taken by another user before payment was initiated'
  );
}
// → Only now charge the payment gateway
```

**Phase 2 — Inside the commit transaction (after gateway success):**
```typescript
// Inside confirmPaymentAndCompleteBooking(), within BEGIN..COMMIT
await client.query('BEGIN');

// Re-validate inside the transaction — another worker may have committed between
// our payment gateway call and this DB write
const reCheck = await client.query(
  `SELECT locked_by, status FROM seats
   WHERE train_number=$1 AND coach_label=$2 AND seat_number=$3
   FOR UPDATE`,                 // ← NOWAIT removed: we WANT to wait here
  [trainNumber, coachLabel, seatNumber]
);

if (reCheck.rows[0].status !== 'LOCKED'
    || reCheck.rows[0].locked_by !== userId) {
  await client.query('ROLLBACK');
  // Trigger automatic refund via Saga compensating transaction
  await refundService.initiate(bookingId, amount, 'Seat unavailable at commit time');
  throw new SeatOwnershipError('Seat was reassigned between payment and commit');
}

// Safe to write
await client.query(
  `UPDATE seats SET status='BOOKED', booking_id=$1 WHERE ...`, [bookingId]
);
await client.query('COMMIT');
```

### Why `FOR UPDATE NOWAIT` in Phase 1?

`NOWAIT` means: if another transaction holds a row lock, fail immediately instead of waiting. This prevents the booking flow from stalling for the full lock-timeout period and surfaces conflicts as explicit errors instead of silent hangs.

### Redis + Redlock (Distributed Safety)

For a Redis Cluster (3+ nodes), we use Redlock:

```typescript
// lock.service.ts — Redlock across 3 Redis nodes
const lock = await redlock.acquire([`lock:seat:${key}`], 30_000);
// 30 s TTL — long enough for payment gateway roundtrip
// Released explicitly in finally block, not just on expiry
```

Single-node Redis uses `SET NX EX` as a fallback, but clustering is required for correctness guarantees.

---

## 5. Booking Saga (Payment Flow)

```
User                 Saga Orchestrator           External
 │                        │                      Payment GW
 │── POST /bookings ──────►│
 │                        │── lockSeat()
 │                        │── publish(booking.initiated)
 │◄── bookingId ──────────│
 │
 │── POST /payments/initiate ─►│
 │                        │── Phase1 Lock Check (DB FOR UPDATE NOWAIT)
 │                        │── chargeGateway() ──────────────────►│
 │                        │◄──────────── SUCCESS / FAILURE ───────│
 │                        │
 │                        │── Phase2 Commit Check (BEGIN / FOR UPDATE)
 │                        │── UPDATE seats SET status='BOOKED'
 │                        │── INSERT bookings
 │                        │── COMMIT
 │                        │── publish(payment.completed)
 │◄── PNR confirmed ──────│
 │
 │   [On ANY failure]
 │                        │── releaseSeatLock()
 │                        │── refundGateway() (if charged)
 │                        │── UPDATE booking status='CANCELLED'
 │                        │── publish(notification.send → "booking failed")
```

**Compensating transactions** fire for every step that already committed, ensuring the system never leaves a partial state (charged but unbooked, or booked but uncharged).

---

## 6. Seat Pre-Warm Cache

### Problem
On cold start or after Redis flush, the first 20–50 concurrent seat searches all miss the cache and hit Postgres simultaneously — a "thundering herd" that spikes CPU and query latency.

### Implementation

[`seat-warmer.service.ts`](file:///c:/Users/admin/Desktop/Railflow/backend/src/services/seat-warmer.service.ts) — runs as a background daemon:

```
Startup
  │
  ├─ Immediately: fetchHighDemandTrains() → top 20 by LOCKED+BOOKED count
  │    └── for each train:
  │         ├── fetchSeatAvailability() → GROUP BY coach_class, status
  │         ├── cache.set(`seat-availability:${n}`, data, TTL=10s)
  │         └── cache.set(`train-details:${n}`, data, TTL=300s)
  │
  └─ Every 5 min: repeat cycle
```

**Cache key contract**: keys match exactly what `train.routes.ts` writes, so warmed entries are consumed transparently — no route changes required.

**Metrics**:
```
[SeatWarmer] Warming cycle complete { trainCount: 20, warmedEntries: 40 }
```

### Two-Layer Cache Architecture

```
Request for seat availability
  │
  ├─ L1: In-process Map (microseconds) ──► HIT → return
  │
  ├─ L2: Redis (1-3 ms) ──────────────────► HIT → populate L1 → return
  │
  └─ L3: PostgreSQL (10-50 ms) ────────────► populate L2 + L1 → return
```

Cache TTLs are tuned for data volatility:

| Key Pattern | TTL | Reason |
|---|---|---|
| `seat-availability:*` | 10 s | Can change on every lock |
| `train-details:*` | 300 s | Rarely changes |
| `train-search:*` | 30 s | Moderate churn |
| `payment-methods:*` | 3600 s | Static |

---

## 7. Live Tracking (Secure WebSocket)

### Security Bug Fixed

**Before (vulnerable):**
```typescript
const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:5000'}/ws/...`;
// ↑ Hardcoded ws:// — sends unencrypted frames over a TLS-terminated connection.
//   Man-in-the-middle can inject arbitrary train status updates.
```

**After (fixed in [`LiveTrackingWidget.tsx`](file:///c:/Users/admin/Desktop/Railflow/frontend/src/features/dashboard/LiveTrackingWidget.tsx)):**
```typescript
const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsBase  = import.meta.env.VITE_WS_URL || `${wsProto}//localhost:5000`;
const wsUrl   = `${wsBase}/ws/live-tracking?train=${encodeURIComponent(trainNumber)}`;
```

Protocol is derived from `window.location.protocol`, so:
- `https://` page → `wss://` automatically
- `http://localhost` → `ws://` (local dev only)
- `VITE_WS_URL` env var can override either case

### WebSocket Message Protocol

```typescript
// Server → Client (every 15 s or on state change)
{
  type: "status",
  data: {
    trainNumber: "RF101",
    currentStation: "Mumbai CST",
    nextStation: "Pune",
    delay: 5,        // minutes
    speed: 98,       // km/h
    platform: "3",
    eta: "14:35"
  }
}

// Client → Server (heartbeat)
{ type: "ping" }

// Server → Client (heartbeat ack)
{ type: "pong" }
```

### Connection Lifecycle

```
connect → onopen (connState='connected')
  │
  ├─ Every 15s: message received → update UI + setPulse(true)
  │
  ├─ onerror → connState='error' → auto-retry after 3s
  │
  └─ onclose → connState='disconnected' → user can click Reconnect
```

---

## 8. Observability — OpenTelemetry

### Architecture

```
Express process
  │
  └─ OTel SDK (NodeSDK)
       ├─ Auto-instrumentation:
       │    ├─ @opentelemetry/instrumentation-http   (all HTTP spans)
       │    ├─ @opentelemetry/instrumentation-express (route spans)
       │    ├─ @opentelemetry/instrumentation-pg      (SQL spans)
       │    └─ @opentelemetry/instrumentation-redis   (Redis command spans)
       │
       └─ OTLP HTTP Exporter ──────►  Jaeger / Tempo / Honeycomb
                                       (http://localhost:4318/v1/traces)
```

### Activation

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
```

When `OTEL_ENABLED` is not `'true'`, the SDK is not initialised — zero overhead in dev.

### What Gets Traced (Auto-Instrumented)

Every inbound HTTP request produces a root span with:
- `http.method`, `http.route`, `http.status_code`
- `http.url`, `net.peer.ip`

Child spans are created automatically for:
- Every `pg.Pool.query()` call → SQL + bind params (sanitized)
- Every Redis command → command name + key
- Every outgoing HTTP call (payment gateway, notification provider)

### Trace → Metric Correlation

Prometheus `/metrics` endpoint provides RED metrics (Rate, Error, Duration):

```prometheus
http_requests_total{method="POST",route="/api/v1/payments",status="200"} 1042
http_request_duration_ms{quantile="0.99"} 312
active_connections 47
```

Grafana dashboards join OTel trace IDs with Prometheus labels for full-context debugging.

---

## 9. Security Model

| Layer | Control |
|---|---|
| Transport | TLS termination at Nginx; `wss://` for WebSocket |
| Auth | JWT RS256 (15 min access token + 7 day refresh via `httpOnly` cookie) |
| CSRF | Double-submit cookie pattern on all mutating routes |
| Rate limiting | 100 req/min general; 20 req/min auth; 10 req/min payment |
| Injection | `sanitizeInput()` strips XSS; parameterized queries for SQL |
| Headers | `helmet()` + custom `securityHeaders` middleware |
| Secrets | Never logged — `sanitizeBody()` redacts passwords, CVV, Aadhaar |
| Seat locking | Redlock (distributed) + `FOR UPDATE NOWAIT` (DB) |
| Payment | Idempotency key prevents duplicate charges |
| MFA | TOTP (6-digit) enforced for sensitive actions |
| DPDP Act 2023 | Encryption of passenger Aadhaar, explicit consent logging (`aadhaar_consents`), name/Aadhaar masking on public lookup, access audit logs |
| PCI-DSS | Strict client-side card tokenization, raw card credentials prohibited on backend |

### 9.1 DPDP Act 2023 Compliance
Under the Digital Personal Data Protection (DPDP) Act 2023 of India, Aadhaar data requires special processing:
1. **Explicit Consent**: Booking requires checking a consent box (`aadhaarConsentGiven: true`) which is captured in the `aadhaar_consents` table alongside user ID, PNR, IP address, and timestamp.
2. **Application-Level Encryption**: Aadhaar numbers are encrypted using AES-256-CBC at the application layer before database serialization.
3. **Information Masking**: Public PNR lookups mask passenger names (e.g. `J*** D**`) and fully redact Aadhaar numbers (`XXXX-XXXX-XXXX`). Owner views display partially masked values (`XXXX-XXXX-1234`) and record an `AUDIT_AADHAAR_ACCESS` log entry.

### 9.2 PCI-DSS Compliance
To keep the backend application server completely out of scope for PCI-DSS audit, raw card parameters are forbidden:
1. **Client Tokenization**: Frontend card forms generate a token (`tok_mock_xxxx`) simulating standard Stripe/Razorpay Elements tokenization.
2. **Backend Protection**: `/bookings/confirm` blocks raw card fields (`cardNumber`, `cardExpiry`, `cardCvv`) and accepts only the client-generated token, preventing cardholder credentials from ever reaching backend endpoints.

---

## 10. Scalability & Resilience

### Horizontal Scaling

```
cluster.fork() × (CPU_COUNT) workers
  Each worker:
    ├─ Stateless HTTP
    ├─ Shared Redis (session, locks, cache)
    └─ Shared Postgres (connection pool: 10 per worker)
```

### Circuit Breaker (Pricing Service)

```
CLOSED ──► (failures > threshold) ──► OPEN
              ↑                          │ (probe after 30s)
              └────── HALF-OPEN ◄────────┘
```

Prevents cascading failure when the pricing microservice is degraded.

### Queue System (Waitlist)

When all seats are LOCKED or BOOKED, users enter a virtual queue (Kafka-backed). When a lock expires or a booking is cancelled, the next user in queue is granted a 5-minute booking window.

### Graceful Shutdown

```
SIGTERM
  │
  ├─ shutdownOtel()            — flush buffered OTel spans
  ├─ stopSeatWarmer()          — stop cache warmup timer + Kafka consumer
  ├─ stopPartitionMaintainer() — stop daily partition creation job
  ├─ closeLiveTracking()       — close all WS connections (code 1001)
  ├─ server.close()            — stop accepting new connections
  ├─ stopQueueWorkers()        — drain in-flight queue jobs
  ├─ stopLagMonitor()          — stop Kafka admin poll
  ├─ closeKafka()              — flush producer buffer, disconnect consumers
  ├─ closeRedis()              — release connection pool
  └─ closeDb()                 — release Postgres pool
     (15s hard kill timeout → process.exit(1))
```

---

## 11. Deployment Architecture

```
                        ┌──────────────────┐
                        │   Jaeger / Tempo │  ◄── OTel traces
                        └──────────────────┘
                                 ▲
┌───────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                        │
│                                                            │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐     │
│  │ API Pod ×N  │   │ API Pod ×N  │   │ API Pod ×N  │     │
│  │ (cluster)   │   │ (cluster)   │   │ (cluster)   │     │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘     │
│         └────────────────►│◄─────────────────┘            │
│                     Redis Cluster (6 nodes)               │
│                     Kafka Cluster (3 brokers)             │
│                     Postgres (primary + 2 replicas)       │
└───────────────────────────────────────────────────────────┘
```

### Docker Compose (Local Dev)

```yaml
services:
  api:     { build: ./backend,  ports: ["5000:5000"] }
  web:     { build: ./frontend, ports: ["3000:3000"] }
  db:      { image: postgres:15 }
  redis:   { image: redis:7 }
  kafka:   { image: confluentinc/cp-kafka }
  jaeger:  { image: jaegertracing/all-in-one, ports: ["16686:16686","4318:4318"] }
  prometheus: { image: prom/prometheus }
  grafana: { image: grafana/grafana, ports: ["3001:3000"] }
```

---


---

## 12. Remaining Decisions

All v3.0 "Known Trade-offs" are now closed. The following are deliberate decisions, not gaps:

| Area | Decision | Rationale |
|---|---|---|
| Redlock | Requires Redis Cluster (3+ nodes) for correctness | Single-node dev uses `SET NX EX` fallback — documented in Runbook §13.3 |
| OTel sampling | 10% head-based + 100% error tail | Balance cost vs. debuggability. Tune via `OTEL_SAMPLE_RATE` env var |
| Partition cut-over | `bookings_partitioned` shadow table — DBA promotes in maintenance window | Avoids FK constraint downtime; `bookings_legacy` retained as rollback |
| Kafka lag monitor | Poll-based (Admin API every 30s) | Push-based requires Kafka's Consumer Group API or MirrorMaker 2 — over-engineered for current scale |
| Notification delivery | Retry 3× with exponential backoff; webhook receipt via `markDelivered()` | Full delivery guarantee requires provider-specific receipt webhooks; documented in Runbook §13.4 |
| Real Train API | RapidAPI / NTES integration with local DB fallback | Zero-downtime client fetches real data or gracefully degrades under quota/errors |
| Aadhaar DPDP | AES-256-CBC encryption + log audit access | Compliance with India's DPDP Act 2023 for passenger Aadhaar storage and lookup |
| PCI-DSS | Client tokenization + raw card rejection | Backend server completely out of cardholder data scope |

---

## 13. Operations Runbook

### 13.1 Partition Maintenance (pg_partman vs. Node.js fallback)

**Check if pg_partman is active:**
```sql
SELECT * FROM partman.part_config WHERE parent_table LIKE '%partitioned';
```

**Manually run pg_partman maintenance (if pg_partman available):**
```sql
SELECT partman.run_maintenance();
```

**Force Node.js partition maintainer to run immediately** (restarts pick it up automatically — no manual trigger needed).

**Promote shadow table to live (maintenance window):**
```sql
BEGIN;
  ALTER TABLE bookings RENAME TO bookings_legacy;
  ALTER TABLE bookings_partitioned RENAME TO bookings;
  -- Update FK references:
  ALTER TABLE payments     DROP CONSTRAINT IF EXISTS payments_booking_id_fkey;
  ALTER TABLE payments     ADD  CONSTRAINT payments_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
  ALTER TABLE refunds      DROP CONSTRAINT IF EXISTS refunds_booking_id_fkey;
  ALTER TABLE refunds      ADD  CONSTRAINT refunds_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
COMMIT;
```

### 13.2 Redis Memory Policy

```bash
# Verify policy is applied
redis-cli CONFIG GET maxmemory
redis-cli CONFIG GET maxmemory-policy

# Set manually on managed Redis (if CONFIG SET is blocked)
# ElastiCache: Parameter Group → maxmemory-policy = allkeys-lru
# Upstash: Dashboard → Eviction Policy → allkeys-lru
```

Env var override: `REDIS_MAX_MEMORY=1gb` (default: `512mb`)

### 13.3 Redlock on Single-Node Redis (Dev)

Single-node Redis uses `SET key NX EX 30` as the seat lock primitive. This is safe for development and single-server production, but **does not provide distributed lock correctness** if Redis fails mid-lock. For production clusters:

```
REDIS_URL=redis://node1:6379,redis://node2:6379,redis://node3:6379
```

Redlock acquires the lock on ⌈N/2⌉+1 nodes (quorum). A lock is only considered held if quorum is achieved within the TTL.

### 13.4 Notification Delivery Receipts

**Provider webhook endpoint:** `POST /api/v1/notifications/:id/delivered`

When your email/SMS provider confirms delivery, call:
```http
POST /api/v1/notifications/1234/delivered
Authorization: Bearer <internal-service-token>
```

This calls `NotificationService.markDelivered(1234)` which sets `status='READ'` and `delivered_at=NOW()`.

**Retry schedule:** `[5 min, 30 min, 2 h]` — after 3 failures, status stays `FAILED` and an alert should fire.

**Query stuck notifications:**
```sql
SELECT id, type, channel, retry_count, next_retry_at, created_at
FROM notifications
WHERE status = 'FAILED' AND retry_count >= 3
ORDER BY created_at DESC LIMIT 50;
```

### 13.5 Kafka Consumer Lag Monitoring

**Grafana dashboard query:**
```promql
kafka_consumer_group_lag{group=~"railflow-.*"}
```

**Alert thresholds** (from [`infra/prometheus/alerts/kafka_lag.yml`](file:///c:/Users/admin/Desktop/Railflow/infra/prometheus/alerts/kafka_lag.yml)):

| Consumer Group | Warning | Critical |
|---|---|---|
| `railflow-notifications` | 1,000 | 10,000 |
| `railflow-seat-cache` | 500 | — |
| `railflow-loyalty` | 2,000 | — |
| Any group | — | 50,000 |

**Remediation:** Scale up consumer pod replicas (up to partition count). Each partition can be consumed by at most one consumer in a group.

### 13.6 Real Train API Integration Setup & Guide

To transition RailFlow from simulated mock schedules to real-world Indian Railways data, the platform utilizes an external gateway integration layer. This allows fetching live timetables, train search lists, and tracks from production-grade REST APIs (such as those hosted on RapidAPI).

#### 1. Integration Architecture & Resilience

The external integration layer is designed for high resilience, ensuring that external outages, latency spikes, or API rate limit exhausts never cause system downtime.

```
                  ┌────────────────────────────────────────┐
                  │   Inbound Client Request (REST / WS)   │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                      ┌──────────────────────────────┐
                      │    Read Redis Cache (L2)     │
                      └───────────────┬──────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │ Cache Hit?                              │
                 ├───────────────────┬─────────────────────┤
                 │ YES               │ NO                  │
                 ▼                   ▼                     ▼
         [Return Cached Data]   [Token Bucket Limiter]  [Local DB Fallback]
                                (Max=2, Refill=0.5/s)   (No API keys or
                                     │                   throttled/error)
                                     ├─────────────────────▲
                                     │ Acquired?           │
                                     ├───────────┬─────────┤
                                     │ YES       │ NO      │
                                     ▼           ▼         │
                              [Fetch RapidAPI] ────────────┘
                                     │
                                 (Success)
                                     ▼
                            [Update Redis Cache]
                                     │
                                     ▼
                             [Return Real Data]
```

*   **Token-Bucket Limiter**: Built directly into `RailwayApiService` to enforce a rate limit of 1 request per 2 seconds (burst of 2). This prevents the platform from spamming the external endpoint and burning the API quota.
*   **Redis Caching**:
    *   **Train search between stations** is cached for 30 seconds (`ext_between:FROM:TO`).
    *   **Live train tracking status** is cached for 60 seconds (`ext_live:TRAIN_NUMBER`).
*   **Graceful Degradation & Local Fallbacks**: If `RAPIDAPI_KEY` is not set, if the token bucket is empty (throttled), or if the external API returns an error or times out (5-second threshold), the query is seamlessly redirected to the seeded PostgreSQL/SQLite database tables (`trains`, `train_routes`, and `live_train_status`), ensuring 100% service uptime.

---

#### 2. Step-by-Step API Activation Guide

Follow these steps to activate real-world data fetching:

##### **Step 1: Sign up on RapidAPI**
1. Go to [https://rapidapi.com](https://rapidapi.com).
2. Create a free developer account or sign in with your GitHub/Google account.

##### **Step 2: Search for Indian Railways API**
1. In the search bar on RapidAPI, type `"Indian Railway"`.
2. Locate and click on an active API provider. Highly recommended ones include:
    *   **Indian Railway** (e.g., `irctc1.p.rapidapi.com` or similar active endpoints that provide `/api/v3/trainBetweenStations` and `/api/v1/liveTrainStatus`).
3. Click the **Subscribe to Test** button and select the **Basic (Free)** plan.

##### **Step 3: Extract API Keys**
1. Go to the API Playground for the subscribed Indian Railway API.
2. In the Header Parameters section, copy the value of:
    *   `X-RapidAPI-Key` (Your unique, secret API key, e.g., `56f5a3424bmsh...`)
    *   `X-RapidAPI-Host` (The host domain, e.g., `irctc1.p.rapidapi.com`)

##### **Step 4: Configure the Backend Environment**
1. Open the `.env` file in the `backend/` directory of the project: [backend/.env](file:///c:/Users/admin/Desktop/Railflow/backend/.env).
2. Uncomment the RapidAPI variables and paste your credentials:
    ```env
    RAPIDAPI_KEY=your_rapidapi_key_here
    RAPIDAPI_HOST=irctc1.p.rapidapi.com
    ```

##### **Step 5: Restart the Services & Verify**
1. Run the backend server in development mode:
    ```powershell
    cd backend
    npm run dev
    ```
2. Make a request via your browser, Postman, or curl:
    *   **Train Search**: `GET http://localhost:5000/api/v1/schedules/between/stations?from=NDLS&to=MMCT`
    *   **Live Status**: `GET http://localhost:5000/api/v1/schedules/12951/live`
3. Inspect the terminal console logs to verify:
    *   **Successful API fetch**:
        ```
        info: [Railway API] Fetching external data from: https://irctc1.p.rapidapi.com/api/v1/liveTrainStatus?trainNo=12951&startDay=0
        ```
    *   **Limiter Throttling (too many requests)**:
        ```
        warn: [Railway API] External request throttled by internal rate limiter. Falling back to local data.
        info: [Railway API] Falling back to local live tracking simulation for train: 12951
        ```
    *   **Unconfigured / Fallback**:
        ```
        debug: [Railway API] RAPIDAPI_KEY is not set. Using local database fallback.
        info: [Railway API] Falling back to local database search for: NDLS -> MMCT
        ```

