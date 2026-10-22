// Symulacja prawdziwej grupy: 30 osób zapisuje się równolegle, część nie
// uzupełnia profilu, są wykluczenia, przypomnienie przed terminem
// i automatyczne losowanie z mailami po terminie zapisów.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/crypto.js';
import { createScheduler } from '../src/notify.js';
import { deadlineEnd } from '../src/deadline.js';
import { startTestApp } from './helpers.js';

const N = 30;
let t, admin, eventId, invite;
const people = [];

before(async () => {
  t = await startTestApp();
  t.store.createUser({ email: 'org@test.pl', name: 'Organizator', passwordHash: await hashPassword('admin-password-1'), isAdmin: true });
  admin = t.client();
  await admin.post('/login', { email: 'org@test.pl', password: 'admin-password-1' });
});
after(() => t.close());

test('deadline ends at midnight Warsaw time (DST aware)', () => {
  assert.equal(new Date(deadlineEnd('2026-11-30')).toISOString(), '2026-11-30T23:00:00.000Z');
  assert.equal(new Date(deadlineEnd('2026-07-15')).toISOString(), '2026-07-15T22:00:00.000Z');
});

test('auto draw requires a signup deadline', async () => {
  const r = await admin.post('/manage/events', { name: 'Bez terminu', auto_draw: '1' });
  assert.equal(r.status, 422);
});

test('organizer creates an event with auto draw', async () => {
  const r = await admin.post('/manage/events', {
    name: 'Mikołajki grupowe', location: 'Hackerspace', budget: '100 zł', signup_deadline: '2026-11-30', exchange_date: '2026-12-06', auto_draw: '1',
  });
  assert.equal(r.status, 303);
  eventId = Number(r.location.split('/').pop());
  invite = t.store.eventById(eventId).invite_token;
});

test(`${N} people join concurrently, 2/3 fill their profile`, async () => {
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    const c = t.client();
    const name = `Osoba${String(i + 1).padStart(2, '0')}`;
    const r = await c.post(`/join/${invite}`, { name, email: `${name.toLowerCase()}@test.pl`, password: 'haslo-testowe-1', consent: '1' });
    assert.equal(r.status, 303);
    if (i % 3 !== 0) {
      await c.post(`/events/${eventId}/profile`, { about: `Jestem ${name}`, passions: 'elektronika', wishes: `marzenie-${name}`, avoid: '', social: '' });
    }
    people[i] = { name, c, email: `${name.toLowerCase()}@test.pl` };
  }));
  assert.equal(t.store.participants(eventId).length, N);
});

test('admin adds exclusions (couples)', async () => {
  const ps = t.store.participants(eventId);
  for (let i = 0; i < 6; i += 2) {
    await admin.post(`/manage/events/${eventId}/exclusions`, { a: String(ps[i].id), b: String(ps[i + 1].id) });
  }
  assert.equal(t.store.exclusions(eventId).length, 3);
});

test('reminder goes once, only to people with an empty profile', () => {
  const end = deadlineEnd('2026-11-30');
  const scheduler = createScheduler(t, () => end - 24 * 3600_000);
  t.sent.length = 0;
  scheduler.tick();
  scheduler.tick();
  assert.equal(t.sent.length, N / 3);
  assert.ok(t.sent.every((m) => /uzupełnij profil/.test(m.subject)));
  assert.equal(t.store.eventById(eventId).status, 'open');
});

test('after the deadline: signup closed, automatic draw, mail to everyone', async () => {
  const end = deadlineEnd('2026-11-30');
  t.sent.length = 0;
  createScheduler(t, () => end + 60_000).tick();
  assert.equal(t.store.eventById(eventId).status, 'drawn');
  assert.equal(t.sent.length, N);
  assert.deepEqual(new Set(t.sent.map((m) => m.to)), new Set(people.map((p) => p.email)));
  for (const m of t.sent) {
    assert.ok(!/Osoba\d\d/.test(m.text.replace(/Cześć Osoba\d\d/, '')), 'mail must not reveal the recipient');
  }
  const late = await t.client().post(`/join/${invite}`, { name: 'Spóźniony', email: 'late@test.pl', password: 'haslo-testowe-1', consent: '1' });
  assert.equal(late.status, 303);
  assert.equal(t.store.userByEmail('late@test.pl'), undefined);
});

test('every participant sees exactly one valid recipient', async () => {
  const pages = await Promise.all(people.map((p) => p.c.get(`/events/${eventId}`)));
  const byName = new Map(people.map((p, i) => [p.name, i]));
  const recipients = pages.map((r, i) => {
    const m = r.text.match(/class="recipient-name">([^<]+)</);
    assert.ok(m, `${people[i].name} has a recipient`);
    assert.notEqual(m[1], people[i].name);
    return m[1];
  });
  assert.equal(new Set(recipients).size, N, 'everyone gets exactly one gift');
  // couples from the exclusions must not draw each other
  const ps = t.store.participants(eventId);
  for (let i = 0; i < 6; i += 2) {
    const a = ps[i].name, b = ps[i + 1].name;
    assert.notEqual(recipients[byName.get(a)], b);
    assert.notEqual(recipients[byName.get(b)], a);
  }
  // single cycle: following recipients visits all N people
  let cur = people[0].name, steps = 0;
  do { cur = recipients[byName.get(cur)]; steps++; } while (cur !== people[0].name && steps <= N);
  assert.equal(steps, N);
});

test('failed auto draw notifies admins and is not retried', async () => {
  const r = await admin.post('/manage/events', { name: 'Za mało osób', signup_deadline: '2026-11-30', auto_draw: '1' });
  const id = Number(r.location.split('/').pop());
  t.sent.length = 0;
  const s = createScheduler(t, () => deadlineEnd('2026-11-30') + 1);
  s.tick();
  s.tick();
  assert.equal(t.store.eventById(id).status, 'open');
  assert.equal(t.sent.filter((m) => m.to === 'org@test.pl').length, 1);
});
