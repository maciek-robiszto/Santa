// Usage: npm run admin:create -- --email ja@example.com --name "Ja"
// Password is read from ADMIN_PASSWORD or asked interactively (hidden).
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createCipher, hashPassword } from '../src/crypto.js';
import { createStore } from '../src/store.js';
import * as v from '../src/validate.js';

const { values: args } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const config = loadConfig();
const store = createStore(openDb(config.dbFile), createCipher(config.encryptionKey));

const email = v.email(args.email);
if (email.error) { console.error('Podaj --email'); process.exit(1); }

const existing = store.userByEmail(email.value);
if (existing) {
  store.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
  console.log(`✔ ${existing.email} ma teraz uprawnienia admina.`);
  process.exit(0);
}

const name = v.line(args.name ?? 'Admin', 60, { required: true });
const password = v.password(process.env.ADMIN_PASSWORD ?? await askHidden('Hasło admina (min. 10 znaków): '));
if (password.error) { console.error(password.error); process.exit(1); }

store.createUser({ email: email.value, name: name.value, passwordHash: await hashPassword(password.value), isAdmin: true });
console.log(`✔ Utworzono admina ${email.value}`);
