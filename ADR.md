# RailFlow — Architecture Decision Records

> **Purpose:** Explain *why* each major component was chosen, not just *what* was built.  
> Senior engineers and technical interviewers evaluate ADRs to understand engineering judgment — the ability to reason about trade-offs, constraints, and risk, not just ability to implement.

---

## ADR-001: Redlock for Distributed Seat Locking

**Status:** Accepted  
**Date:** 2026-06-11

### Context

During Tatkal window (10:00 AM), 30,000+ concurrent users compete for a fixed set of seats. A naive `UPDATE seats SET status='LOCKED'` would work for a single-node DB, but at 3 API pod replicas, two pods could read the same "AVAILABLE" seat simultaneously before either commits.

### Decision

Use **Redlock** (multi-node Redis distributed lock) with a 30-second TTL for the seat reservation phase.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **`SELECT FOR UPDATE` (DB-level)** | Works but holds a Postgres connection for the entire user checkout flow (30s lock window). At 3000 concurrent users, that's 3000 connections — far above `max_connections=200` on any reasonable Postgres instance. |
| **Optimistic locking (`version` column)** | Works for low-contention scenarios. At Tatkal, ~95% of transactions would retry on conflict, causing thundering herd. p(99) latency would spike to seconds. |
| **Single-node Redis `SET NX EX`** | Correct for single-instance Redis. Not safe if Redis primary fails mid-lock — another node could grant the same lock to a second client. Acceptable for dev, not for production cluster. |
| **Zookeeper / etcd** | Operationally expensive. Requires separate cluster, adds dependency for a problem Redis already solves. |

### Consequences

- **Good:** Seat lock survives API pod restart; no double-booking even if one pod dies mid-flow.
- **Good:** TTL-based auto-release means abandoned sessions don't strand seats indefinitely.
- **Trade-off:** Requires 3+ Redis nodes for Redlock quorum. Single-node dev uses `SET NX EX` fallback.
- **Risk mitigated:** Dual-phase validation (ADR-002) means even if Redlock fails, the DB transaction is the final source of truth.

---

## ADR-002: Dual-Phase Seat Lock Validation (Postgres + Redis)

**Status:** Accepted  
**Date:** 2026-06-11

### Context

Redis lock grants are not sufficient alone — Redis can return "lock acquired" but the DB row may have already been updated by a concurrent transaction during network lag. A customer could pay for a seat that is actually confirmed to another user.

### Decision

Two-phase validation at the DB level:

- **Phase 1 (Fast path):** `SELECT ... FOR UPDATE NOWAIT` — fails immediately if row is locked. Used during booking confirmation.
- **Phase 2 (Commit):** Full `BEGIN ... UPDATE ... COMMIT` with compensating transaction on failure.

The Redis lock is the first gate; the Postgres row lock is the authoritative gate.

### Why `FOR UPDATE NOWAIT` over `FOR UPDATE`

`FOR UPDATE` (without `NOWAIT`) would block until the row lock is released, potentially queuing thousands of transactions. During Tatkal this creates a convoy effect where everyone waits serially. `NOWAIT` returns `ERROR: could not obtain lock for row` immediately, letting the application retry with a different seat.

### Consequences

- **Good:** Eliminates the "phantom double-booking" where Redis said yes but DB had a race.
- **Good:** `NOWAIT` turns lock waits into fast retries rather than slow timeouts.
- **Trade-off:** Two round-trips to separate systems (Redis → Postgres) per booking. Acceptable at ~10ms each.

---

## ADR-003: Apache Kafka over BullMQ for Notification Events

**Status:** Accepted  
**Date:** 2026-06-11

### Context

Booking confirmations, cancellations, and payment events need to trigger notifications (email, SMS, push). The choice is between a queue (BullMQ on Redis) and an event bus (Kafka).

### Decision

**Kafka** for booking/payment events; **BullMQ** retained for background jobs (refund processing, report generation).

### Alternatives Considered

| Option | Why Rejected for events |
|---|---|
| **BullMQ only** | BullMQ queues are consumed once — no replay, no consumer group fan-out. If we need both Notification AND Loyalty AND Analytics to receive `booking.confirmed`, we'd need 3 separate BullMQ queues and publish to all three. This is brittle — adding a new consumer requires code changes to the publisher. |
| **Direct HTTP between services** | Synchronous coupling. If Notification Service is down during Tatkal, the entire booking endpoint fails. |
| **AWS SQS / SNS** | Correct approach for AWS-native. Adds cloud dependency. For on-prem / self-hosted, adds operational complexity without benefit. |
| **RabbitMQ** | Comparable to Kafka for this use case. Kafka chosen for its partition-based parallelism model, which naturally maps to the "scale notification workers by adding partitions" pattern. |

### The Key Insight

Kafka's consumer group model means: **adding a new consumer (e.g., a Fraud Detection service) requires zero changes to the publisher.** It subscribes to `booking.confirmed` independently. BullMQ requires the publisher to know about every subscriber.

### Consequences

- **Good:** `booking.confirmed` can be consumed by Notification, Loyalty, Analytics, and Fraud simultaneously with zero coupling.
- **Good:** Replay: if Notification Worker crashes during Tatkal, it replays from last committed offset — no lost events.
- **Trade-off:** Kafka requires 3 broker nodes minimum for HA. Adds operational overhead vs. Redis-backed BullMQ.
- **Decision:** BullMQ retained for jobs that don't need fan-out (refunds, report generation). Right tool for each use case.

---

## ADR-004: Saga Pattern over 2PC for Payment Flow

**Status:** Accepted  
**Date:** 2026-06-11

### Context

A booking involves three state transitions across three systems: lock seat (Redis), create booking record (Postgres), charge payment (external gateway). They must either all succeed or all compensate.

### Decision

**Saga pattern with compensating transactions**, not Two-Phase Commit (2PC).

### Why Not 2PC

2PC requires a coordinator that holds a distributed lock across all participants until all respond. Problems:
1. External payment gateways (Razorpay, Stripe) don't implement 2PC.
2. A coordinator crash leaves all participants in limbo — the "in-doubt transaction" problem.
3. At Tatkal scale, the coordinator becomes the bottleneck.

### Saga Implementation

```
Phase 1: Lock seat (Redis) + create PENDING booking (Postgres)
Phase 2: Charge payment gateway
  ↳ Success: UPDATE booking SET status='CONFIRMED', release lock
  ↳ Failure: UPDATE booking SET status='CANCELLED', release lock, trigger refund
```

Compensating transactions for each step:
- If payment fails → cancel booking, release seat lock, notify user
- If booking DB write fails → release seat lock, return 500 (never charged)
- If gateway timeout → mark payment PENDING, poll for 15 min, compensate on final failure

### Consequences

- **Good:** Works with any payment gateway regardless of protocol.
- **Good:** Each step is independently retryable with idempotency keys.
- **Trade-off:** Saga is eventually consistent — there is a window where payment is PENDING but seat is still locked. Users see a "processing" state. Acceptable UX for railway booking.
- **Mitigation:** `FOR UPDATE NOWAIT` (ADR-002) prevents double-charging.

---

## ADR-005: Postgres Range Partitioning over TimescaleDB

**Status:** Accepted  
**Date:** 2026-06-11

### Context

`bookings` and `audit_logs` tables grow unboundedly. At 10M bookings/year, queries on `WHERE created_at > '2026-01-01'` do full table scans. Archival requires copying and truncating.

### Decision

**Postgres native range partitioning** (monthly for bookings, yearly for audit_logs) with pg_partman for automatic child partition creation.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **TimescaleDB** | TimescaleDB is excellent for time-series data (sensor readings, metrics). Railway bookings are transactional OLTP, not time-series. TimescaleDB's hypertable model adds complexity and a new extension dependency for a problem Postgres 14+ solves natively. |
| **Table archival (cron copy+delete)** | Fragile. Doesn't solve query performance on the live table. Partitioning prunes partitions at the query planner level — the partition for "December 2024" is never touched for a "January 2026" query. |
| **Separate archive DB** | Correct for very large scale (100B rows). Over-engineered for current volume. |

### Key Decision: Partition by `created_at`, Not `departure_date`

Booking data is most commonly queried by when it was made (refunds, audit trails, support lookup) not when the train departs. Partitioning by `created_at` means the "hot" partition (current month) fits in Postgres `shared_buffers`, while historical partitions are cold and rarely scanned.

### Consequences

- **Good:** `EXPLAIN ANALYZE` shows partition pruning — December 2024 partition is never touched for January 2026 queries.
- **Good:** Detach a partition to "archive" — no data movement, zero downtime.
- **Trade-off:** Cross-partition joins (rare for this schema) lose partition pruning benefit.
- **Operational note:** pg_partman auto-creates next 3 months of partitions. Node.js partition-maintainer.service.ts provides fallback for managed Postgres where pg_partman is unavailable.

---

## ADR-006: Transactional Outbox over Direct Kafka Publish

**Status:** Accepted  
**Date:** 2026-06-11

### Context

After a booking is confirmed, we publish `booking.confirmed` to Kafka. The naive approach: `await db.commit(); await kafka.publish(...)`. Problem: if the server crashes between the commit and the publish, the booking exists in the DB but the notification is never sent. The user gets no confirmation email.

### Decision

**Transactional Outbox pattern:** write the Kafka message to an `outbox` table in the *same transaction* as the booking confirmation. A relay process reads unflushed outbox rows and publishes them.

```sql
BEGIN;
  UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1;
  INSERT INTO outbox (topic, payload, published) VALUES ('booking.confirmed', $2, false);
COMMIT;
-- Relay: SELECT * FROM outbox WHERE published = false FOR UPDATE SKIP LOCKED;
```

### Why This Works

The outbox write is part of the Postgres transaction. Either both the booking update and the outbox entry commit, or neither does. The relay can crash and retry — each outbox entry has an idempotency key that prevents double-publishing.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Direct publish after commit** | Lost messages on server crash between commit and publish. |
| **Kafka transactions** | Kafka exactly-once requires the producer to coordinate with the consumer group. Adds significant complexity and only works within Kafka — doesn't help if the booking DB commit itself fails. |
| **Dual-write (DB + Kafka in parallel)** | Non-atomic. One succeeds, one fails — race condition by definition. |

### Consequences

- **Good:** Zero lost events even on server crash mid-transaction.
- **Trade-off:** Relay adds latency (seconds, not ms) from booking to notification. Acceptable for email/SMS; not acceptable for real-time features.
- **For real-time (seat cache invalidation):** Direct Kafka publish is acceptable because a cache miss is handled gracefully (fall back to DB query). The outbox is for durable, once-delivered events like notifications.

---

## ADR-007: OpenTelemetry over Datadog / New Relic SDK

**Status:** Accepted  
**Date:** 2026-06-11

### Context

Production systems need distributed tracing to answer: "Why did booking #X take 4 seconds? Which service was slow?" The choice is between vendor-specific APM SDKs and OpenTelemetry.

### Decision

**OpenTelemetry** with OTLP export to a self-hosted Jaeger/Tempo, not a vendor APM SDK.

### Why Not Datadog or New Relic

1. **Vendor lock-in:** If you instrument with the Datadog SDK, every trace span, every metric, every log is tied to Datadog's wire format. Migration requires re-instrumenting every service.
2. **Cost at scale:** Datadog charges per host AND per trace volume. At 5M concurrent users with 100% trace sampling, Datadog costs can exceed $100k/month. OpenTelemetry with 10% head-based sampling (ADR-008) brings this to $10k/month on self-hosted infrastructure.
3. **Control:** Jaeger or Grafana Tempo on-prem means traces never leave your network — critical for Aadhaar data that cannot be sent to US-based SaaS vendors under DPDP Act 2023.

### Consequences

- **Good:** Zero vendor lock-in. Change from Jaeger to Tempo to Honeycomb by changing one environment variable (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- **Good:** Auto-instrumentation covers HTTP, Postgres, Redis, Kafka with zero code changes.
- **Trade-off:** Self-hosted Jaeger requires operational overhead vs. managed Datadog.
- **Mitigation:** Start with Grafana Cloud's free tier (10k traces/day) then migrate to self-hosted when volume demands it.

---

## ADR-008: 10% Head-Based Sampling + Error Always-On

**Status:** Accepted  
**Date:** 2026-06-11

### Context

At 5M concurrent users, exporting 100% of traces would generate ~500k spans/second. At $0.10/million spans (typical), that's $43k/day in observability costs.

### Decision

**`ParentBasedSampler(TraceIdRatioBased(0.1))`** — sample 10% of traces at the head (when the first request arrives). The same decision propagates to all downstream spans (no orphaned child spans). Additionally, `ErrorAlwaysSampleProcessor` promotes any ERROR-status span to always-export regardless of head decision.

### Why Head-Based vs. Tail-Based

Tail-based sampling (Jaeger's collector-level feature) buffers all spans, then decides after the fact whether to keep the full trace based on outcome. More accurate — you can guarantee keeping all slow traces AND all error traces. But: requires buffering all spans in memory before deciding, which means 10× more collector memory at high volume.

Head-based (our choice) makes the decision at trace start. Cheaper, simpler. The error override covers the most important case: you never drop an error trace.

### Configuration

```bash
OTEL_SAMPLE_RATE=0.1    # 10% for production
OTEL_SAMPLE_RATE=1.0    # 100% for development
OTEL_SAMPLE_RATE=0.01   # 1% for extreme-scale cost control
```

### Consequences

- **Good:** ~90% reduction in trace export volume and cost.
- **Good:** Error traces are always captured — you can always debug failures.
- **Trade-off:** 90% of successful traces are never recorded. You can't investigate a specific booking if it wasn't in the 10% sample. Mitigation: log the `trace_id` in the application log for every request — even unsampled requests have a trace ID that *would* have been the trace ID.

---

## ADR-009: Sec-WebSocket-Protocol for Token Transport

**Status:** Accepted  
**Date:** 2026-06-11

### Context

The live tracking WebSocket needs to authenticate the user. The initial implementation passed the JWT as a query parameter: `wss://api.railflow.app/ws/live-tracking?train=12951&token=eyJ...`.

### Problem

Query parameters are logged by every intermediary:
- Nginx access logs: `GET /ws/live-tracking?token=eyJ...` 
- Cloudflare logs (sent to US-based infrastructure)
- Browser history
- HTTP Referer headers (if the page links to anything)

A stolen JWT from a log means full account takeover for its lifetime.

### Decision

Pass the JWT as a WebSocket subprotocol value:

```
Client: Sec-WebSocket-Protocol: railflow-v1, Bearer.<token>
Server: validates JWT in handleProtocols callback
        replies: Sec-WebSocket-Protocol: railflow-v1
```

The `Sec-WebSocket-Protocol` header is part of the HTTP Upgrade request. It appears in access logs as a header, not in the URL path. Most log configurations do not log all request headers by default.

### Why Not Cookie-Based Auth

Cookies (`HttpOnly; Secure; SameSite=Strict`) are the ideal solution — they're never in logs and CSRF-protected. But WebSocket connections from browsers respect cookies only if the WS origin matches the cookie domain. For a Vite dev server on `localhost:3000` connecting to `localhost:5000`, this fails due to origin mismatch. Cookie auth requires same-domain deployment (API behind the same Nginx that serves the frontend). Valid for production — not convenient for dev.

### Consequences

- **Good:** Token no longer appears in Nginx access logs or browser URL history.
- **Good:** Works across origin boundaries (useful during development with separate frontend/backend ports).
- **Trade-off:** Subprotocol values are still visible to Nginx in header logs if header logging is enabled. Mitigation: configure Nginx to exclude `Sec-WebSocket-Protocol` from access log format.
- **Future:** Migrate to cookie auth when frontend and backend are behind the same Nginx reverse proxy.

---

## ADR-010: SQLite for Tests over Mocked DB

**Status:** Accepted  
**Date:** 2026-06-11

### Context

The test suite needs a database. Options: mock the DB with Jest mocks, use an in-memory SQLite, or spin up a real Postgres via Docker.

### Decision

**SQLite (via `better-sqlite3` / `sqlite`)** for unit and integration tests, with a real Postgres for staging/load tests.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Mock the DB layer** | Mocks test the mock, not the actual SQL. A `JOIN` bug, a `UNIQUE` constraint violation, or a bad `INSERT OR IGNORE` won't be caught. High false-positive rate. |
| **Docker Postgres for all tests** | Correct for staging. For unit tests, requires Docker running in CI, adds 10–30 seconds of container startup per run. 39 tests finish in 14s with SQLite. |
| **pg-mem (in-memory Postgres emulator)** | Interesting option. Doesn't support all Postgres syntax (e.g., `FOR UPDATE NOWAIT`, `PARTITION OF`). Would need to mock around those gaps — defeating the purpose. |

### Why This Works

The application data layer (`src/config/db.ts`) is abstracted behind a single `getDb()` / `getPool()` interface. Tests inject a SQLite instance; production uses Postgres. The 39 tests catch: auth flows, lock service contention, cache invalidation, queue behavior, graceful degradation (Redis/Kafka unavailable), refund saga logic.

### Consequences

- **Good:** 39 tests complete in ~14 seconds, no external dependencies.
- **Trade-off:** SQLite doesn't support `FOR UPDATE NOWAIT` or `PARTITION OF`. Dual-phase lock validation and partition-specific logic are tested via integration tests against staging Postgres.
- **Rule:** Any code path that relies on Postgres-specific syntax must have a staging integration test, not just a SQLite unit test.

---

## ADR-011: Application-Level AES-256-CBC Encryption for Aadhaar (DPDP Act 2023)

**Status:** Accepted  
**Date:** 2026-06-11

### Context

Under the Digital Personal Data Protection (DPDP) Act 2023 of India, passenger Aadhaar numbers represent highly sensitive personal identifier data. Storing them in plaintext in the database poses severe legal, privacy, and compliance risks. If database access logs or backups are compromised, passenger identities are exposed.

### Decision

Encrypt all Aadhaar numbers at the application layer using AES-256-CBC with a securely managed secret key before writing them to database serialization fields. Only decrypt them for authorized owner views, and record an audit log entry (`AUDIT_AADHAAR_ACCESS`) for every decryption.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Database Transparent Data Encryption (TDE)** | Only protects data at rest (on the hard drive). Does not prevent a database administrator with SQL access, or an attacker exploiting SQL injection, from viewing raw Aadhaar numbers. |
| **One-way hashing (SHA-256)** | Prevents decryption entirely. While secure, we cannot display the original Aadhaar to the ticket owner or send it to official railway/government check APIs. |
| **Plaintext Storage** | Violates the DPDP Act 2023 consent, encryption, and auditability requirements. |

### Consequences

- **Good:** Complete protection of passenger Aadhaar numbers inside Postgres/SQLite tables and backups.
- **Good:** Explicit audit trail allows tracing every time an operator or user accesses Aadhaar details.
- **Trade-off:** Secret key management becomes a single point of security. Loss of key means all stored passenger Aadhaar data becomes unrecoverable.

---

## ADR-012: Client-Side Card Tokenization for PCI-DSS Scope Reduction

**Status:** Accepted  
**Date:** 2026-06-11

### Context

Accepting card payments requires complying with Payment Card Industry Data Security Standards (PCI-DSS). If backend servers process, transmit, or store raw cardholder data (`cardNumber`, `cardExpiry`, `cardCvv`), the entire backend infrastructure falls under the scope of rigorous, expensive PCI-DSS audits (SAQ-D).

### Decision

Mandate client-side card tokenization using a third-party checkout interface (simulated local mock elements). The browser directly posts card details to the payment provider to receive a checkout token (`tok_mock_xxxx`). The backend booking endpoint accepts only this token and explicitly rejects any request payloads containing raw card credentials with a `400 Bad Request` PCI violation error.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Backend API Proxying** | The frontend posts card parameters to the backend, which forwards them to the payment gateway. Brings the backend servers into full PCI-DSS scope, requiring physical isolation, network segmentation, and annual audits. |
| **Hosted Page Redirect** | Redirects the user entirely to the payment gateway's hosted page. Highly secure, but degrades user experience and retention due to browser redirection. |

### Consequences

- **Good:** Eliminates cardholder data transmission on RailFlow servers, drastically reducing audit scope (SAQ-A or SAQ-A-EP).
- **Good:** Minimizes the risk of card data leakage through application logs, database tables, or memory dumps.
- **Trade-off:** Requires robust frontend state management to coordinate the tokenization step prior to submitting bookings.

---

## ADR-013: Resilience and Throttling Design for External Railway API Integration

**Status:** Accepted  
**Date:** 2026-06-11

### Context

To provide real-world schedules, station listings, and live train tracks, the system integrates with external Indian Railway APIs (RapidAPI). However, these third-party endpoints are rate-limited, subject to unexpected outages, and introduce latency.

### Decision

Implement a resilient wrapper service (`RailwayApiService`) that wraps external API requests with:
1. An in-memory Token Bucket rate limiter (max 2 burst tokens, 0.5 tokens/sec refill rate) to prevent quota exhaustion.
2. An L2 Redis cache layer (30s for searches, 60s for live status) to minimize external request volume.
3. A transparent database fallback query scanner that serves seeded local Postgres data when external requests are throttled, unconfigured, or fail.

### Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Direct calls without caching or limits** | Rapidly exhausts API limits, spikes outbound latency, and exposes the application to cascading failures if the external API slows down. |
| **Direct calls without DB fallback** | Outages in the third-party API immediately lead to platform-wide downtime for train search and live tracking. |

### Consequences

- **Good:** 100% platform uptime. The app degrades gracefully to simulated local data during external outages or quota limits.
- **Good:** Substantial cost savings and fast page load times due to local caching of repeat queries.
- **Trade-off:** Live status data may lag real-world tracks by up to the 60-second Redis cache TTL.

---

*ADRs follow [MADR format](https://adr.github.io/madr/). Each captures: Context (why this decision was needed), Decision (what was chosen), Alternatives Considered (with rejection rationale), and Consequences (honest trade-offs).*
