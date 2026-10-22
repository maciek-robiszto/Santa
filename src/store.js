import { transaction } from './db.js';
import { drawAssignments } from './draw.js';
import { randomToken, sha256 } from './crypto.js';

export const PROFILE_FIELDS = [
  { key: 'about', label: 'Kilka słów o mnie', max: 1500, hint: 'Kim jesteś, czym się zajmujesz, co Cię kręci.' },
  { key: 'passions', label: 'Pasje i projekty', max: 1500, hint: 'Druk 3D, elektronika, drewno, szycie, LEGO, retro‑komputery…' },
  { key: 'wishes', label: 'Co by mnie ucieszyło', max: 1500, hint: 'Pomysły, materiały, narzędzia, rzeczy do ulepszenia warsztatu.' },
  { key: 'avoid', label: 'Czego nie chcę', max: 1000, hint: 'Alergie, rzeczy, których masz za dużo, czego nie lubisz.' },
  { key: 'social', label: 'Link do social mediów / portfolio', max: 300, url: true, hint: 'np. Instagram, Printables, GitHub, YouTube (https://…)' },
];

export const GIFT_STATUSES = {
  none: 'Jeszcze nic',
  making: 'W produkcji 🛠️',
  ready: 'Gotowy 🎁',
  sent: 'Wręczony 🤝',
};

const now = () => Date.now();

export function createStore(db, cipher) {
  const q = (sql) => db.prepare(sql);
  const aad = {
    profile: (p) => `profile:${p.event_id}:${p.id}`,
    assignment: (eventId, giverId) => `assignment:${eventId}:${giverId}`,
    message: (eventId, giverId) => `message:${eventId}:${giverId}`,
  };

  const store = {
    db,

    // ---------- users ----------
    createUser({ email, name, passwordHash, isAdmin = false }) {
      const r = q('INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(email, name, passwordHash, isAdmin ? 1 : 0, now());
      return Number(r.lastInsertRowid);
    },
    userByEmail: (email) => q('SELECT * FROM users WHERE email = ?').get(email),
    userById: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
    updateUser(id, { name, email }) {
      q('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, id);
    },
    setPassword(id, passwordHash) {
      transaction(db, () => {
        q('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
        q('DELETE FROM sessions WHERE user_id = ?').run(id);
        q('DELETE FROM password_resets WHERE user_id = ?').run(id);
      });
    },
    deleteUser: (id) => q('DELETE FROM users WHERE id = ?').run(id),
    userHasActiveDraw: (userId) => !!q(`SELECT 1 FROM participants p JOIN events e ON e.id = p.event_id
      WHERE p.user_id = ? AND e.status = 'drawn'`).get(userId),

    // ---------- sessions ----------
    createSession(userId, days) {
      const token = randomToken();
      const t = now();
      q('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(token), userId, t, t + days * 86400_000, t);
      return token;
    },
    sessionUser(token) {
      if (!token) return null;
      const row = q(`SELECT s.id AS sid, s.expires_at, s.last_seen, u.* FROM sessions s
        JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha256(token));
      if (!row) return null;
      if (row.expires_at < now()) {
        q('DELETE FROM sessions WHERE id = ?').run(row.sid);
        return null;
      }
      if (now() - row.last_seen > 5 * 60_000) q('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now(), row.sid);
      return row;
    },
    deleteSession: (token) => q('DELETE FROM sessions WHERE id = ?').run(sha256(token)),
    purgeExpired() {
      q('DELETE FROM sessions WHERE expires_at < ?').run(now());
      q('DELETE FROM password_resets WHERE expires_at < ?').run(now());
    },

    // ---------- password resets ----------
    createPasswordReset(userId, hours = 24) {
      const token = randomToken();
      q('DELETE FROM password_resets WHERE user_id = ?').run(userId);
      q('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(sha256(token), userId, now() + hours * 3600_000);
      return token;
    },
    passwordResetUser(token) {
      const row = q('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token)));
      return row && row.expires_at > now() ? store.userById(row.user_id) : null;
    },

    // ---------- events ----------
    createEvent(data) {
      const r = q(`INSERT INTO events (name, description, budget, signup_deadline, exchange_date, location,
        reveal_santas, auto_draw, invite_token, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(data.name, data.description, data.budget, data.signup_deadline, data.exchange_date,
          data.location, data.reveal_santas ? 1 : 0, data.auto_draw ? 1 : 0, randomToken(18), data.owner_user_id ?? null, now());
      return Number(r.lastInsertRowid);
    },
    updateEvent(id, data) {
      q(`UPDATE events SET name = ?, description = ?, budget = ?, signup_deadline = ?, exchange_date = ?,
        location = ?, reveal_santas = ?, auto_draw = ?, reminder_sent = 0 WHERE id = ?`)
        .run(data.name, data.description, data.budget, data.signup_deadline, data.exchange_date,
          data.location, data.reveal_santas ? 1 : 0, data.auto_draw ? 1 : 0, id);
    },
    rotateInvite: (id) => q('UPDATE events SET invite_token = ? WHERE id = ?').run(randomToken(18), id),
    openEventsWithDeadline: () => q("SELECT * FROM events WHERE status = 'open' AND signup_deadline IS NOT NULL").all(),
    setAutoDraw: (id, on) => q('UPDATE events SET auto_draw = ? WHERE id = ?').run(on ? 1 : 0, id),
    markReminderSent: (id) => q('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(id),
    admins: () => q('SELECT * FROM users WHERE is_admin = 1').all(),
    setEventStatus: (id, status) => q('UPDATE events SET status = ? WHERE id = ?').run(status, id),
    deleteEvent: (id) => q('DELETE FROM events WHERE id = ?').run(id),
    eventById: (id) => q('SELECT * FROM events WHERE id = ?').get(id),
    eventByInvite: (token) => q('SELECT * FROM events WHERE invite_token = ?').get(String(token)),
    allEvents: () => q(`SELECT e.*, u.name AS owner_name, (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
      FROM events e LEFT JOIN users u ON u.id = e.owner_user_id ORDER BY e.created_at DESC`).all(),
    eventsOwnedBy: (userId) => q(`SELECT e.*, (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
      FROM events e WHERE e.owner_user_id = ? ORDER BY e.created_at DESC`).all(userId),
    activeOwnedCount: (userId) => q("SELECT COUNT(*) AS n FROM events WHERE owner_user_id = ? AND status != 'finished'").get(userId).n,
    participantCount: (eventId) => q('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?').get(eventId).n,
    eventsForUser: (userId) => q(`SELECT e.*, p.id AS participant_id, p.profile_complete,
      (SELECT COUNT(*) FROM participants x WHERE x.event_id = e.id) AS participant_count
      FROM participants p JOIN events e ON e.id = p.event_id WHERE p.user_id = ? ORDER BY e.created_at DESC`).all(userId),

    // ---------- participants ----------
    joinEvent(eventId, userId) {
      q('INSERT OR IGNORE INTO participants (event_id, user_id, joined_at) VALUES (?, ?, ?)').run(eventId, userId, now());
      return store.participantFor(eventId, userId);
    },
    participantFor: (eventId, userId) => q('SELECT * FROM participants WHERE event_id = ? AND user_id = ?').get(eventId, userId),
    participantById: (id) => q(`SELECT p.*, u.name, u.email FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`).get(id),
    participants: (eventId) => q(`SELECT p.*, u.name, u.email FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = ? ORDER BY u.name COLLATE NOCASE`).all(eventId),
    removeParticipant: (id) => q('DELETE FROM participants WHERE id = ?').run(id),

    profile(participant) {
      if (!participant?.profile_enc) return {};
      return cipher.decryptJSON(participant.profile_enc, aad.profile(participant));
    },
    saveProfile(participant, profile, complete) {
      q('UPDATE participants SET profile_enc = ?, profile_complete = ? WHERE id = ?')
        .run(cipher.encryptJSON(profile, aad.profile(participant)), complete ? 1 : 0, participant.id);
    },

    // ---------- exclusions ----------
    exclusions: (eventId) => q('SELECT a, b FROM exclusions WHERE event_id = ?').all(eventId),
    addExclusion(eventId, x, y) {
      const [a, b] = x < y ? [x, y] : [y, x];
      q('INSERT OR IGNORE INTO exclusions (event_id, a, b) VALUES (?, ?, ?)').run(eventId, a, b);
    },
    removeExclusion: (eventId, a, b) => q('DELETE FROM exclusions WHERE event_id = ? AND a = ? AND b = ?').run(eventId, a, b),

    // ---------- draw ----------
    runDraw(eventId) {
      return transaction(db, () => {
        const event = store.eventById(eventId);
        if (!event || event.status !== 'open') throw new Error('Losowanie już się odbyło');
        const ids = store.participants(eventId).map((p) => p.id);
        const pairs = store.exclusions(eventId).map(({ a, b }) => [a, b]);
        const result = drawAssignments(ids, pairs);
        const insert = q('INSERT INTO assignments (event_id, giver_id, recipient_enc) VALUES (?, ?, ?)');
        // Insert in giver-id order so row order carries no information about the cycle.
        for (const giver of [...result.keys()].sort((a, b) => a - b)) {
          insert.run(eventId, giver, cipher.encrypt(String(result.get(giver)), aad.assignment(eventId, giver)));
        }
        q("UPDATE events SET status = 'drawn', drawn_at = ? WHERE id = ?").run(now(), eventId);
        return result.size;
      });
    },
    resetDraw(eventId) {
      transaction(db, () => {
        q('DELETE FROM messages WHERE event_id = ?').run(eventId);
        q('DELETE FROM assignments WHERE event_id = ?').run(eventId);
        q("UPDATE events SET status = 'open', drawn_at = NULL WHERE id = ?").run(eventId);
      });
    },
    assignmentOf: (eventId, giverId) => q('SELECT * FROM assignments WHERE event_id = ? AND giver_id = ?').get(eventId, giverId),
    recipientIdOf(eventId, giverId) {
      const row = store.assignmentOf(eventId, giverId);
      return row ? Number(cipher.decrypt(row.recipient_enc, aad.assignment(eventId, giverId))) : null;
    },
    /** Finds who draws `recipientId`. Decrypts all rows so the lookup is not an index on the secret. */
    santaOf(eventId, recipientId) {
      for (const row of q('SELECT * FROM assignments WHERE event_id = ?').all(eventId)) {
        if (Number(cipher.decrypt(row.recipient_enc, aad.assignment(eventId, row.giver_id))) === recipientId) return row;
      }
      return null;
    },
    setGiftStatus: (eventId, giverId, status) =>
      q('UPDATE assignments SET gift_status = ? WHERE event_id = ? AND giver_id = ?').run(status, eventId, giverId),

    // ---------- anonymous messages (thread is keyed by the giver only) ----------
    addMessage(eventId, giverId, fromSanta, body) {
      q('INSERT INTO messages (event_id, giver_id, from_santa, body_enc, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(eventId, giverId, fromSanta ? 1 : 0, cipher.encrypt(body, aad.message(eventId, giverId)), now());
    },
    thread(eventId, giverId) {
      return q('SELECT * FROM messages WHERE event_id = ? AND giver_id = ? ORDER BY created_at, id').all(eventId, giverId)
        .map((m) => ({ ...m, body: cipher.decrypt(m.body_enc, aad.message(eventId, giverId)) }));
    },

    // ---------- audit ----------
    audit({ eventId = null, actor = null, action, detail = '', isPublic = false }) {
      q(`INSERT INTO audit_log (event_id, actor_user_id, actor_name, action, detail, public, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(eventId, actor?.id ?? null, actor?.name ?? 'system', action, detail, isPublic ? 1 : 0, now());
    },
    auditLog: (eventId, onlyPublic) => q(`SELECT * FROM audit_log WHERE event_id = ? ${onlyPublic ? 'AND public = 1' : ''}
      ORDER BY created_at DESC, id DESC LIMIT 200`).all(eventId),
  };
  return store;
}
