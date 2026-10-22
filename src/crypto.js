import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const VERSION = 'v1';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const n = Number(N), rr = Number(r), pp = Number(p);
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: n, r: rr, p: pp, maxmem: 128 * n * rr * 2,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Precomputed hash used to keep login timing constant for unknown e-mails.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword(randomToken());
  await verifyPassword(password, dummyHash);
  return false;
}

/**
 * AES-256-GCM with associated data. The AAD binds every ciphertext to its row
 * (e.g. event + giver), so swapping ciphertexts between rows fails to decrypt.
 */
export function createCipher(key) {
  // Separate subkey so the raw env key is never used directly.
  const encKey = Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'santa:data-encryption', 32));

  function encrypt(plaintext, aad) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  function decrypt(blob, aad) {
    const [version, payload] = String(blob).split(':');
    if (version !== VERSION || !payload) throw new Error('Nieznany format szyfrogramu');
    const buf = Buffer.from(payload, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  return {
    encrypt,
    decrypt,
    encryptJSON: (obj, aad) => encrypt(JSON.stringify(obj), aad),
    decryptJSON: (blob, aad) => JSON.parse(decrypt(blob, aad)),
  };
}
