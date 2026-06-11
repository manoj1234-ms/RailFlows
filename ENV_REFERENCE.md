# ──────────────────────────────────────────
# RailFlow — Environment Variables Reference
# Copy to Railway dashboard after deploy
# ──────────────────────────────────────────

NODE_ENV=production
PORT=5000
CLUSTER_ENABLED=false

# ── PostgreSQL (Neon) ─────────────────────
# From Neon dashboard → Connection Details → PSQL
# Parse DATABASE_URL into these:
# DATABASE_URL: postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/railflow?sslmode=require
PGHOST=ep-xxx.us-east-2.aws.neon.tech
PGPORT=5432
PGUSER=railflow_owner
PGPASSWORD=np_xxx_your_password
PGDATABASE=railflow
PGSSLMODE=require

# ── Redis (Upstash) ───────────────────────
REDIS_URL=rediss://default:xxx@us1-valid-whale-12345.upstash.io:6379

# ── Kafka (Upstash) ───────────────────────
KAFKA_BROKERS=valid-whale-12345.upstash.io:9092
KAFKA_SASL_USERNAME=xxx
KAFKA_SASL_PASSWORD=xxx

# ── JWT ───────────────────────────────────
JWT_SECRET=your_random_secret_here
JWT_REFRESH_SECRET=your_random_refresh_secret_here

# ── SMTP (Resend) ─────────────────────────
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_xxx_your_resend_api_key
SMTP_FROM=noreply@railflow.app

# ── CORS ──────────────────────────────────
ALLOWED_ORIGINS=https://railflow-app.vercel.app

# ── OTel (optional) ──────────────────────
OTEL_ENABLED=false
OTEL_SERVICE_NAME=railflow-api
