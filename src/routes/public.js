import { Router } from 'express';
import { hashPassword, verifyPassword, dummyVerify } from '../crypto.js';
import * as v from '../validate.js';
import { homeAnon, loginPage, joinPage, forgotPage, resetPage, dashboard, accountPage } from '../views/pages.js';
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
    if (!limiter.hit(`login-ip:${req.ip}`, 30, 15 * 60_000) || !limiter.hit(`login-email:${email}`, 8, 15 * 60_000)) {
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
    if (event.status !== 'open') return res.redirect(303, `/join/${event.invite_token}`);

    let user = req.user;
    if (!user) {
      if (!limiter.hit(`register:${req.ip}`, 10, 60 * 60_000)) return tooMany(res);
      const { errors, values, ok } = collectErrors({
        name: v.line(req.body.name, 60, { required: true, label: 'Imię' }),
        email: v.email(req.body.email),
        password: v.password(req.body.password),
      });
      if (req.body.consent !== '1') errors.consent = 'Potrzebujemy tej zgody, żeby przechowywać Twój profil.';
      if (ok && !errors.consent && store.userByEmail(values.email)) {
        errors.email = 'Konto z tym e-mailem już istnieje – zaloguj się, a potem otwórz link ponownie.';
      }
      if (Object.keys(errors).length) {
        delete values.password;
        return res.page(event.name, joinPage({ csrf: res.locals.csrf, event, values, errors }), { status: 422 });
      }
      const id = store.createUser({ email: values.email, name: values.name, passwordHash: await hashPassword(values.password) });
      user = store.userById(id);
      startSession(ctx, res, id);
    }

    if (!store.participantFor(event.id, user.id)) {
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
