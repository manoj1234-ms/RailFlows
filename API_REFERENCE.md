# RailFlow API Reference & Roadmap

## Base URLs

All API routes are available under both prefixes for backward compatibility:

| Prefix | Example |
|--------|---------|
| `http://localhost:5000/api/v1/...` | `http://localhost:5000/api/v1/auth/login` |
| `http://localhost:5000/api/...` | `http://localhost:5000/api/auth/login` |
| Swagger UI | `http://localhost:5000/api/docs` |
| Prometheus metrics | `http://localhost:5000/metrics` |
| WebSocket live tracking | `ws://localhost:5000/ws/live-tracking` |

---

## Infrastructure Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | No | Welcome message + version |
| `GET` | `/health` | No | Health check (DB, Redis, process) |
| `GET` | `/health/cache` | No | Cache metrics |
| `GET` | `/health/redis` | No | Redis connectivity |
| `GET` | `/health/circuit-breaker` | No | Circuit breaker metrics |
| `GET` | `/metrics` | No | Prometheus metrics |

---

## Auth

Rate limited: `authRateLimiter` (20 req/min). CSRF protected.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | No | Email + phone registration |
| `POST` | `/auth/register/phone` | No | Phone-only registration |
| `POST` | `/auth/verify-otp` | No | Verify OTP for phone |
| `POST` | `/auth/verify-email` | No | Verify email with token |
| `POST` | `/auth/login` | No | Email login (5 attempts/15min) |
| `POST` | `/auth/login/phone` | No | Phone login |
| `POST` | `/auth/social` | No | Google / Apple login |
| `POST` | `/auth/mfa/verify` | No | MFA code verification |
| `POST` | `/auth/mfa/setup` | JWT | Setup MFA |
| `POST` | `/auth/logout` | JWT | Revoke token |
| `POST` | `/auth/refresh` | No | Rotate refresh token |

---

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/users/profile` | JWT | Profile + active sessions |
| `GET` | `/users/passengers` | JWT | Saved passengers (masked Aadhaar) |
| `POST` | `/users/passengers` | JWT | Add saved passenger |
| `POST` | `/users/sessions/terminate` | JWT | Remote logout |

---

## Trains

Rate limited: `searchRateLimiter` (30/min unauth, 60/min auth).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/trains/search` | No | Search trains (fuzzy station matching) |
| `GET` | `/trains/:id` | No | Train details (by ID or number) |
| `GET` | `/trains/:id/coach` | No | Coach seat map with live status |
| `GET` | `/trains/fare/calendar` | No | Fare calendar (+/- 7 days) |
| `GET` | `/trains/search/range` | No | Date range search (max 90 days) |

---

## Bookings

CSRF protected. Rate limited: `bookingRateLimiter` (10/min).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/bookings/lock` | JWT | Lock seats (180s, requires queue) |
| `POST` | `/bookings/confirm` | JWT | Confirm booking (Saga workflow) |
| `GET` | `/bookings/pnr/:pnr` | No | Public PNR enquiry |
| `GET` | `/bookings/ticket/:pnr` | JWT | E-ticket with ownership check |
| `GET` | `/bookings/history` | JWT | Booking history (paginated) |
| `GET` | `/bookings/ticket/:pnr/download` | No | Download PDF e-ticket |
| `POST` | `/bookings/cancel/:pnr/partial` | JWT | Partial cancel (specific passengers) |
| `POST` | `/bookings/cancel/:pnr` | JWT | Full cancel + seat release |
| `POST` | `/bookings/waitlist` | JWT | Join waitlist / RAC |
| `GET` | `/bookings/waitlist/status/:pnr` | No | Check waitlist/RAC status |
| `GET` | `/bookings/waitlist/my` | JWT | User's active waitlist bookings |

---

## Queue

CSRF protected.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/queue/join` | JWT | Join virtual queue |
| `GET` | `/queue/status` | JWT | Poll queue position |

---

## Payments

CSRF protected. Rate limited: `paymentRateLimiter` (30/min).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/payments/methods` | No | Payment methods list |
| `POST` | `/payments/initiate` | JWT | Initiate payment |
| `POST` | `/payments/verify` | JWT | Verify/confirm payment |
| `POST` | `/payments/refund` | JWT | Process refund |
| `GET` | `/payments/status/:transactionId` | JWT | Payment status |
| `GET` | `/payments/history` | JWT | Payment history |
| `POST` | `/payments/wallet/topup` | JWT | Wallet top-up |
| `GET` | `/payments/wallet` | JWT | Wallet balance + transactions |
| `POST` | `/payments/coupon/apply` | JWT | Validate & apply coupon |

---

## Admin

Admin route middleware: `authenticate` + `requireRole(['Admin', 'Super Admin'])` + `MFA required`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin/analytics` | Admin | Dashboard analytics (cached) |
| `GET` | `/admin/queue-metrics` | Admin | Virtual queue health |
| `GET` | `/admin/service-health` | Admin | Observability grid (cached) |
| `GET` | `/admin/audit-logs` | Admin | Paginated audit logs |

---

## Refunds (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin/refunds/analytics` | Admin | Refund dashboard |
| `GET` | `/admin/refunds/list` | Admin | List all refunds (paginated) |
| `POST` | `/admin/refunds/review/:refundId` | Admin | Approve/reject refund |
| `POST` | `/admin/refunds/retry-gateway/:refundId` | Admin | Retry failed gateway refund |

---

## Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/notifications/send` | JWT | Send notification |
| `GET` | `/notifications/history` | JWT | Notification history |
| `GET` | `/notifications/preferences` | JWT | Get preferences |
| `PUT` | `/notifications/preferences` | JWT | Update preferences |

---

## Stations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/stations/autocomplete` | No | Station autocomplete |
| `GET` | `/stations/nearby` | No | Nearby stations (lat/lng/radius) |
| `GET` | `/stations/:code` | No | Station details |
| `GET` | `/stations` | No | List all (paginated) |

---

## Schedule

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/schedule/:number` | No | Train schedule with all stops |
| `GET` | `/schedule/:number/live` | No | Live train status |
| `GET` | `/schedule/live/all` | No | All running trains |
| `GET` | `/schedule/fare/enquiry` | No | Fare between stations |
| `GET` | `/schedule/between/stations` | No | Trains between stations |
| `GET` | `/schedule/vikalp/alternates` | No | Vikalp alternate suggestions |

---

## Platform / Unreserved

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/platform/ticket` | JWT | Book platform ticket |
| `POST` | `/platform/unreserved` | JWT | Book unreserved ticket |
| `GET` | `/platform/ticket/:pnr` | No | Ticket details by PNR |
| `GET` | `/platform/my-tickets` | JWT | User's platform tickets |
| `POST` | `/platform/cancel/:pnr` | JWT | Cancel platform ticket |

---

## Events

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/events` | No | List events (filterable) |
| `GET` | `/events/:id` | No | Event details |
| `GET` | `/events/:id/seats` | No | Seat map |
| `POST` | `/events/seats/lock` | JWT | Lock event seats |
| `POST` | `/events/book` | JWT | Confirm event booking |

---

## Loyalty (ML-powered)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/loyalty/points` | JWT | Points account + tier |
| `GET` | `/loyalty/history` | JWT | Points transactions (paginated) |
| `POST` | `/loyalty/redeem` | JWT | Redeem points for discount |
| `GET` | `/loyalty/predict` | JWT | ML predicted points (30-day) |
| `GET` | `/loyalty/recommendations` | JWT | AI reward recommendations |
| `GET` | `/loyalty/rewards` | JWT | Available rewards catalog |

---

## Chatbot (AI-powered)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/chatbot/ask` | No | Ask anonymously |
| `POST` | `/chatbot/ask/authenticated` | JWT | Ask with user context |
| `POST` | `/chatbot/train` | Admin | Add training data |

---

## WebSocket

| Path | Description |
|------|-------------|
| `ws://host:5000/ws/live-tracking?train=TRAIN_NUMBER` | Live train tracking |

---

# Roadmap: Next Steps

## Phase 1: Containerization (Immediate)
- [ ] `Dockerfile` for backend (Node 20, Alpine)
- [ ] `docker-compose.yml` with PostgreSQL 18 + Redis 8.8.0
- [ ] Health checks, volume mounts, env file
- [ ] `docker-compose.dev.yml` for hot-reload

## Phase 2: Frontend (Now)
- [ ] Scaffold React/Vite project
- [ ] Login / Register pages
- [ ] Train search + results
- [ ] Seat selection UI
- [ ] Booking flow + payment
- [ ] My bookings / PNR enquiry
- [ ] User profile + saved passengers
- [ ] Loyalty dashboard (points, tier, predict ML chart)
- [ ] Chatbot widget (floating UI)
- [ ] Admin dashboard

## Phase 3: CI/CD
- [ ] GitHub Actions: lint → test → build → docker push
- [ ] Deploy to cloud (AWS ECS / GCP Cloud Run)
- [ ] Predictive auto-scaling with ML metrics

## Phase 4: Production Hardening
- [ ] Load testing (k6 / artillery)
- [ ] SSL/TLS termination
- [ ] Rate limit tuning
- [ ] CDN for static assets
- [ ] Monitoring / alerting (Datadog / Prometheus + Grafana)

---

## Stats

| Metric | Value |
|--------|-------|
| Route files | 15 |
| Routers mounted | 14 + 1 admin |
| Unique endpoints | ~82 |
| Total paths (/api + /api/v1) | ~164 |
| TypeScript | Zero errors |
| Tests | 34 passing |
