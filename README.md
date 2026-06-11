# RailFlow

High-concurrency Tatkal train ticket booking platform with Redis Redlock, Kafka event streaming, Saga orchestration, and DPDP Act 2023 compliance.

## Architecture

```
Frontend (React + Vite) → API Gateway → Backend (Express + TS)
                                        ├── PostgreSQL (primary)
                                        ├── Redis (caching + locks)
                                        └── Kafka (event streaming)
```

## Branch Strategy

| Branch | Purpose | CI |
|--------|---------|----|
| `develop` | Active development, feature PRs | ✅ lint + test |
| `test` | Pre-production validation | ✅ lint + test |
| `main` | Production releases | ✅ lint + test + build |

**Workflow:**
1. Feature branch → PR to `develop` → CI validates
2. `develop` → merge to `test` → pre-prod checks
3. `test` → merge to `main` → production build + Docker

## Getting Started

### Prerequisites

- Node.js 22
- PostgreSQL 16
- Redis 7
- Docker (optional)

### Setup

```bash
# Backend
cd backend
npm install --legacy-peer-deps
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npx vite
```

### Environment

Copy `.env.example` files and configure:

```bash
cp backend/.env.example backend/.env
```

Key variables: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.

## Testing

```bash
cd backend
npm test              # Run tests
npm run test:coverage # With coverage
npm run typecheck     # TypeScript check
```

## CI/CD

GitHub Actions runs on every push and PR:
- **lint:** TypeScript compilation check
- **test:** Jest with PostgreSQL + Redis containers
- **build:** (main only) TypeScript compile + Docker image
