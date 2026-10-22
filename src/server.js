import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createCipher } from './crypto.js';
import { createStore } from './store.js';
import { createMailer } from './mail.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbFile);
const store = createStore(db, createCipher(config.encryptionKey));
const app = createApp({ config, store, mailer: createMailer(config) });

store.purgeExpired();
setInterval(() => store.purgeExpired(), 60 * 60_000).unref();

const server = app.listen(config.port, () => {
  console.info(`[santa] ${config.siteName} działa na porcie ${config.port} (${config.origin})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
