// Creates a consistent, compact copy of the database: npm run backup [-- target.db]
// The copy is still encrypted where it matters (profiles, pairs, messages) –
// keep ENCRYPTION_KEY stored separately from backups.
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const config = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(process.argv[2] ?? path.join(config.dataDir, 'backups', `santa-${stamp}.db`));
(await import('node:fs')).mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const db = openDb(config.dbFile);
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`✔ Kopia zapisana: ${target}`);
