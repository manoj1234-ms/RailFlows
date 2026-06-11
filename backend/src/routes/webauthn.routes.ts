import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { getDb } from '../config/db';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const router = Router();

function getOrigin(req: any): string {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getRpId(req: any): string {
  const host = (req.headers['x-forwarded-host'] || req.headers.host) as string;
  return host?.split(':')[0] || 'localhost';
}

// GET registration options — generates a challenge + user ID for the authenticator
router.get('/register/options', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(401).json({ status: 'error', message: 'Unauthorized' }); return; }
  try {
    const opts = await generateRegistrationOptions({
      rpName: 'RailFlow',
      rpID: getRpId(req),
      userName: req.user.email,
      userDisplayName: req.user.email,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    const db = await getDb();
    await db.run('UPDATE users SET webauthn_challenge = ?, webauthn_user_id = ? WHERE id = ?', [opts.challenge, opts.user.id, req.user.id]);

    res.status(200).json({ status: 'success', data: opts });
  } catch (error) { next(error); }
});

// POST verify registration — cryptographically verifies the attestation and stores the credential
router.post('/register/verify', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(401).json({ status: 'error', message: 'Unauthorized' }); return; }
  const { credential } = req.body;
  if (!credential) { res.status(400).json({ status: 'error', message: 'credential required' }); return; }
  try {
    const db = await getDb();
    const user = await db.get('SELECT webauthn_challenge FROM users WHERE id = ?', [req.user.id]);
    if (!user?.webauthn_challenge) { res.status(400).json({ status: 'error', message: 'No registration challenge found. Please request options first.' }); return; }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: user.webauthn_challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ status: 'error', message: 'Registration verification failed' });
      return;
    }

    const reg = verification.registrationInfo;
    const credentialIdB64 = reg.credential.id;
    const publicKeyB64 = Buffer.from(reg.credential.publicKey).toString('base64url');
    const counter = reg.credential.counter;

    await db.run(
      'UPDATE users SET webauthn_credential_id = ?, webauthn_public_key = ?, webauthn_counter = ?, webauthn_enabled = 1, webauthn_challenge = NULL WHERE id = ?',
      [credentialIdB64, publicKeyB64, counter, req.user.id]
    );

    res.status(200).json({ status: 'success', message: 'Biometric registered successfully' });
  } catch (error) { next(error); }
});

// GET authentication options — returns challenge and allowCredentials for login
router.get('/auth/options', async (req: any, res: Response, next: NextFunction) => {
  const { email } = req.query;
  if (!email) { res.status(400).json({ status: 'error', message: 'Email required' }); return; }
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !user.webauthn_enabled) { res.status(404).json({ status: 'error', message: 'Biometric not registered for this account' }); return; }

    const opts = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: [{
        id: user.webauthn_credential_id,
        transports: ['internal'],
      }],
      userVerification: 'required',
    });

    await db.run('UPDATE users SET webauthn_challenge = ? WHERE id = ?', [opts.challenge, user.id]);

    res.status(200).json({ status: 'success', data: opts });
  } catch (error) { next(error); }
});

// POST verify authentication — cryptographically verifies the assertion signature
router.post('/auth/verify', async (req: any, res: Response, next: NextFunction) => {
  const { email, credential } = req.body;
  if (!email || !credential) { res.status(400).json({ status: 'error', message: 'Email and credential required' }); return; }
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE email = ? AND webauthn_credential_id = ?', [email, credential.id]);
    if (!user) { res.status(401).json({ status: 'error', message: 'Credential not found for this user' }); return; }
    if (!user.webauthn_challenge) { res.status(400).json({ status: 'error', message: 'No authentication challenge found. Please request options first.' }); return; }

    const publicKeyBytes = new Uint8Array(Buffer.from(user.webauthn_public_key, 'base64url'));

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: user.webauthn_challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      credential: {
        id: user.webauthn_credential_id,
        publicKey: publicKeyBytes,
        counter: user.webauthn_counter || 0,
      },
    });

    if (!verification.verified) {
      res.status(401).json({ status: 'error', message: 'Biometric signature verification failed' });
      return;
    }

    const { generateAccessToken } = await import('../middleware/auth');
    const accessToken = generateAccessToken({ id: user.id, email: user.email, role: user.role, mfaVerified: false });

    await db.run('UPDATE users SET webauthn_counter = ?, webauthn_challenge = NULL WHERE id = ?', [verification.authenticationInfo?.newCounter || 0, user.id]);
    await db.run("INSERT INTO audit_logs (actor, action, ip, payload) VALUES (?, 'WEBAUTHN_LOGIN', ?, ?)", [email, req.ip || 'unknown', JSON.stringify({ method: 'biometric' })]);

    res.status(200).json({ status: 'success', message: 'Biometric login successful', accessToken, role: user.role });
  } catch (error) { next(error); }
});

export default router;
