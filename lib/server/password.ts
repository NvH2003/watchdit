import { randomBytes, pbkdf2 as pbkdf2Cb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Cb);
const ITERATIONS = 100_000;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** Dummy hash so missing accounts take the same time as a real verify. */
const DUMMY_STORED = `${'00'.repeat(SALT_BYTES)}:${'00'.repeat(KEYLEN)}`;

function hexToBytes(hex: string): Buffer | null {
  if (hex.length % 2 !== 0) return null;
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, ITERATIONS, KEYLEN, 'sha256');
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = hexToBytes(saltHex);
  const expected = hexToBytes(hashHex);
  if (!salt || !expected || expected.length !== KEYLEN) return false;
  const actual = await pbkdf2(password, salt, ITERATIONS, KEYLEN, 'sha256');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function verifyPasswordOrDummy(password: string, stored: string | null): Promise<boolean> {
  if (stored) return verifyPassword(password, stored);
  await verifyPassword(password, DUMMY_STORED);
  return false;
}
