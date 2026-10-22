import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const appUrl = new URL(env.APP_URL || 'http://localhost:3000');
  const dataDir = path.resolve(env.DATA_DIR || './data');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  let encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    if (isProd) throw new Error('ENCRYPTION_KEY jest wymagany w produkcji (npm run gen-key)');
    // Dev only: persist a local key so data survives restarts.
    const keyFile = path.join(dataDir, 'dev-encryption.key');
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    encryptionKey = fs.readFileSync(keyFile, 'utf8').trim();
    console.warn('[config] Brak ENCRYPTION_KEY – używam klucza deweloperskiego z', keyFile);
  }
  const keyBuf = Buffer.from(encryptionKey, 'base64');
  if (keyBuf.length !== 32) throw new Error('ENCRYPTION_KEY musi mieć 32 bajty w base64');

  if (isProd && appUrl.protocol !== 'https:') {
    throw new Error('APP_URL musi używać https:// w produkcji');
  }

  return {
    isProd,
    appUrl,
    origin: appUrl.origin,
    secureCookies: appUrl.protocol === 'https:',
    port: Number(env.PORT || 3000),
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'santa.db'),
    encryptionKey: keyBuf,
    siteName: env.SITE_NAME || 'Makerskie Mikołajki',
    trustProxy: env.TRUST_PROXY ?? (isProd ? '1' : 'false'),
    smtpUrl: env.SMTP_URL || '',
    mailFrom: env.MAIL_FROM || '',
    sessionDays: Number(env.SESSION_DAYS || 30),
  };
}
