import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../src/crypto.js';
import { startTestApp } from './helpers.js';

let t, store, dir, sent, admin;
before(async () => {
  t = await startTestApp();
  ({ store, dir, sent } = t);
  admin = t.client();
  store.createUser({ email: 'admin@test.pl', name: 'Admin', passwordHash: await hashPassword('admin-password-1'), isAdmin: true });
});
after(() => t.close());

const Client = class { constructor() { return t.client(); } };

const people = [];
let eventId, invite;

test('security headers on pages', async () => {
  const r = await admin.get('/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('CSRF token is required', async () => {
  const c = new Client();
  await c.get('/');
  const r = await c.req('POST', '/login', null);
  assert.equal(r.status, 403);
});

test('admin logs in and creates event', async () => {
  const bad = await admin.post('/login', { email: 'admin@test.pl', password: 'nope-nope-nope' });
  assert.equal(bad.status, 401);
  const r = await admin.post('/login', { email: 'admin@test.pl', password: 'admin-password-1' });
  assert.equal(r.status, 303);
  const c = await admin.post('/manage/events', { name: 'Mikołajki 2026', description: 'Test', budget: '100 zł', location: 'Hackerspace' });
  assert.equal(c.status, 303);
  eventId = Number(c.location.split('/').pop());
  invite = store.eventById(eventId).invite_token;
});

test('participants join via invite and fill profiles', async () => {
  for (const name of ['Ala', 'Bartek', 'Celina', 'Darek', 'Ewa']) {
    const c = new Client();
    const r = await c.post(`/join/${invite}`, { name, email: `${name.toLowerCase()}@test.pl`, password: 'haslo-testowe-1', consent: '1' });
    assert.equal(r.status, 303, r.text);
    const p = await c.post(`/events/${eventId}/profile`, {
      about: `Jestem ${name} <script>alert(1)</script>`, passions: 'druk 3D', wishes: `sekret-${name}`, avoid: '', social: 'github.com/x',
    });
    assert.equal(p.status, 303);
    people.push({ name, c });
  }
  const dup = await new Client().post(`/join/${invite}`, { name: 'X', email: 'ala@test.pl', password: 'haslo-testowe-1', consent: '1' });
  assert.equal(dup.status, 422);
});

test('participants cannot manage a group they do not organize', async () => {
  assert.equal((await people[0].c.get(`/manage/events/${eventId}`)).status, 404);
  assert.equal((await people[0].c.post(`/manage/events/${eventId}/draw`, {})).status, 404);
  const outsider = new Client();
  await outsider.post(`/join/${invite}`, { name: 'Obcy', email: 'obcy@test.pl', password: 'haslo-testowe-1', consent: '1' });
  await outsider.post(`/events/${eventId}/leave`, {});
  assert.equal((await outsider.get(`/events/${eventId}`)).status, 404);
});

test('draw creates a secret, valid assignment', async () => {
  const r = await admin.post(`/manage/events/${eventId}/draw`, {});
  assert.equal(r.status, 303);
  const names = people.map((p) => p.name);
  const recipients = [];
  for (const p of people) {
    const page = (await p.c.get(`/events/${eventId}`)).text;
    const m = page.match(/class="recipient-name">([^<]+)</);
    assert.ok(m, 'recipient shown');
    assert.notEqual(m[1], p.name);
    assert.ok(names.includes(m[1]));
    recipients.push(m[1]);
    // recipient's profile is rendered escaped
    assert.ok(!page.includes('<script>alert(1)</script>'));
    assert.ok(page.includes('&lt;script&gt;'));
    assert.ok(page.includes(`sekret-${m[1]}`));
  }
  assert.equal(new Set(recipients).size, people.length);

  // Admin page must not show any pairing.
  const adminPage = (await admin.get(`/manage/events/${eventId}`)).text;
  assert.ok(!adminPage.includes('recipient-name'));
  assert.ok(!/sekret-/.test(adminPage));
});

test('database holds no plaintext secrets', () => {
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const raw = fs.readFileSync(path.join(dir, 'santa.db')).toString('latin1');
  assert.ok(!raw.includes('sekret-'), 'profile text encrypted');
  for (const row of store.db.prepare('SELECT recipient_enc FROM assignments').all()) assert.match(row.recipient_enc, /^v1:/);
});

test('anonymous messages reach the right person', async () => {
  const [ala] = people;
  const page = (await ala.c.get(`/events/${eventId}`)).text;
  const recName = page.match(/class="recipient-name">([^<]+)</)[1];
  await ala.c.post(`/events/${eventId}/messages`, { to: 'recipient', body: 'Wolisz PLA czy PETG?' });
  const rec = people.find((p) => p.name === recName);
  const recPage = (await rec.c.get(`/events/${eventId}`)).text;
  assert.ok(recPage.includes('Wolisz PLA czy PETG?'));
  assert.ok(sent.some((m) => m.to === `${recName.toLowerCase()}@test.pl` && !m.text.includes('PLA')));
  await rec.c.post(`/events/${eventId}/messages`, { to: 'santa', body: 'PETG!' });
  assert.ok((await ala.c.get(`/events/${eventId}`)).text.includes('PETG!'));
});

test('gift label shows only the recipient', async () => {
  const [ala] = people;
  const page = (await ala.c.get(`/events/${eventId}`)).text;
  const recName = page.match(/class="recipient-name">([^<]+)</)[1];
  const label = await ala.c.get(`/events/${eventId}/label`);
  assert.equal(label.status, 200);
  assert.match(label.text, new RegExp(`class="tag-name">${recName}<`));
  assert.ok(!label.text.includes('class="tag-name">Ala<'));
  assert.equal((await new Client().get(`/events/${eventId}/label`)).status, 303);
});

test('break-glass reveal needs password and is public', async () => {
  const pid = store.participantFor(eventId, store.userByEmail('ala@test.pl').id).id;
  const bad = await admin.post(`/manage/events/${eventId}/reveal`, { participant_id: String(pid), mode: 'recipient', reason: 'test', password: 'wrong' });
  assert.equal(bad.status, 422);
  const ok = await admin.post(`/manage/events/${eventId}/reveal`, { participant_id: String(pid), mode: 'recipient', reason: 'Ala zgubiła telefon', password: 'admin-password-1' });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /<b>Ala<\/b> obdarowuje <b>/);
  const bartek = (await people[1].c.get(`/events/${eventId}`)).text;
  assert.ok(bartek.includes('Ala zgubiła telefon'));
});

test('cannot delete account during active draw; reset draw clears pairs', async () => {
  const r = await people[2].c.post('/account/delete', { password: 'haslo-testowe-1' });
  assert.equal(r.status, 422);
  await admin.post(`/manage/events/${eventId}/reset`, { reason: 'ktoś dołącza' });
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM assignments').get().n, 0);
  assert.equal(store.eventById(eventId).status, 'open');
});
