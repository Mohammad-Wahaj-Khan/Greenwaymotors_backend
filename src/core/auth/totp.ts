import { createHmac, randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function createTotpSecret(): string {
  return base32Encode(randomBytes(20));
}
function base32Encode(bytes: Buffer): string {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function base32Decode(text: string): Buffer {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid authenticator secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secret: string, supplied: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(supplied)) return false;
  for (const step of [-1, 0, 1]) {
    const expected = totpCode(secret, timestamp + step * 30_000);
    if (constantTimeEqual(expected, supplied)) return true;
  }
  return false;
}
function constantTimeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(6).toString('hex').toUpperCase());
}
