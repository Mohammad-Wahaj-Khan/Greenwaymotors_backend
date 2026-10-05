import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Environment } from '../../config/env.js';

function key(environment: Environment): Buffer {
  const configured = environment.DATA_ENCRYPTION_KEY;
  if (environment.NODE_ENV === 'production' && !configured)
    throw new Error('DATA_ENCRYPTION_KEY must be configured in production.');
  return createHash('sha256')
    .update(configured ?? 'greenway-test-only-local-encryption-key')
    .digest();
}
export function encryptJson(environment: Environment, value: unknown): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(environment), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}
export function decryptJson<T>(environment: Environment, encoded: string): T {
  const [version, iv, tag, ciphertext] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext)
    throw new Error('Encrypted payload format is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key(environment), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  ) as T;
}
