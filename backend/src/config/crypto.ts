import crypto from 'crypto';

// Secret key for application-level encryption (simulates HashiCorp Vault key retrieval)
const ENCRYPTION_KEY = crypto.scryptSync('railflow-app-db-secret-encryption-key-string-32', 'salt-2026', 32);
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypts sensitive data (e.g., Aadhaar number, card details) before database storage.
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypts sensitive database data.
 */
export function decrypt(text: string): string {
  const textParts = text.split(':');
  const ivStr = textParts.shift();
  if (!ivStr) throw new Error('Invalid encrypted format');
  
  const iv = Buffer.from(ivStr, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

/**
 * Masks Aadhaar number showing only the last 4 digits.
 */
export function maskAadhaar(aadhaar: string): string {
  const clean = aadhaar.replace(/[^0-9]/g, '');
  if (clean.length < 4) return 'XXXX-XXXX-XXXX';
  const lastFour = clean.substring(clean.length - 4);
  return `XXXX-XXXX-${lastFour}`;
}
