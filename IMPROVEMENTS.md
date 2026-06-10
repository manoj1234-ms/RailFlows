# Auth & UI Improvements

## 1. Password Show/Hide Toggle (Eye Icon)
- **Files**: `Login.tsx`, `Register.tsx`
- **What**: Add eye icon button inside password fields to toggle password visibility
- **Why**: UX best practice, user requested
- **Status**: ✅ DONE

## 2. Google/Apple Auth — Remove or Replace
- **Files**: `Login.tsx`
- **What**: Google and Apple buttons exist but are non-functional (no OAuth config). Either remove them or wire up real OAuth
- **Options**:
  - Replace with "IRCTC" or "Aadhaar" branded login buttons
  - Or integrate real Google OAuth (requires backend client ID)
  - Or make them open a toast: "Coming soon"

## 3. Aadhaar-Based Verification (Replace Email)
- **Files**: `Register.tsx`, `backend/`
- **What**: Since the system uses Aadhaar for passenger identity, registration should verify via Aadhaar (not email)
- **Changes needed**:
  - Replace email verification flow with Aadhaar OTP verification
  - Backend: Add Aadhaar OTP API (send OTP to registered mobile via UIDAI-like flow)
  - Frontend: Aadhaar number input → send OTP → verify OTP → complete registration
  - Keep email as optional contact field

## 4. Mobile / SMS Verification
- **Files**: `Register.tsx`, `Login.tsx`, `backend/`
- **What**: Add mobile OTP verification on registration and login
- **Changes needed**:
  - Backend: SMS OTP service (Twilio/MSG91 mock)
  - Frontend: Phone input → "Send OTP" → OTP input → verify
  - Login: "Login with OTP" option (phone → OTP → token)

## 5. 3D Animations
- **Files**: `Landing.tsx`, `Login.tsx`, or shared components
- **What**: Add 3D animations (e.g., rotating train model, 3D card flip, particle effects)
- **Options**:
  - Three.js / react-three-fiber for 3D models
  - CSS 3D transforms for card flips
  - Framer Motion 3D (`rotateX`, `rotateY`, `perspective`)
  - Train SVG with 3D-ish perspective animation

## 6. Other Auth UX Fixes
- Show password strength indicator on Register
- Add loading skeleton states for auth pages
- Add "Resend OTP" timer (30s cooldown)
- Add biometric auth option (WebAuthn) for supported browsers
