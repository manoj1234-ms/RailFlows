# RailFlow Fly.io Deploy (PowerShell)
# Requires: flyctl installed (scoop install flyctl or winget install flyctl)

# 1. Login/Signup
flyctl auth signup

# 2. Launch app (uses fly.toml)
flyctl launch --no-deploy

# 3. Create PostgreSQL database (free: 1GB)
flyctl postgres create --name railflow-db --region bom --initial-cluster-size 1 --vm-size shared-cpu-1x-256

# 4. Attach database to app
flyctl postgres attach railflow-db --app railflow-api

# 5. Set secrets
flyctl secrets set JWT_SECRET=your_jwt_secret JWT_REFRESH_SECRET=your_refresh_secret

# 6. Deploy
flyctl deploy

# 7. Open app
flyctl open
