import { Router } from 'express';
import * as v from '../validate.js';
import { verifyPassword } from '../crypto.js';
import { DrawError } from '../draw.js';
import { adminIndex, adminEvent, adminReveal, adminResetLink } from '../views/admin.js';
import { announceDraw } from '../notify.js';
import { requireAdmin, notFound, tooMany, collectErrors } from './helpers.js';

function parseEvent(body) {
  const result = collectErrors({
    name: v.line(body.name, 100, { required: true, label: 'Nazwa' }),
    description: v.text(body.description, 3000),
    budget: v.line(body.budget, 60),
    location: v.line(body.location, 200),
    signup_deadline: v.date(body.signup_deadline),
    exchange_date: v.date(body.exchange_date),
  });
  result.values.reveal_santas = body.reveal_santas === '1';
  result.values.auto_draw = body.auto_draw === '1';
  if (result.values.auto_draw && !result.values.signup_deadline && !result.errors.signup_deadline) {
    result.errors.signup_deadline = 'Ustaw termin zapisów, żeby losowanie mogło odbyć się automatycznie';
    result.ok = false;
  }
  return result;
}

export function adminRoutes({ store, config, mailer, limiter }) {
  const r = Router();
  r.use(requireAdmin);

  const inviteUrl = (e) => `${config.origin}/join/${e.invite_token}`;
  const renderEvent = (req, res, extra = {}, status = 200) => {
    const event = store.eventById(req.event.id);
    res.page(event.name, adminEvent({
      csrf: res.locals.csrf,
      event,
      inviteUrl: inviteUrl(event),
      participants: store.participants(event.id),
      exclusions: store.exclusions(event.id),
      log: store.auditLog(event.id, false),
      mailEnabled: mailer.enabled,
      ...extra,
    }), { status });
  };

  r.param('eventId', (req, res, next, raw) => {
    const id = v.id(raw);
    req.event = id && store.eventById(id);
    if (!req.event) return notFound(res);
    next();
  });

  r.get('/', (req, res) => {
    res.page('Panel admina', adminIndex({ csrf: res.locals.csrf, events: store.allEvents(), values: { auto_draw: true } }), { wide: true });
  });

  r.post('/events', (req, res) => {
    const { errors, values, ok } = parseEvent(req.body);
    if (!ok) return res.page('Panel admina', adminIndex({ csrf: res.locals.csrf, events: store.allEvents(), values, errors }), { status: 422 });
    const id = store.createEvent(values);
    store.audit({ eventId: id, actor: req.user, action: 'event.create', detail: values.name });
    res.flash('ok', 'Wydarzenie utworzone. Skopiuj link z zaproszeniem i wyślij ekipie!');
    res.redirect(303, `/admin/events/${id}`);
  });

  r.get('/events/:eventId', (req, res) => renderEvent(req, res));

  r.post('/events/:eventId', (req, res) => {
    const { errors, values, ok } = parseEvent(req.body);
    if (!ok) return renderEvent(req, res, { errors, values }, 422);
    store.updateEvent(req.event.id, values);
    store.audit({ eventId: req.event.id, actor: req.user, action: 'event.update', isPublic: true });
    res.flash('ok', 'Zapisano ustawienia.');
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/invite', (req, res) => {
    store.rotateInvite(req.event.id);
    store.audit({ eventId: req.event.id, actor: req.user, action: 'event.invite_rotate' });
    res.flash('ok', 'Nowy link gotowy. Stary już nie działa.');
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/participants/:pid/remove', (req, res) => {
    const p = store.participantById(v.id(req.params.pid));
    if (!p || p.event_id !== req.event.id) return notFound(res);
    if (req.event.status !== 'open') {
      res.flash('error', 'Po losowaniu nie można usuwać uczestników – najpierw anuluj losowanie.');
    } else {
      store.removeParticipant(p.id);
      store.audit({ eventId: req.event.id, actor: req.user, action: 'participant.remove', detail: p.name, isPublic: true });
      res.flash('ok', `Usunięto ${p.name}.`);
    }
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/exclusions', (req, res) => {
    const a = store.participantById(v.id(req.body.a));
    const b = store.participantById(v.id(req.body.b));
    if (req.event.status !== 'open' || !a || !b || a.event_id !== req.event.id || b.event_id !== req.event.id || a.id === b.id) {
      res.flash('error', 'Wybierz dwie różne osoby.');
    } else {
      store.addExclusion(req.event.id, a.id, b.id);
      store.audit({ eventId: req.event.id, actor: req.user, action: 'exclusion.add', detail: `${a.name} ↔ ${b.name}` });
    }
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/exclusions/remove', (req, res) => {
    if (req.event.status === 'open') {
      store.removeExclusion(req.event.id, v.id(req.body.a), v.id(req.body.b));
      store.audit({ eventId: req.event.id, actor: req.user, action: 'exclusion.remove' });
    }
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/draw', (req, res) => {
    let count;
    try {
      count = store.runDraw(req.event.id);
    } catch (err) {
      if (err instanceof DrawError || err.message === 'Losowanie już się odbyło') {
        return renderEvent(req, res, { errors: { draw: err.message } }, 422);
      }
      throw err;
    }
    store.audit({ eventId: req.event.id, actor: req.user, action: 'draw.run', detail: `${count} osób`, isPublic: true });
    announceDraw({ store, mailer, config }, req.event);
    res.flash('ok', `Wylosowano pary dla ${count} osób. Nikt poza zainteresowanymi ich nie zna 🤫`);
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/reset', (req, res) => {
    const reason = v.line(req.body.reason, 300, { required: true, label: 'Powód' });
    if (reason.error) {
      res.flash('error', reason.error);
      return res.redirect(303, `/admin/events/${req.event.id}`);
    }
    store.resetDraw(req.event.id);
    store.audit({ eventId: req.event.id, actor: req.user, action: 'draw.reset', detail: reason.value, isPublic: true });
    res.flash('ok', 'Losowanie anulowane, zapisy znów otwarte.');
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/finish', (req, res) => {
    if (req.event.status === 'drawn') {
      store.setEventStatus(req.event.id, 'finished');
      store.audit({ eventId: req.event.id, actor: req.user, action: 'event.finish', isPublic: true });
    }
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  r.post('/events/:eventId/reopen', (req, res) => {
    if (req.event.status === 'finished') {
      store.setEventStatus(req.event.id, 'drawn');
      store.audit({ eventId: req.event.id, actor: req.user, action: 'event.reopen', isPublic: true });
    }
    res.redirect(303, `/admin/events/${req.event.id}`);
  });

  // Break-glass: reveals exactly one pair, requires the admin password and a
  // reason, and is announced in the public log of the event.
  r.post('/events/:eventId/reveal', async (req, res) => {
    if (!limiter.hit(`reveal:${req.user.id}`, 5, 60 * 60_000)) return tooMany(res);
    const event = req.event;
    const subject = store.participantById(v.id(req.body.participant_id));
    const mode = req.body.mode === 'santa' ? 'santa' : 'recipient';
    const reason = v.line(req.body.reason, 300, { required: true, label: 'Powód' });
    let error;
    if (event.status === 'open') error = 'Losowanie jeszcze się nie odbyło.';
    else if (!subject || subject.event_id !== event.id) error = 'Wybierz uczestnika.';
    else if (reason.error) error = reason.error;
    else if (!(await verifyPassword(String(req.body.password ?? ''), req.user.password_hash))) error = 'Nieprawidłowe hasło.';
    if (error) return renderEvent(req, res, { errors: { reveal: error } }, 422);

    const otherId = mode === 'recipient' ? store.recipientIdOf(event.id, subject.id) : store.santaOf(event.id, subject.id)?.giver_id;
    const other = otherId && store.participantById(otherId);
    const what = mode === 'recipient' ? `kogo obdarowuje ${subject.name}` : `kto jest Mikołajem ${subject.name}`;
    store.audit({ eventId: event.id, actor: req.user, action: 'admin.reveal', detail: `${what}. Powód: ${reason.value}`, isPublic: true });
    for (const p of store.participants(event.id)) {
      mailer.send({
        to: p.email,
        subject: `${config.siteName}: admin użył awaryjnego podglądu`,
        text: `Informacja dla przejrzystości: ${req.user.name} sprawdził(a) ${what}.\nPowód: ${reason.value}\n\n${config.origin}/events/${event.id}`,
      });
    }
    res.page('Awaryjny podgląd', adminReveal({ event, subject, mode, other }));
  });

  r.post('/users/:userId/reset-link', (req, res) => {
    const user = store.userById(v.id(req.params.userId));
    if (!user) return notFound(res);
    if (user.is_admin && user.id !== req.user.id) {
      res.flash('error', 'Nie można generować linków resetu dla innych adminów.');
      return res.redirect(303, '/admin');
    }
    const token = store.createPasswordReset(user.id, 24);
    // Logging in as someone would reveal their pair, so this is public too.
    for (const e of store.eventsForUser(user.id)) {
      store.audit({ eventId: e.id, actor: req.user, action: 'admin.password_reset', detail: user.name, isPublic: true });
    }
    const eventId = v.id(req.body.event_id);
    res.page('Link resetu', adminResetLink({ user, link: `${config.origin}/reset/${token}`, eventId }));
  });

  r.post('/events/:eventId/delete', (req, res) => {
    if (String(req.body.confirm ?? '').trim() !== req.event.name) {
      return renderEvent(req, res, { errors: { delete: 'Nazwa się nie zgadza.' } }, 422);
    }
    store.deleteEvent(req.event.id);
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    res.flash('ok', 'Wydarzenie i jego dane zostały usunięte.');
    res.redirect(303, '/admin');
  });

  return r;
}
