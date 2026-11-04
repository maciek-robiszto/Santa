// Zatwierdzanie grup przez superadmina i stan maili po losowaniu.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/crypto.js';
import { startTestApp } from './helpers.js';

const PASSWORD = 'haslo-testowe-1';
let t, admin, org, groupId, invite;
const flush = () => new Promise((r) => { setTimeout(r, 20); });

before(async () => {
  t = await startTestApp();
  t.store.createUser({ email: 'root@test.pl', name: 'Root', passwordHash: await hashPassword(PASSWORD), isAdmin: true });
  admin = t.client();
  await admin.post('/login', { email: 'root@test.pl', password: PASSWORD });
  org = t.client();
  await t.registerByMail(org, { name: 'Kasia', email: 'kasia@test.pl', password: PASSWORD });
});
after(() => t.close());

test('a new group waits for the superadmin, who gets a mail without its name', async () => {
  t.sent.length = 0;
  const r = await org.post('/manage/events', { name: 'Reklama evil.example', join_self: '1', signup_deadline: '2020-01-01', auto_draw: '1' });
  assert.equal(r.status, 303);
  groupId = Number(r.location.split('/').pop());
  const ev = t.store.eventById(groupId);
  invite = ev.invite_token;
  assert.equal(ev.approved, 0);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, 'root@test.pl');
  assert.doesNotMatch(`${t.sent[0].subject} ${t.sent[0].text}`, /evil\.example/);
});

test('until approved: no invite link, nobody joins, no mail goes out, no draw', async () => {
  const panel = await org.get(`/manage/events/${groupId}`);
  assert.match(panel.text, /Czeka na zatwierdzenie/);
  assert.ok(!panel.text.includes(invite));

  t.sent.length = 0;
  const c = t.client();
  assert.match((await c.get(`/join/${invite}`)).text, /czeka na zatwierdzenie/);
  assert.equal((await c.post(`/join/${invite}`, { name: 'Ofiara', email: 'ofiara@test.pl' })).status, 303);
  assert.equal(t.sent.length, 0);
  assert.equal(t.store.userByEmail('ofiara@test.pl'), undefined);

  for (const name of ['a', 'b']) {
    const id = t.store.createUser({ email: `${name}@test.pl`, name, passwordHash: '' });
    t.store.joinEvent(groupId, id);
  }
  assert.equal((await org.post(`/manage/events/${groupId}/draw`, {})).status, 422);
  assert.equal(t.store.eventById(groupId).status, 'open');
  // Past deadline with automatic draw: the scheduler leaves it alone too.
  assert.ok(!t.store.openEventsWithDeadline().some((e) => e.id === groupId));
  assert.equal(t.sent.length, 0);
});

test('only the superadmin decides; the organizer cannot approve their own group', async () => {
  assert.equal((await org.post(`/manage/events/${groupId}/approve`, {})).status, 404);
  assert.equal((await org.post(`/manage/events/${groupId}/reject`, {})).status, 404);
  assert.equal(t.store.eventById(groupId).approved, 0);
  assert.equal((await t.client().post(`/manage/events/${groupId}/approve`, {})).status, 303);
  assert.equal(t.store.eventById(groupId).approved, 0);
  assert.match((await admin.get('/manage')).text, /Czekają na zatwierdzenie/);
});

test('editing a pending group does not approve it', async () => {
  await org.post(`/manage/events/${groupId}`, { name: 'Zmieniona', approved: '1' });
  assert.equal(t.store.eventById(groupId).approved, 0);
});

test('rejecting removes the group and tells the organizer', async () => {
  const r = await org.post('/manage/events', { name: 'Do odrzucenia' });
  const id = Number(r.location.split('/').pop());
  t.sent.length = 0;
  assert.equal((await admin.post(`/manage/events/${id}/reject`, {})).status, 303);
  assert.equal(t.store.eventById(id), undefined);
  assert.equal(t.sent.at(-1).to, 'kasia@test.pl');
});

test('rejecting cannot delete an approved group', async () => {
  const r = await admin.post('/manage/events', { name: 'Grupa admina' });
  const id = Number(r.location.split('/').pop());
  assert.equal(t.store.eventById(id).approved, 1, 'superadmin groups need no approval');
  await admin.post(`/manage/events/${id}/reject`, {});
  assert.ok(t.store.eventById(id));
});

test('after approval the invite works and the organizer is told', async () => {
  t.sent.length = 0;
  assert.equal((await admin.post(`/manage/events/${groupId}/approve`, {})).status, 303);
  assert.equal(t.sent.at(-1).to, 'kasia@test.pl');
  // The deadline in this group is over, so open signups again by moving it.
  await org.post(`/manage/events/${groupId}`, { name: 'Zmieniona', signup_deadline: '2099-01-01' });
  assert.ok((await org.get(`/manage/events/${groupId}`)).text.includes(invite));
  assert.equal((await t.joinByMail(t.client(), invite, { name: 'Tomek', email: 'tomek@test.pl' })).status, 303);
});

test('the panel shows delivery after the draw; a failure can be resent, without showing the content', async () => {
  const realSend = t.mailer.send;
  const failFor = new Set(['tomek@test.pl']);
  t.mailer.send = async (m) => { t.sent.push(m); return !failFor.has(m.to); };
  t.sent.length = 0;
  assert.equal((await org.post(`/manage/events/${groupId}/draw`, {})).status, 303);
  await flush();
  const tomek = t.store.participants(groupId).find((p) => p.email === 'tomek@test.pl');
  assert.equal(tomek.draw_mail, 'failed');
  assert.ok(t.store.participants(groupId).filter((p) => p.id !== tomek.id).every((p) => p.draw_mail === 'sent'));
  assert.ok(t.sent.some((m) => m.to === 'kasia@test.pl' && /nie udało się wysłać/.test(m.subject)), 'organizer is told');

  const panel = await org.get(`/manage/events/${groupId}`);
  assert.match(panel.text, /nie dotarł do 1 os/);
  assert.match(panel.text, /❌ nie wysłano/);
  const recipient = t.store.participantInEvent(groupId, t.store.recipientIdOf(groupId, tomek.id));
  assert.doesNotMatch(panel.text, new RegExp(`Robisz prezent dla: ${recipient.name}`));

  failFor.clear();
  t.sent.length = 0;
  const r = await org.post(`/manage/events/${groupId}/participants/${tomek.id}/resend`, {});
  assert.equal(r.status, 303);
  await flush();
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, 'tomek@test.pl');
  assert.match(t.sent[0].text, new RegExp(`Robisz prezent dla: ${recipient.name}`));
  assert.equal(t.store.participantById(tomek.id).draw_mail, 'sent');
  t.mailer.send = realSend;
});

test('resending is limited, and only the organizer can do it, for own group', async () => {
  const tomek = t.store.participants(groupId).find((p) => p.email === 'tomek@test.pl');
  const other = t.client();
  await t.registerByMail(other, { name: 'Inny', email: 'inny@test.pl', password: PASSWORD });
  assert.equal((await other.post(`/manage/events/${groupId}/participants/${tomek.id}/resend`, {})).status, 404);
  let last;
  for (let i = 0; i < 3; i++) last = await org.post(`/manage/events/${groupId}/participants/${tomek.id}/resend`, {});
  assert.equal(last.status, 429);
});

test('cancelling the draw clears delivery state; a restart marks unfinished mails as failed', async () => {
  const before = t.store.participants(groupId)[0];
  t.store.setDrawMail(before.id, 'pending');
  t.store.failPendingDrawMails();
  assert.equal(t.store.participantById(before.id).draw_mail, 'failed');
  await org.post(`/manage/events/${groupId}/reset`, { reason: 'test' });
  assert.ok(t.store.participants(groupId).every((p) => p.draw_mail === ''));
});

// ---------- poprawki po audycie ----------

async function drawnGroup(name, people) {
  const r = await admin.post('/manage/events', { name });
  const id = Number(r.location.split('/').pop());
  for (const n of people) {
    const uid = t.store.createUser({ email: `${n}@test.pl`, name: n, passwordHash: '' });
    t.store.joinEvent(id, uid);
  }
  return id;
}

test('a retry waiting from a cancelled draw cannot overwrite the state or go out', async () => {
  const id = await drawnGroup('Retry', ['r1', 'r2', 'r3']);
  const realSend = t.mailer.send;
  const waiting = [];
  t.mailer.send = (m) => new Promise((resolve) => { waiting.push({ m, resolve }); });
  await admin.post(`/manage/events/${id}/draw`, {});
  assert.equal(waiting.length, 3);
  assert.ok(waiting.every((w) => w.m.stillValid()));
  t.mailer.send = realSend;
  await admin.post(`/manage/events/${id}/reset`, { reason: 'test' });
  assert.ok(waiting.every((w) => !w.m.stillValid()), 'the mailer is told to drop it');
  waiting.forEach((w) => w.resolve(false));
  await flush();
  assert.ok(t.store.participants(id).every((p) => p.draw_mail === ''), 'late result ignored');
});

test('cancelling tells everyone and does not redraw on its own', async () => {
  const id = await drawnGroup('Anulowanie', ['c1', 'c2', 'c3']);
  await admin.post(`/manage/events/${id}`, { name: 'Anulowanie', signup_deadline: '2020-01-01', auto_draw: '1' });
  await admin.post(`/manage/events/${id}/draw`, {});
  t.sent.length = 0;
  await admin.post(`/manage/events/${id}/reset`, { reason: 'test' });
  assert.deepEqual(new Set(t.sent.filter((m) => /anulowane/.test(m.subject)).map((m) => m.to)), new Set(['c1@test.pl', 'c2@test.pl', 'c3@test.pl']));
  assert.equal(t.store.eventById(id).auto_draw, 0);
});

test('exclusions cannot pin down the ring', async () => {
  const names = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
  const id = await drawnGroup('Pierscien', names);
  const ps = t.store.participants(id);
  // Only neighbours in a ring stay allowed, which leaves two possible draws.
  for (let i = 0; i < 6; i++) for (let j = i + 2; j < 6; j++) if (!(i === 0 && j === 5)) t.store.addExclusion(id, ps[i].id, ps[j].id);
  const r = await admin.post(`/manage/events/${id}/draw`, {});
  assert.equal(r.status, 422);
  assert.match(r.text, /Za dużo wykluczeń/);
  assert.equal(t.store.eventById(id).status, 'open');
});

test('couples still work: one exclusion each in a small group', async () => {
  const id = await drawnGroup('Pary', ['p1', 'p2', 'p3', 'p4']);
  const ps = t.store.participants(id);
  t.store.addExclusion(id, ps[0].id, ps[1].id);
  t.store.addExclusion(id, ps[2].id, ps[3].id);
  assert.equal((await admin.post(`/manage/events/${id}/draw`, {})).status, 303);
  assert.equal(t.store.eventById(id).status, 'drawn');
});

test('organizer draws are limited, and saving settings does not re-send reminders', async () => {
  const r = await org.post('/manage/events', { name: 'Limit', signup_deadline: '2099-01-01' });
  const id = Number(r.location.split('/').pop());
  t.store.approveEvent(id);
  t.store.markReminderSent(id);
  await org.post(`/manage/events/${id}`, { name: 'Limit 2', signup_deadline: '2099-01-01' });
  assert.equal(t.store.eventById(id).reminder_sent, 1);
  await org.post(`/manage/events/${id}`, { name: 'Limit 2', signup_deadline: '2099-02-01' });
  assert.equal(t.store.eventById(id).reminder_sent, 0);
  let last;
  for (let i = 0; i < 6; i++) last = await org.post(`/manage/events/${id}/draw`, {});
  assert.equal(last.status, 429);
});

test('the organizer cannot switch on revealing Santas after the draw', async () => {
  const id = await drawnGroup('Ujawnienie', ['u1', 'u2', 'u3']);
  await admin.post(`/manage/events/${id}/draw`, {});
  await admin.post(`/manage/events/${id}`, { name: 'Ujawnienie', reveal_santas: '1' });
  assert.equal(t.store.eventById(id).reveal_santas, 0);
});

test('no reset links for admins, not even for themselves', async () => {
  const me = t.store.userByEmail('root@test.pl');
  const r = await admin.post(`/manage/users/${me.id}/reset-link`, {});
  assert.equal(r.status, 303);
  assert.equal(t.store.db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id = ?').get(me.id).n, 0);
});

test('mail totals: all sources count, gmail dots count as one mailbox', async () => {
  let last;
  for (let i = 1; i < 7; i++) last = await t.client().post('/register', { name: 'X', email: `${'kropkaa'.slice(0, i)}.${'kropkaa'.slice(i)}@gmail.com` });
  assert.equal(last.status, 429);
  t.config.mailPerHour = 1;
  try {
    assert.equal((await t.client().post('/register', { name: 'X', email: 'calkiem-nowy@test.pl' })).status, 429);
  } finally { t.config.mailPerHour = 10000; }
});

test('logging out other devices cannot flood the mailbox', async () => {
  const c = t.client();
  await t.registerByMail(c, { name: 'Wylog', email: 'wylog@test.pl', password: PASSWORD });
  let last;
  for (let i = 0; i < 6; i++) last = await c.post('/account/logout-all', {});
  assert.equal(last.status, 429);
});
