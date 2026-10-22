// Wypełnia PUSTĄ lokalną bazę danymi demo: admin + wydarzenie + 8 uczestników.
// Użycie: npm run demo && npm run dev  →  http://localhost:3000
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createCipher, hashPassword } from '../src/crypto.js';
import { createStore } from '../src/store.js';

const config = loadConfig();
if (config.isProd) { console.error('Demo jest tylko do testów lokalnych.'); process.exit(1); }
const store = createStore(openDb(config.dbFile), createCipher(config.encryptionKey));
if (store.db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.error('Baza nie jest pusta. Usuń katalog ./data, żeby zacząć od nowa.');
  process.exit(1);
}

const PASSWORD = 'mikolajki-demo';
const hash = await hashPassword(PASSWORD);
const adminId = store.createUser({ email: 'admin@demo.pl', name: 'Organizator', passwordHash: hash, isAdmin: true });

const deadline = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const exchange = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
const eventId = store.createEvent({
  name: 'Makerskie Mikołajki (demo)',
  description: 'Robimy prezenty własnoręcznie albo wyszukujemy coś z sercem.\nWymiana na spotkaniu – przynieś prezent z etykietą!',
  budget: 'do 100 zł', location: 'robisz.to, sala warsztatowa, 18:00',
  signup_deadline: deadline, exchange_date: exchange, auto_draw: true, reveal_santas: true, owner_user_id: adminId,
});

const people = [
  ['Ala', 'Druk 3D i cosplay', 'Filament silk, magnesy neodymowe', 'Figurek z PLA mam za dużo'],
  ['Bartek', 'Stolarka, CNC', 'Dobre dłuto, klej do drewna', 'Słodycze'],
  ['Celina', 'Elektronika, ESP32', 'Fajne moduły, lutownica gazowa', ''],
  ['Darek', 'Retro komputery', 'Cokolwiek z lat 80.', 'Ubrania'],
  ['Ewa', 'Szycie, haft maszynowy', 'Nici, ładne tkaniny', 'Zapachowe świeczki'],
  ['Filip', 'Drony i FPV', 'Śmigła 5", akumulatory', ''],
  ['Gosia', 'Ceramika', 'Szkliwa, narzędzia do gliny', 'Alergia na orzechy'],
  ['Henryk', 'Kowalstwo, metal', 'Rękawice, coś do warsztatu', ''],
];
for (const [name, passions, wishes, avoid] of people) {
  const id = store.createUser({ email: `${name.toLowerCase()}@demo.pl`, name, passwordHash: hash });
  const p = store.joinEvent(eventId, id);
  store.saveProfile(p, { about: `Cześć, jestem ${name}!`, passions, wishes, avoid, social: '' }, true);
  store.audit({ eventId, actor: { id, name }, action: 'participant.join', detail: name, isPublic: true });
}

const invite = store.eventById(eventId).invite_token;
console.log(`
✔ Dane demo gotowe. Uruchom: npm run dev  →  http://localhost:${config.port}

  Admin:        admin@demo.pl            hasło: ${PASSWORD}
  Uczestnicy:   ala@demo.pl … henryk@demo.pl   hasło: ${PASSWORD}
  Nowe konto:   ${config.origin}/register  (każdy może założyć własną grupę)
  Zaproszenie:  ${config.origin}/join/${invite}

Wskazówka: zaloguj się na admina w zwykłym oknie, a na uczestnika w oknie
prywatnym (albo innej przeglądarce), żeby widzieć obie strony naraz.
`);
