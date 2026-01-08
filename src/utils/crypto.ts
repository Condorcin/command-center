import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

const SALT_LENGTH = 16;
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Hash a password using PBKDF2
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = pbkdf2(sha256, password, salt, {
    c: ITERATIONS,
    dkLen: KEY_LENGTH,
  });
  
  // Store as: salt:hash (both hex encoded)
  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(hash);
  
  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(':');
  
  if (!saltHex || !hashHex) {
    return false;
  }
  
  const salt = hexToBytes(saltHex);
  const hash = pbkdf2(sha256, password, salt, {
    c: ITERATIONS,
    dkLen: KEY_LENGTH,
  });
  
  const computedHashHex = bytesToHex(hash);
  return computedHashHex === hashHex;
}

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return bytesToHex(randomBytes(32));
}

