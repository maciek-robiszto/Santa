import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createCipher } from './crypto.js';
import { createStore } from './store.js';
import { createMailer } from './mail.js';
import { createApp } from './app.js';
import { createScheduler } from './notify.js';

const config = loadConfig();
const db = openDb(config.dbFile);
const store = createStore(db, createCipher(config.encryptionKey));
const mailer = createMailer(config);
const app = createApp({ config, store, mailer });
createScheduler({ config, store, mailer }).start();

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
