# RailFlow — Security Testing Rules

## 1. WebAuthn (Biometric Auth)

### Rule: Cryptographic signature MUST be verified server-side
- **NEVER** trust just `credentialId` match — attacker who knows a user's credentialId can login.
- Always use `@simplewebauthn/server` `verifyAuthenticationResponse()` which cryptographically verifies:
  - Challenge binding (replay protection)
  - Origin matching (phishing protection)
  - RP ID matching
  - Public key signature verification (actual cryptographic proof)
- Registration MUST use `verifyRegistrationResponse()` to validate attestation.

### Test Checklist
```
[  ] Auth options returns challenge + allowCredentials
[  ] Auth verify fails with wrong credentialId
[  ] Auth verify fails with replayed challenge
[  ] Auth verify fails with wrong origin
[  ] Auth verify succeeds with valid assertion
[  ] Counter increments after each auth
[  ] Register options returns valid PublicKeyCredentialCreationOptions
[  ] Register verify stores credentialPublicKey as Uint8Array base64url
[  ] Register verify clears challenge after success
```

---

## 2. MFA / TOTP Bypass

### Rule: Bypass code MUST be gated by NODE_ENV
- The bypass code (`123456` or `MFA_BYPASS_CODE` env var) MUST only work when `NODE_ENV !== 'production'`.
- **Before deploy**: verify `NODE_ENV=production` is set in production environment.
- Failing to set `NODE_ENV=production` means the bypass works in production too.

### Test Checklist
```
[  ] MFA verify rejects wrong TOTP code in production mode
[  ] MFA verify accepts bypass code in development mode
[  ] MFA verify rejects bypass code when NODE_ENV=production
[  ] MFA confirm follows same NODE_ENV gate
[  ] .env.example documents MFA_BYPASS_CODE and its NODE_ENV dependency
```

---

## 3. Rate Limiting

### Rule: Each endpoint has appropriate limits
```
Login:       20 requests / 15 min window
OTP send:    10 requests / 10 min window
General API: 100 requests / 1 min window (configurable)
```

### Test Checklist
```
[  ] Login endpoint blocks after 21+ requests in 15 min
[  ] OTP endpoint blocks after 11+ requests in 10 min
[  ] Rate limit resets after window expiry
[  ] Rate limit headers present in response
[  ] Admin endpoints have separate (higher) limits
```

---

## 4. JWT / Key Rotation

### Rule: Backend restart invalidates all tokens
- RSA signing keys are regenerated on `nodemon` restart (dev mode).
- JWT `iat` + `exp` must be validated on every protected request.
- Refresh tokens must be stored server-side (DB/Redis) for revocation.

### Test Checklist
```
[  ] Token issued before restart is rejected after restart
[  ] Refresh endpoint returns new valid token
[  ] Expired token returns 401
[  ] Tampered token returns 401
[  ] Token without proper signature returns 401
```

---

## 5. Payment PCI Compliance

### Rule: Raw card data NEVER reaches backend
- Card number, CVV, expiry are tokenized client-side before sending.
- Backend only receives a `paymentToken` — never the raw card data.
- UPI IDs and bank names are the only payment details stored.

### Test Checklist
```
[  ] Confirm booking API rejects raw card numbers
[  ] Payment token is non-reversible (no card data leak)
[  ] Card form fields never sent to backend logs
[  ] UPI and NetBanking flows send only non-sensitive data
```

---

## 6. Aadhaar Consent (DPDP Act 2023)

### Rule: Explicit consent required before Aadhaar processing
- User must check the consent checkbox on the booking form.
- Backend must verify `aadhaarConsentGiven: true` before processing.
- Consent check MUST fail-closed (default = denied).

### Test Checklist
```
[  ] Booking fails when aadhaarConsentGiven is false
[  ] Booking succeeds when aadhaarConsentGiven is true
[  ] Aadhaar numbers are masked in logs and responses
[  ] Consent is per-booking, not a one-time flag
```

---

## 7. Input Validation

### Rule: All API inputs validated with Zod before processing
- Every request body must pass schema validation.
- Rejected inputs return `400` with descriptive error.
- SQL injection prevented via parameterized queries (`db.run('?', [val])` — never string interpolation).

### Test Checklist
```
[  ] Invalid email format returns 400 on login/register
[  ] Missing required fields return 400
[  ] SQL injection attempts fail gracefully (not 500)
[  ] XSS payloads in name/email fields are rejected or escaped
[  ] PNR alphanumeric validation (max 10 chars)
```

---

## 8. CSRF Protection

### Rule: CSRF token required for state-changing requests
- Token stored in cookie (`csrfToken`), sent via `x-csrf-token` header.
- Backend validates header matches cookie on POST/PUT/DELETE.

### Test Checklist
```
[  ] POST without csrf token returns 403
[  ] GET requests do not require csrf token
[  ] Token mismatch returns 403
[  ] Token rotation on session change
```

---

## 9. Authentication & Session Security

### Rule: Every protected endpoint validates JWT + optional CSRF
- `authenticate` middleware checks `Authorization: Bearer <token>`.
- Token contains: `{ id, email, role, mfaVerified }`.
- Role-based access: `AdminRoute` requires `Admin` or `Super Admin` role.

### Test Checklist
```
[  ] Protected route returns 401 without token
[  ] Protected route returns 401 with expired token
[  ] Admin route returns 403 for Passenger role
[  ] Admin route returns 200 for Admin/Super Admin
[  ] Logout invalidates refresh token server-side
```

---

## 10. Environment & Deployment Safety

### Rule: Production hardening checklist (run before every deploy)
```
[  ] NODE_ENV=production set in environment (NOT in .env)
[  ] MFA_BYPASS_CODE removed or ignored in production
[  ] JWT_SECRET and JWT_REFRESH_SECRET are strong random values
[  ] CORS origin restricted to actual domain (not *)
[  ] CSRF enabled for all state-changing endpoints
[  ] Rate limits active (LOAD_TEST=false)
[  ] Database backups configured
[  ] HTTPS enforced (x-forwarded-proto check)
[  ] Error responses don't leak stack traces
[  ] Audit logging active for auth events
```

---

## Running Tests

```bash
# Backend
cd backend
npm test                 # Run all tests
npm run test:coverage    # With coverage report
npm run test:watch       # Watch mode

# Type checking
cd backend && npm run typecheck
cd frontend && npx tsc --noEmit

# Build verification
cd frontend && npx vite build
```
