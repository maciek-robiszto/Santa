// Samoobsługowe grupy: każdy może założyć konto i grupę dla znajomych.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/crypto.js';
import { startTestApp } from './helpers.js';

let t, org, friend, superadmin, groupId, invite;

before(async () => {
  t = await startTestApp();
  t.store.createUser({ email: 'root@test.pl', name: 'Root', passwordHash: await hashPassword('admin-password-1'), isAdmin: true });
  superadmin = t.client();
  await superadmin.post('/login', { email: 'root@test.pl', password: 'admin-password-1' });
});
after(() => t.close());

test('anyone can register and create a group (joining it too)', async () => {
  org = t.client();
  const r = await t.registerByMail(org, { name: 'Kasia', email: 'kasia@test.pl', password: 'haslo-testowe-1' }, '/manage');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/manage');
  const c = await org.post('/manage/events', { name: 'Mikołajki u Kasi', signup_deadline: '2026-12-01', auto_draw: '1', join_self: '1' });
  assert.equal(c.status, 303);
  groupId = Number(c.location.split('/').pop());
  const ev = t.store.eventById(groupId);
  invite = ev.invite_token;
  assert.equal((await superadmin.post(`/manage/events/${groupId}/approve`, {})).status, 303);
  assert.equal(ev.owner_user_id, t.store.userByEmail('kasia@test.pl').id);
  assert.ok(t.store.participantFor(groupId, ev.owner_user_id), 'organizer participates');
});

test('friends join through the link; organizer manages only own group', async () => {
  friend = t.client();
  await t.joinByMail(friend, invite, { name: 'Tomek', email: 'tomek@test.pl' });
  assert.equal((await friend.get(`/manage/events/${groupId}`)).status, 404);
  // The organizer finds the invite from the group page; a participant gets no such link.
  assert.match((await org.get(`/events/${groupId}`)).text, new RegExp(`href="/manage/events/${groupId}"`));
  assert.doesNotMatch((await friend.get(`/events/${groupId}`)).text, /href="\/manage\/events\//);
  // Organizing needs a password, set through a link sent to the verified address.
  assert.equal((await friend.post('/manage/events', { name: 'Bez hasła' })).status, 404);
  await friend.post('/forgot', { email: 'tomek@test.pl' });
  const reset = t.sent.findLast((m) => m.to === 'tomek@test.pl').text.match(/\/reset\/[\w-]+/)[0];
  assert.equal((await friend.post(reset, { password: 'haslo-testowe-1' })).status, 303);
  // Tomek makes his own group – Kasia cannot touch it.
  const c = await friend.post('/manage/events', { name: 'Grupa Tomka' });
  const tomekGroup = Number(c.location.split('/').pop());
  assert.equal((await org.get(`/manage/events/${tomekGroup}`)).status, 404);
  assert.ok(!(await org.get('/manage')).text.includes('Grupa Tomka'));
  // superadmin sees both
  const all = (await superadmin.get('/manage')).text;
  assert.ok(all.includes('Grupa Tomka') && all.includes('Mikołajki u Kasi'));
});

test('organizer cannot generate password reset links (account takeover)', async () => {
  const tomekId = t.store.userByEmail('tomek@test.pl').id;
  assert.equal((await org.post(`/manage/users/${tomekId}/reset-link`, {})).status, 404);
  assert.equal((await superadmin.post(`/manage/users/${tomekId}/reset-link`, {})).status, 200);
});

test('organizer with active groups cannot delete the account', async () => {
  const r = await org.post('/account/delete', { password: 'haslo-testowe-1' });
  assert.equal(r.status, 422);
  assert.match(r.text, /Organizujesz aktywne grupy/);
});

test('group creation can be restricted to admins', async () => {
  t.config.groupCreation = 'admins';
  assert.equal((await friend.post('/manage/events', { name: 'Nie wolno' })).status, 404);
  t.config.groupCreation = 'everyone';
});

test('old /admin links redirect to /manage', async () => {
  const r = await org.get('/admin/events/1');
  assert.equal(r.status, 301);
  assert.equal(r.location, '/manage/events/1');
});
