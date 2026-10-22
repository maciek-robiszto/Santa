import { Router } from 'express';
import { hashPassword, verifyPassword, dummyVerify } from '../crypto.js';
import * as v from '../validate.js';
import { signupClosed } from '../deadline.js';
import { homeAnon, loginPage, registerPage, joinPage, forgotPage, resetPage, dashboard, accountPage } from '../views/pages.js';
import { startSession, requireUser, notFound, tooMany, collectErrors } from './helpers.js';

export function publicRoutes(ctx) {
  const { store, config, mailer, limiter, names } = ctx;
  const r = Router();

  r.get('/', (req, res) => {
    if (!req.user) return res.page('', homeAnon());
    res.page('Moje mikołajki', dashboard({ user: req.user, events: store.eventsForUser(req.user.id) }));
  });

  // ---------- login / logout ----------
  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, v.safeNext(req.query.next));
    res.page('Logowanie', loginPage({ csrf: res.locals.csrf, next: v.safeNext(req.query.next) }));
  });

  r.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(req.body.password ?? '').slice(0, 200);
    if (!limiter.hit(`login-ip:${req.ip}`, 150, 15 * 60_000) || !limiter.hit(`login-email:${email}`, 8, 15 * 60_000)) {
      return tooMany(res);
    }
    const user = store.userByEmail(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    if (!ok) {
      return res.status(401).page('Logowanie', loginPage({ csrf: res.locals.csrf, email, next: v.safeNext(req.query.next), error: 'Nieprawidłowy e-mail lub hasło.' }), { status: 401 });
    }
    limiter.reset(`login-email:${email}`);
    startSession(ctx, res, user.id);
    res.redirect(303, v.safeNext(req.query.next));
  });

  r.post('/logout', (req, res) => {
    if (req.cookies[names.session]) store.deleteSession(req.cookies[names.session]);
    res.clearCookie(names.session, { path: '/', secure: config.secureCookies });
    res.redirect(303, '/');
  });

  // ---------- registration ----------
  async function registerUser(req, res) {
    if (!limiter.hit(`register:${req.ip}`, 100, 60 * 60_000)) return { limited: true };
    const { errors, values, ok } = collectErrors({
      name: v.line(req.body.name, 60, { required: true, label: 'Imię' }),
      email: v.email(req.body.email),
      password: v.password(req.body.password),
    });
    if (req.body.consent !== '1') errors.consent = 'Potrzebujemy tej zgody, żeby przechowywać Twój profil.';
    if (ok && !errors.consent && store.userByEmail(values.email)) {
      errors.email = 'Konto z tym e-mailem już istnieje – zaloguj się.';
    }
    if (Object.keys(errors).length) {
      delete values.password;
      return { errors, values };
    }
    const id = store.createUser({ email: values.email, name: values.name, passwordHash: await hashPassword(values.password) });
    startSession(ctx, res, id);
    return { user: store.userById(id) };
  }

  r.get('/register', (req, res) => {
    if (!config.openRegistration) return notFound(res);
    if (req.user) return res.redirect(303, v.safeNext(req.query.next));
    res.page('Załóż konto', registerPage({ csrf: res.locals.csrf, next: v.safeNext(req.query.next) }));
  });

  r.post('/register', async (req, res) => {
    if (!config.openRegistration) return notFound(res);
    const next = v.safeNext(req.query.next);
    const created = await registerUser(req, res);
    if (created.limited) return tooMany(res);
    if (created.errors) return res.page('Załóż konto', registerPage({ csrf: res.locals.csrf, next, values: created.values, errors: created.errors }), { status: 422 });
    res.flash('ok', `Witaj, ${created.user.name}!`);
    res.redirect(303, next);
  });

  // ---------- invitations ----------
  r.get('/join/:token', (req, res) => {
    const event = store.eventByInvite(req.params.token);
    if (!event) return notFound(res);
    if (req.user && store.participantFor(event.id, req.user.id)) return res.redirect(303, `/events/${event.id}`);
    res.page(event.name, joinPage({ csrf: res.locals.csrf, event, user: req.user }));
  });

  r.post('/join/:token', async (req, res) => {
    const event = store.eventByInvite(req.params.token);
    if (!event) return notFound(res);
    if (signupClosed(event)) return res.redirect(303, `/join/${event.invite_token}`);

    let user = req.user;
    if (!user) {
      const created = await registerUser(req, res);
      if (created.limited) return tooMany(res);
      if (created.errors) return res.page(event.name, joinPage({ csrf: res.locals.csrf, event, values: created.values, errors: created.errors }), { status: 422 });
      user = created.user;
    }

    if (!store.participantFor(event.id, user.id)) {
      if (store.participantCount(event.id) >= config.maxParticipants) {
        res.flash('error', 'Ta grupa jest już pełna.');
        return res.redirect(303, '/');
      }
      store.joinEvent(event.id, user.id);
      store.audit({ eventId: event.id, actor: user, action: 'participant.join', detail: user.name, isPublic: true });
    }
    res.flash('ok', 'Jesteś w grze! Teraz napisz coś o sobie, żeby Twój Mikołaj wiedział, co Cię ucieszy.');
    res.redirect(303, `/events/${event.id}#profil`);
  });

  // ---------- password reset ----------
  r.get('/forgot', (req, res) => res.page('Reset hasła', forgotPage({ csrf: res.locals.csrf, mailEnabled: mailer.enabled })));

  r.post('/forgot', async (req, res) => {
    if (!mailer.enabled) return res.redirect(303, '/forgot');
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);
    if (!limiter.hit(`forgot-ip:${req.ip}`, 5, 60 * 60_000) || !limiter.hit(`forgot:${email}`, 3, 60 * 60_000)) return tooMany(res);
    const user = store.userByEmail(email);
    if (user) {
      const token = store.createPasswordReset(user.id, 2);
      mailer.send({
        to: user.email,
        subject: `${config.siteName}: reset hasła`,
        text: `Cześć ${user.name}!\n\nAby ustawić nowe hasło, otwórz link (ważny 2 godziny):\n${config.origin}/reset/${token}\n\nJeśli to nie Ty – zignoruj tę wiadomość.`,
      });
    }
    res.page('Reset hasła', forgotPage({ csrf: res.locals.csrf, sent: true, mailEnabled: true }));
  });

  r.get('/reset/:token', (req, res) => {
    if (!store.passwordResetUser(req.params.token)) return notFound(res);
    res.page('Nowe hasło', resetPage({ csrf: res.locals.csrf, token: req.params.token }));
  });

  r.post('/reset/:token', async (req, res) => {
    if (!limiter.hit(`reset:${req.ip}`, 20, 60 * 60_000)) return tooMany(res);
    const user = store.passwordResetUser(req.params.token);
    if (!user) return notFound(res);
    const pw = v.password(req.body.password);
    if (pw.error) return res.page('Nowe hasło', resetPage({ csrf: res.locals.csrf, token: req.params.token, error: pw.error }), { status: 422 });
    store.setPassword(user.id, await hashPassword(pw.value));
    startSession(ctx, res, user.id);
    res.flash('ok', 'Hasło ustawione. Witaj z powrotem!');
    res.redirect(303, '/');
  });

  // ---------- account ----------
  r.get('/account', requireUser, (req, res) => {
    res.page('Konto', accountPage({ csrf: res.locals.csrf, user: req.user, mailEnabled: mailer.enabled }));
  });

  r.post('/account', requireUser, (req, res) => {
    const { errors, values, ok } = collectErrors({
      name: v.line(req.body.name, 60, { required: true, label: 'Imię' }),
      email: v.email(req.body.email),
    });
    if (ok) {
      const other = store.userByEmail(values.email);
      if (other && other.id !== req.user.id) errors.email = 'Ten e-mail jest już zajęty';
    }
    if (Object.keys(errors).length) {
      return res.page('Konto', accountPage({ csrf: res.locals.csrf, user: req.user, errors, values }), { status: 422 });
    }
    store.updateUser(req.user.id, values);
    res.flash('ok', 'Zapisano.');
    res.redirect(303, '/account');
  });

  r.post('/account/password', requireUser, async (req, res) => {
    if (!limiter.hit(`pw:${req.user.id}`, 10, 15 * 60_000)) return tooMany(res);
    const errors = {};
    if (!(await verifyPassword(String(req.body.current ?? ''), req.user.password_hash))) errors.current = 'Nieprawidłowe hasło';
    const pw = v.password(req.body.password);
    if (pw.error) errors.password = pw.error;
    if (Object.keys(errors).length) {
      return res.page('Konto', accountPage({ csrf: res.locals.csrf, user: req.user, errors }), { status: 422 });
    }
    store.setPassword(req.user.id, await hashPassword(pw.value));
    startSession(ctx, res, req.user.id);
    res.flash('ok', 'Hasło zmienione. Inne urządzenia zostały wylogowane.');
    res.redirect(303, '/account');
  });

  r.post('/account/delete', requireUser, async (req, res) => {
    if (!limiter.hit(`pw:${req.user.id}`, 10, 15 * 60_000)) return tooMany(res);
    const errors = {};
    if (!(await verifyPassword(String(req.body.password ?? ''), req.user.password_hash))) errors.delete = 'Nieprawidłowe hasło';
    else if (store.userHasActiveDraw(req.user.id)) errors.delete = 'Bierzesz udział w trwającym losowaniu – poproś organizatora o pomoc, żeby nikt nie został bez prezentu.';
    else if (store.activeOwnedCount(req.user.id) > 0) errors.delete = 'Organizujesz aktywne grupy – najpierw je zakończ albo usuń.';
    if (Object.keys(errors).length) {
      return res.page('Konto', accountPage({ csrf: res.locals.csrf, user: req.user, errors }), { status: 422 });
    }
    for (const e of store.eventsForUser(req.user.id)) {
      store.audit({ eventId: e.id, actor: req.user, action: 'participant.leave', detail: `${req.user.name} (usunięcie konta)`, isPublic: true });
    }
    store.deleteUser(req.user.id);
    res.clearCookie(names.session, { path: '/', secure: config.secureCookies });
    res.flash('ok', 'Konto i dane zostały usunięte. Do zobaczenia!');
    res.redirect(303, '/');
  });

  return r;
}
