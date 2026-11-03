// Uczestnicy bez hasła: jeden link grupy + jednorazowy link z maila.
// Testy sprawdzają przede wszystkim, czego NIE da się w ten sposób zrobić.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hashPassword, sha256 } from '../src/crypto.js';
import { startTestApp, linkFrom } from './helpers.js';

const PASSWORD = 'admin-password-1';
const CONFIRM = (name = 'Ala') => ({ name, consent: '1' });
let t, org, eventId, invite;
const eventPage = () => `/events/${eventId}`;
const lastTo = (email) => t.sent.findLast((m) => m.to === email);
const requestJoin = (c, name, email) => c.post(`/join/${invite}`, { name, email });
const createAdmin = (email, password) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/create-admin.js', '--email', email], {
  env: { ...process.env, DATA_DIR: t.dir, ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ADMIN_PASSWORD: password, NODE_ENV: 'test', APP_URL: 'http://localhost:0' },
  stdio: 'pipe',
});

before(async () => {
  t = await startTestApp();
  t.store.createUser({ email: 'org@test.pl', name: 'Org', passwordHash: await hashPassword(PASSWORD) });
  org = t.client();
  await org.post('/login', { email: 'org@test.pl', password: PASSWORD });
  const r = await org.post('/manage/events', { name: 'Grupa' });
  eventId = Number(r.location.split('/').pop());
  invite = t.store.eventById(eventId).invite_token;
});
after(() => t.close());

test('the form under the invite link does not ask for a password', async () => {
  const page = await t.client().get(`/join/${invite}`);
  assert.doesNotMatch(page.text, /name="password"/);
  assert.match(page.text, /name="email"/);
});

test('the form alone creates nothing and logs nobody in', async () => {
  const c = t.client();
  assert.equal((await requestJoin(c, 'Ala', 'ala@test.pl')).status, 200);
  assert.equal(t.store.userByEmail('ala@test.pl'), undefined);
  assert.equal((await c.get(eventPage())).status, 303);
  assert.equal(t.store.participants(eventId).length, 0);
});

test('an address the mailer could misread is refused', async () => {
  assert.equal((await requestJoin(t.client(), 'Ala', 'ala<atak@test.pl>')).status, 422);
});

test('opening the link (GET, e.g. a mail scanner) does not use it up', async () => {
  const c = t.client();
  await requestJoin(c, 'Ala', 'ala@test.pl');
  const token = linkFrom(lastTo('ala@test.pl'));
  for (let i = 0; i < 2; i++) assert.equal((await t.client().get(`/link/${token}`)).status, 200);
  assert.equal(t.store.userByEmail('ala@test.pl'), undefined);
  assert.equal((await c.get(eventPage())).status, 303);
});

test('a mistake in the confirmation form does not burn the link', async () => {
  const c = t.client();
  await requestJoin(c, 'Ala', 'ala@test.pl');
  const token = linkFrom(lastTo('ala@test.pl'));
  assert.equal((await c.post(`/link/${token}`, { name: 'Ala' })).status, 422, 'consent required');
  assert.equal((await c.post(`/link/${token}`, { consent: '1' })).status, 422, 'name required');
  assert.equal(t.store.userByEmail('ala@test.pl'), undefined);
  assert.equal((await c.get(`/link/${token}`)).status, 200);
});

test('confirming joins once; the link cannot be used again', async () => {
  const c = t.client();
  await requestJoin(c, 'Ala', 'ala@test.pl');
  const token = linkFrom(lastTo('ala@test.pl'));
  const r = await c.post(`/link/${token}`, CONFIRM());
  assert.equal(r.status, 303);
  assert.equal(r.location, `${eventPage()}#profil`);
  assert.equal((await c.get(eventPage())).status, 200);
  assert.equal(t.store.userByEmail('ala@test.pl').password_hash, '');

  const thief = t.client();
  assert.equal((await thief.get(`/link/${token}`)).status, 404);
  assert.equal((await thief.post(`/link/${token}`, CONFIRM())).status, 404);
  assert.equal((await thief.get(eventPage())).status, 303);
});

test('of two simultaneous confirmations only one gets a session', async () => {
  const c = t.client();
  await requestJoin(c, 'Bartek', 'bartek@test.pl');
  const token = linkFrom(lastTo('bartek@test.pl'));
  const [a, b] = [t.client(), t.client()];
  await Promise.all([a.get('/'), b.get('/')]);
  const codes = (await Promise.all([a.post(`/link/${token}`, CONFIRM('B')), b.post(`/link/${token}`, CONFIRM('B'))])).map((r) => r.status).sort();
  assert.deepEqual(codes, [303, 404]);
});

test('tokens are stored only as hashes', async () => {
  await requestJoin(t.client(), 'Celina', 'celina@test.pl');
  const token = linkFrom(lastTo('celina@test.pl'));
  const rows = t.store.db.prepare('SELECT token_hash FROM login_links').all().map((x) => x.token_hash);
  assert.ok(!rows.includes(token));
  assert.ok(rows.includes(sha256(token)));
});

test('an expired link does not work', async () => {
  const c = t.client();
  await requestJoin(c, 'Darek', 'darek@test.pl');
  const token = linkFrom(lastTo('darek@test.pl'));
  t.store.db.prepare('UPDATE login_links SET expires_at = 1 WHERE token_hash = ?').run(sha256(token));
  assert.equal((await c.get(`/link/${token}`)).status, 404);
  assert.equal((await c.post(`/link/${token}`, CONFIRM())).status, 404);
  assert.equal(t.store.userByEmail('darek@test.pl'), undefined);
});

test('someone with the invite cannot enter an account by typing its address', async () => {
  const ala = t.store.userByEmail('ala@test.pl');
  const attacker = t.client();
  t.sent.length = 0;
  assert.equal((await requestJoin(attacker, 'Haker', 'ala@test.pl')).status, 200);
  assert.equal((await attacker.get(eventPage())).status, 303);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, 'ala@test.pl');
  // The name typed by the attacker does not reach the existing account.
  await t.client().post(`/link/${linkFrom(t.sent[0])}`, { name: 'Haker' });
  assert.equal(t.store.userByEmail('ala@test.pl').name, ala.name);
});

test('for an existing account the join link lives as briefly as a login link', async () => {
  await t.joinByMail(t.client(), invite, { name: 'Marek', email: 'marek@test.pl' });
  t.sent.length = 0;
  await requestJoin(t.client(), 'Haker', 'marek@test.pl');
  const row = t.store.loginLink(linkFrom(t.sent[0]));
  assert.ok(row.expires_at - Date.now() <= 31 * 60_000);
  assert.match(t.sent[0].text, /30 minut/);
});

test('mails carry nothing typed by the requester', async () => {
  const c = t.client();
  await c.post('/register', { name: 'Atakujacy', email: 'atakujacy@test.pl' });
  await c.post(`/link/${linkFrom(lastTo('atakujacy@test.pl'))}`, { name: 'Atakujacy', password: PASSWORD, consent: '1' });
  const g = await c.post('/manage/events', { name: 'KLIKNIJ evil.example' });
  const inviteEvil = t.store.eventById(Number(g.location.split('/').pop())).invite_token;
  await t.client().post(`/join/${inviteEvil}`, { name: 'Kliknij https://evil.example/x', email: 'cel@test.pl' });
  const m = lastTo('cel@test.pl');
  assert.doesNotMatch(`${m.subject} ${m.text}`, /evil\.example|KLIKNIJ/i);
});

test('a confirmed link retires the other links of that address', async () => {
  const c = t.client();
  await t.joinByMail(t.client(), invite, { name: 'Nina', email: 'nina@test.pl' });
  await c.post('/login/link', { email: 'nina@test.pl' });
  const a = linkFrom(lastTo('nina@test.pl'));
  await requestJoin(t.client(), 'Nina', 'nina@test.pl');
  const b = linkFrom(lastTo('nina@test.pl'));
  assert.notEqual(a, b);
  assert.equal((await c.post(`/link/${b}`, {})).status, 303);
  assert.equal((await t.client().post(`/link/${a}`, {})).status, 404);
});

test('the response does not reveal whether an address has an account', async () => {
  const norm = (s) => s.replace(/value="[^"]*"/g, '').replace(/<b>[^<]*@[^<]*<\/b>/g, '');
  for (const post of [(email) => requestJoin(t.client(), 'X', email), (email) => t.client().post('/register', { name: 'X', email })]) {
    const known = await post('org@test.pl');
    const unknown = await post(`nikt-${crypto.randomUUID()}@test.pl`);
    assert.equal(known.status, unknown.status);
    assert.equal(norm(known.text), norm(unknown.text));
  }
});

test('accounts with a password never get a link that skips the password', async () => {
  const attacker = t.client();
  t.sent.length = 0;
  await requestJoin(attacker, 'Haker', 'org@test.pl');
  assert.equal(linkFrom(t.sent[0]), undefined);
  await attacker.post('/login/link', { email: 'org@test.pl' });
  assert.equal(t.sent.length, 1, 'no login link for an account with a password');
  assert.equal((await attacker.get('/manage')).status, 303);
});

test('a link issued before setting a password stops working', async () => {
  const c = t.client();
  await t.joinByMail(c, invite, { name: 'Ewa', email: 'ewa@test.pl' });
  await c.post('/login/link', { email: 'ewa@test.pl' });
  const stale = linkFrom(lastTo('ewa@test.pl'));
  await c.post('/forgot', { email: 'ewa@test.pl' });
  const reset = lastTo('ewa@test.pl').text.match(/\/reset\/[\w-]+/)[0];
  await c.post(reset, { password: 'haslo-testowe-1' });
  const thief = t.client();
  assert.equal((await thief.post(`/link/${stale}`, {})).status, 404);
  // Even a link that slipped through must not open an account with a password.
  const forced = t.store.createLoginLink({ email: 'ewa@test.pl', hours: 1 });
  assert.equal((await thief.post(`/link/${forced}`, {})).location, '/login');
  assert.equal((await thief.get('/account')).status, 303);
});

test('returning: login link works for participants, the same answer for everyone', async () => {
  const c = t.client();
  await t.joinByMail(t.client(), invite, { name: 'Ola', email: 'ola@test.pl' });
  t.sent.length = 0;
  const known = await c.post('/login/link', { email: 'ola@test.pl' });
  const unknown = await t.client().post('/login/link', { email: 'nikt-taki@test.pl' });
  assert.equal(t.sent.length, 1);
  assert.equal(known.status, unknown.status);
  assert.match(unknown.text, /jednorazowy link/);
  const r = await c.post(`/link/${linkFrom(t.sent[0])}`, {});
  assert.equal(r.location, '/');
  assert.equal((await c.get(eventPage())).status, 200);
});

test('a participant cannot log in with an empty or guessed password', async () => {
  for (const password of ['', 'cokolwiek-1234']) {
    assert.equal((await t.client().post('/login', { email: 'ala@test.pl', password })).status, 401);
  }
});

test('mail flooding from one source is limited', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await requestJoin(t.client(), 'Z', 'flood@test.pl');
  assert.equal(last.status, 429);
  assert.ok(t.sent.filter((m) => m.to === 'flood@test.pl').length <= 5);
});

test('mails triggered from one IP are limited', async () => {
  t.config.mailPerIpHour = 1;
  try {
    assert.equal((await requestJoin(t.client(), 'Z', 'ip-limit@test.pl')).status, 429);
    assert.equal(lastTo('ip-limit@test.pl'), undefined);
  } finally {
    t.config.mailPerIpHour = 10000;
  }
});

test('rotating the invite cancels pending links', async () => {
  const c = t.client();
  const old = t.store.eventById(eventId).invite_token;
  await requestJoin(c, 'Filip', 'filip@test.pl');
  const token = linkFrom(lastTo('filip@test.pl'));
  await org.post(`/manage/events/${eventId}/invite`, {});
  invite = t.store.eventById(eventId).invite_token;
  assert.equal((await c.post(`/link/${token}`, CONFIRM('Filip'))).status, 404);
  assert.equal((await t.client().get(`/join/${old}`)).status, 404);
});

test('a link confirmed after signup closed creates no account', async () => {
  const c = t.client();
  await requestJoin(c, 'Gosia', 'gosia@test.pl');
  const token = linkFrom(lastTo('gosia@test.pl'));
  t.store.setEventStatus(eventId, 'drawn');
  const r = await c.post(`/link/${token}`, CONFIRM('Gosia'));
  t.store.setEventStatus(eventId, 'open');
  assert.equal(r.location, `/join/${invite}`);
  assert.equal(t.store.userByEmail('gosia@test.pl'), undefined);
});

// ---------- zajmowanie cudzego adresu ----------

test('registering a foreign address gives the attacker nothing', async () => {
  const attacker = t.client();
  const r = await attacker.post('/register', { name: 'Ofiara', email: 'ofiara@test.pl', password: 'haslo-atakujacego-1', consent: '1' });
  assert.equal(r.status, 200);
  assert.equal(t.store.userByEmail('ofiara@test.pl'), undefined);
  assert.equal((await attacker.get('/account')).status, 303);
  assert.equal((await t.client().post('/login', { email: 'ofiara@test.pl', password: 'haslo-atakujacego-1' })).status, 401);
  assert.equal(t.store.db.prepare("SELECT COUNT(*) n FROM pragma_table_info('login_links') WHERE name LIKE '%password%'").get().n, 0);
});

test('the password is chosen by the mailbox owner, on the confirmation page', async () => {
  // Attacker's request; the victim then clicks the link from the mail.
  await t.client().post('/register', { name: 'Ofiara', email: 'ofiara2@test.pl', password: 'haslo-atakujacego-1' });
  const token = linkFrom(lastTo('ofiara2@test.pl'));
  const victim = t.client();
  assert.match((await victim.get(`/link/${token}`)).text, /name="password"/);
  assert.equal((await victim.post(`/link/${token}`, { name: 'Ofiara', consent: '1' })).status, 422, 'password required');
  assert.equal((await victim.post(`/link/${token}`, { name: 'Ofiara', password: 'haslo-ofiary-123', consent: '1' })).status, 303);
  assert.equal((await t.client().post('/login', { email: 'ofiara2@test.pl', password: 'haslo-atakujacego-1' })).status, 401);
  assert.equal((await t.client().post('/login', { email: 'ofiara2@test.pl', password: 'haslo-ofiary-123' })).status, 303);
});

test('an organizer link stays safe if the address got an account in the meantime', async () => {
  await t.client().post('/register', { name: 'Hubert', email: 'hubert@test.pl' });
  const token = linkFrom(lastTo('hubert@test.pl'));
  await t.joinByMail(t.client(), invite, { name: 'Hubert', email: 'hubert@test.pl' });
  // The participant's confirmation retired the other link.
  assert.equal((await t.client().post(`/link/${token}`, { password: PASSWORD })).status, 404);
  assert.equal(t.store.userByEmail('hubert@test.pl').password_hash, '');
});

test('no account can change its address, so nothing can be redirected or squatted', async () => {
  const c = t.client();
  await t.registerByMail(c, { name: 'Ida', email: 'ida@test.pl', password: PASSWORD });
  assert.doesNotMatch((await c.get('/account')).text, /name="email"/);
  await c.post('/account', { name: 'Ida Nowa', email: 'zlodziej@test.pl', email_password: PASSWORD });
  assert.equal(t.store.userByEmail('zlodziej@test.pl'), undefined);
  assert.equal(t.store.userByEmail('ida@test.pl').name, 'Ida Nowa');
  assert.equal(t.store.db.prepare("SELECT COUNT(*) n FROM login_links WHERE email = 'zlodziej@test.pl'").get().n, 0);
});

test('requests for other variants of an address do not cancel a valid link', async () => {
  await t.joinByMail(t.client(), invite, { name: 'Sara', email: 'sara@test.pl' });
  const before = t.client();
  await before.post('/login/link', { email: 'sara@test.pl' });
  const valid = linkFrom(lastTo('sara@test.pl'));
  const quota = () => t.store.loginLink(valid);
  for (let i = 0; i < 25; i++) await t.client().post('/login/link', { email: `sara+${i}@test.pl` });
  assert.ok(quota(), 'plus-address variants did not rotate the link');
  assert.equal((await t.client().post('/login', { email: 'org@test.pl', password: 'zle-haslo-12345' })).status, 401);
});

test('plus-address variants count as one mailbox', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await requestJoin(t.client(), 'Z', `plus+${i}@test.pl`);
  assert.equal(last.status, 429);
});

test('attempts on one address do not close signups for the whole group', async () => {
  for (let i = 0; i < 110; i++) await requestJoin(t.client(), 'Z', 'jeden-adres@test.pl');
  assert.equal((await requestJoin(t.client(), 'Uczciwa', 'uczciwa@test.pl')).status, 200);
});

test('create-admin always sets the operator password and drops other sessions', async () => {
  const squatter = t.client();
  await t.registerByMail(squatter, { name: 'Szef', email: 'szef@test.pl', password: 'haslo-squattera-1' });
  createAdmin('szef@test.pl', PASSWORD);
  const user = t.store.userByEmail('szef@test.pl');
  assert.equal(user.is_admin, 1);
  assert.equal((await squatter.get('/account')).status, 303);
  assert.equal((await t.client().post('/login', { email: 'szef@test.pl', password: 'haslo-squattera-1' })).status, 401);
  assert.equal((await t.client().post('/login', { email: 'szef@test.pl', password: PASSWORD })).status, 303);
});

test('create-admin gives a promoted participant a password, so a link cannot open it', async () => {
  const c = t.client();
  await t.joinByMail(c, invite, { name: 'Hania', email: 'hania@test.pl' });
  createAdmin('hania@test.pl', PASSWORD);
  const user = t.store.userByEmail('hania@test.pl');
  assert.equal(user.is_admin, 1);
  assert.ok(user.password_hash);
  assert.equal((await c.get('/account')).status, 303, 'old sessions are dropped');
  t.sent.length = 0;
  await t.client().post('/login/link', { email: 'hania@test.pl' });
  assert.equal(t.sent.length, 0);
});

// ---------- pozostałe ----------

test('a reused participant id never shows someone from another group', async () => {
  const owner = t.client();
  await t.registerByMail(owner, { name: 'Org2', email: 'org2@test.pl', password: PASSWORD });
  const g = Number((await owner.post('/manage/events', { name: 'Stara grupa', join_self: '1' })).location.split('/').pop());
  const inv = t.store.eventById(g).invite_token;
  const members = {};
  for (const name of ['M1', 'M2']) {
    members[name] = t.client();
    await t.joinByMail(members[name], inv, { name, email: `${name.toLowerCase()}@test.pl` });
  }
  await owner.post(`/manage/events/${g}/draw`, {});
  t.store.setEventStatus(g, 'finished');

  const last = t.store.participants(g).sort((a, b) => b.id - a.id)[0];
  const giver = t.store.participants(g).find((p) => t.store.recipientIdOf(g, p.id) === last.id);
  t.store.deleteUser(last.user_id);

  const z = t.store.createUser({ email: 'zofia@test.pl', name: 'Nieznajoma Zofia', passwordHash: '' });
  const reused = t.store.joinEvent(eventId, z);
  assert.equal(reused.id, last.id, 'precondition: SQLite reused the id');
  assert.equal(t.store.recipientIdOf(g, giver.id), reused.id);
  assert.equal(t.store.participantInEvent(g, reused.id), undefined);

  const giverClient = giver.user_id === t.store.userByEmail('org2@test.pl').id ? owner
    : giver.user_id === t.store.userByEmail('m1@test.pl')?.id ? members.M1 : members.M2;
  assert.doesNotMatch((await giverClient.get(`/events/${g}`)).text, /Nieznajoma Zofia/);
  assert.equal((await giverClient.get(`/events/${g}/label`)).status, 404);
});

test('switching accounts through a link is shown before it happens', async () => {
  const c = t.client();
  await t.joinByMail(c, invite, { name: 'Kuba', email: 'kuba@test.pl' });
  await t.joinByMail(t.client(), invite, { name: 'Pola', email: 'pola@test.pl' });
  await t.client().post('/login/link', { email: 'pola@test.pl' });
  const page = await c.get(`/link/${linkFrom(lastTo('pola@test.pl'))}`);
  assert.match(page.text, /kuba@test\.pl/);
  assert.match(page.text, /przełączy Cię na inne konto/);
});

test('logging out other devices keeps this session as it was and tells the owner', async () => {
  const [a, b] = [t.client(), t.client()];
  await t.joinByMail(a, invite, { name: 'Lena', email: 'lena@test.pl' });
  await a.post('/login/link', { email: 'lena@test.pl' });
  await b.post(`/link/${linkFrom(lastTo('lena@test.pl'))}`, {});
  assert.equal((await b.get('/account')).status, 200);
  const expiry = () => t.store.db.prepare('SELECT MIN(expires_at) e FROM sessions WHERE user_id = ?').get(t.store.userByEmail('lena@test.pl').id).e;
  t.store.db.prepare('UPDATE sessions SET expires_at = expires_at - 1000 WHERE user_id = ?').run(t.store.userByEmail('lena@test.pl').id);
  const lowered = expiry();
  assert.equal((await a.post('/account/logout-all', {})).status, 303);
  assert.equal((await b.get('/account')).status, 303);
  assert.equal((await a.get('/account')).status, 200);
  assert.equal(expiry(), lowered, 'a stolen session cannot extend itself');
  assert.match(lastTo('lena@test.pl').subject, /wylogowano/);
});

test('a participant cannot organize, redirect the address or delete without confirming', async () => {
  const c = t.client();
  await t.joinByMail(c, invite, { name: 'Rysiek', email: 'rysiek@test.pl' });
  assert.equal((await c.post('/manage/events', { name: 'Nie wolno' })).status, 404);
  assert.equal((await c.post(`/manage/events/${eventId}`, { name: 'Przejęta' })).status, 404);

  await c.post('/account', { name: 'Rysiek', email: 'atak@test.pl' });
  assert.ok(t.store.userByEmail('rysiek@test.pl'));
  assert.equal(t.store.userByEmail('atak@test.pl'), undefined);

  assert.equal((await c.post('/account/delete', { confirm_email: 'inny@test.pl' })).status, 422);
  assert.ok(t.store.userByEmail('rysiek@test.pl'));
  assert.equal((await c.post('/account/delete', { confirm_email: 'rysiek@test.pl' })).status, 303);
  assert.equal(t.store.userByEmail('rysiek@test.pl'), undefined);
});

test('without SMTP the invite falls back to a password form', async () => {
  t.mailer.enabled = false;
  try {
    const c = t.client();
    assert.match((await c.get(`/join/${invite}`)).text, /name="password"/);
    assert.match((await c.get('/register')).text, /name="password"/);
    assert.doesNotMatch((await c.get('/login')).text, /action="\/login\/link"/);
    assert.equal((await c.post('/login/link', { email: 'x@test.pl' })).status, 404);
    const r = await c.post(`/join/${invite}`, { name: 'Igor', email: 'igor@test.pl', password: 'haslo-testowe-1', consent: '1' });
    assert.equal(r.status, 303);
    assert.ok(t.store.userByEmail('igor@test.pl').password_hash);
  } finally {
    t.mailer.enabled = true;
  }
});
