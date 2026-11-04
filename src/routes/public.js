import { Router } from 'express';
import { hashPassword, verifyPassword, dummyVerify } from '../crypto.js';
import * as v from '../validate.js';
import { signupClosed } from '../deadline.js';
import { homeAnon, loginPage, registerPage, joinPage, linkSentPage, linkPage, errorPage, forgotPage, resetPage, dashboard, accountPage } from '../views/pages.js';
import { startSession, requireUser, notFound, tooMany, collectErrors } from './helpers.js';

const JOIN_LINK_HOURS = 72;
const LOGIN_LINK_HOURS = 0.5;
const ORGANIZER_LINK_HOURS = 2;
const HOUR = 60 * 60_000;

export function publicRoutes(ctx) {
  const { store, config, mailer, limiter, names } = ctx;
  const r = Router();

  // Mails to an address someone typed. Only the sender is ever refused: a limit
  // per address alone would let a stranger lock its owner out.
  const addressKey = (email) => email.replace(/\+[^@]*@/, '@');
  const mailThrottled = (req, email) => !limiter.hit(`mail-ip:${req.ip}`, config.mailPerIpHour, HOUR)
    || !limiter.hit(`mail-ip-email:${req.ip}:${addressKey(email)}`, 5, HOUR);
  /** Over the quota nothing is sent and earlier links stay valid; the response stays the same. */
  const addressQuotaLeft = (email) => limiter.hit(`mail-email:${addressKey(email)}`, 20, HOUR);

  r.get('/', (req, res) => {
    if (!req.user) return res.page('', homeAnon());
    res.page('Moje mikołajki', dashboard({ user: req.user, events: store.eventsForUser(req.user.id) }));
  });

  // ---------- login / logout ----------
  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, v.safeNext(req.query.next));
    res.page('Logowanie', loginPage({ csrf: res.locals.csrf, next: v.safeNext(req.query.next), mailEnabled: mailer.enabled }));
  });

  r.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(req.body.password ?? '').slice(0, 200);
    // The total per address stops distributed guessing without one IP being able to lock out the owner.
    if (!limiter.hit(`login-ip:${req.ip}`, 150, 15 * 60_000) || !limiter.hit(`login-ip-email:${req.ip}:${email}`, 8, 15 * 60_000)
      || !limiter.hit(`login-email:${email}`, 50, 15 * 60_000)) {
      return tooMany(res);
    }
    const user = store.userByEmail(email);
    // Accounts without a password take the same time as unknown e-mails.
    const ok = user?.password_hash ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    if (!ok) {
      return res.status(401).page('Logowanie', loginPage({ csrf: res.locals.csrf, email, next: v.safeNext(req.query.next), mailEnabled: mailer.enabled, error: 'Nieprawidłowy e-mail lub hasło.' }), { status: 401 });
    }
    limiter.reset(`login-ip-email:${req.ip}:${email}`);
    startSession(ctx, res, user.id);
    res.redirect(303, v.safeNext(req.query.next));
  });

  // Same answer whether or not the address is known. Accounts with a password
  // get a reminder instead of a link: e-mail access alone must not skip their password.
  r.post('/login/link', (req, res) => {
    if (!mailer.enabled) return notFound(res);
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);
    if (mailThrottled(req, email)) return tooMany(res);
    const user = store.userByEmail(email);
    if (user && addressQuotaLeft(email)) {
      if (user.password_hash || user.is_admin) {
        mailer.send({
          to: user.email,
          subject: `${config.siteName}: to konto ma hasło`,
          text: `Cześć ${user.name}!\n\nKtoś poprosił o link do logowania, ale to konto loguje się hasłem:\n${config.origin}/login\n\nNie pamiętasz hasła? Ustaw nowe: ${config.origin}/forgot\n\nJeśli to nie Ty – zignoruj tę wiadomość.`,
        });
      } else {
        const token = store.createLoginLink({ email: user.email, hours: LOGIN_LINK_HOURS });
        mailer.send({
          to: user.email,
          subject: `${config.siteName}: link do logowania`,
          text: `Cześć ${user.name}!\n\nOtwórz link, żeby się zalogować (jednorazowy, ważny 30 minut):\n${config.origin}/link/${token}\n\nJeśli to nie Ty – zignoruj tę wiadomość.`,
        });
      }
    }
    res.page('Logowanie', loginPage({ csrf: res.locals.csrf, mailEnabled: true, linkSent: true }));
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
      errors.email = 'Konto z tym e-mailem już istnieje – zaloguj się albo ustaw hasło przez „Nie pamiętasz hasła?”.';
    }
    if (Object.keys(errors).length) {
      delete values.password;
      return { errors, values };
    }
    const id = store.createUser({ email: values.email, name: values.name, passwordHash: await hashPassword(values.password) });
    startSession(ctx, res, id);
    return { user: store.userById(id) };
  }

  // The address is proven first and the password is chosen only after that, on
  // the confirmation page. A password typed here could belong to an attacker
  // who only needs the mailbox owner to click "confirm".
  function requestOrganizerLink(req, res, next) {
    const { errors, values } = collectErrors({
      name: v.line(req.body.name, 60, { required: true, label: 'Imię' }),
      email: v.email(req.body.email),
    });
    if (Object.keys(errors).length) {
      return res.page('Załóż konto', registerPage({ csrf: res.locals.csrf, next, mailEnabled: true, values, errors }), { status: 422 });
    }
    if (mailThrottled(req, values.email)) return tooMany(res);
    if (!addressQuotaLeft(values.email)) return res.page('Sprawdź skrzynkę', linkSentPage({ email: values.email }));
    if (store.userByEmail(values.email)) {
      mailer.send({
        to: values.email,
        subject: `${config.siteName}: masz już konto`,
        text: `Cześć!\n\nKtoś podał ten adres przy zakładaniu konta, ale konto już istnieje. Zaloguj się albo ustaw hasło:\n${config.origin}/forgot\n\nJeśli to nie Ty – zignoruj tę wiadomość.`,
      });
    } else {
      const token = store.createLoginLink({ purpose: 'organizer', email: values.email, name: values.name, next, hours: ORGANIZER_LINK_HOURS });
      mailer.send({
        to: values.email,
        subject: `${config.siteName}: dokończ zakładanie konta`,
        text: `Cześć!\n\nOtwórz link, żeby dokończyć zakładanie konta i ustawić hasło (jednorazowy, ważny 2 godziny):\n${config.origin}/link/${token}\n\nJeśli to nie Ty – zignoruj tę wiadomość, nic się nie stanie.`,
      });
    }
    res.page('Sprawdź skrzynkę', linkSentPage({ email: values.email }));
  }

  r.get('/register', (req, res) => {
    if (!config.openRegistration) return notFound(res);
    if (req.user) return res.redirect(303, v.safeNext(req.query.next));
    res.page('Załóż konto', registerPage({ csrf: res.locals.csrf, next: v.safeNext(req.query.next), mailEnabled: mailer.enabled }));
  });

  r.post('/register', async (req, res) => {
    if (!config.openRegistration) return notFound(res);
    const next = v.safeNext(req.query.next);
    if (mailer.enabled) return requestOrganizerLink(req, res, next);
    const created = await registerUser(req, res);
    if (created.limited) return tooMany(res);
    if (created.errors) return res.page('Załóż konto', registerPage({ csrf: res.locals.csrf, next, mailEnabled: false, values: created.values, errors: created.errors }), { status: 422 });
    res.flash('ok', `Witaj, ${created.user.name}!`);
    res.redirect(303, next);
  });

  // ---------- invitations ----------
  r.get('/join/:token', (req, res) => {
    const event = store.eventByInvite(req.params.token);
    if (!event) return notFound(res);
    if (req.user && store.participantFor(event.id, req.user.id)) return res.redirect(303, `/events/${event.id}`);
    res.page(event.name, joinPage({ csrf: res.locals.csrf, event, user: req.user, mailEnabled: mailer.enabled }));
  });

  function enterEvent(res, event, user) {
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
  }

  // Nothing is created and nobody is logged in until the link from the mail is
  // confirmed: the invite link alone must not give access to someone's address.
  // The mail carries nothing typed by the requester (name, group name), so it
  // cannot be used to send arbitrary text from this domain.
  function requestJoinLink(req, res, event) {
    const { errors, values } = collectErrors({
      name: v.line(req.body.name, 60, { required: true, label: 'Imię' }),
      email: v.email(req.body.email),
    });
    if (Object.keys(errors).length) {
      return res.page(event.name, joinPage({ csrf: res.locals.csrf, event, mailEnabled: true, values, errors }), { status: 422 });
    }
    if (mailThrottled(req, values.email)) return tooMany(res);
    if (!addressQuotaLeft(values.email)) return res.page(event.name, linkSentPage({ event, email: values.email }));
    const existing = store.userByEmail(values.email);
    if (existing?.password_hash || existing?.is_admin) {
      mailer.send({
        to: values.email,
        subject: `${config.siteName}: zaproszenie do grupy`,
        text: `Cześć!\n\nKtoś podał ten adres przy zapisie do grupy. Masz już konto z hasłem, więc zaloguj się, żeby dołączyć:\n${config.origin}/login?next=/join/${event.invite_token}\n\nJeśli to nie Ty – zignoruj tę wiadomość.`,
      });
    } else {
      // An existing account means this link also logs in, so it lives as briefly as a login link.
      const token = store.createLoginLink({ email: values.email, name: values.name, eventId: event.id, hours: existing ? LOGIN_LINK_HOURS : JOIN_LINK_HOURS });
      mailer.send({
        to: values.email,
        subject: `${config.siteName}: potwierdź udział`,
        text: `Cześć!\n\nOtwórz link, żeby dołączyć do grupy (jednorazowy, ważny ${existing ? '30 minut' : '3 dni'}):\n${config.origin}/link/${token}\n\nNie przekazuj tej wiadomości dalej. Jeśli to nie Ty – zignoruj ją, nic się nie stanie.`,
      });
    }
    res.page(event.name, linkSentPage({ event, email: values.email }));
  }

  r.post('/join/:token', async (req, res) => {
    const event = store.eventByInvite(req.params.token);
    if (!event) return notFound(res);
    if (signupClosed(event)) return res.redirect(303, `/join/${event.invite_token}`);

    let user = req.user;
    if (!user) {
      // Without SMTP there is no way to deliver a link, so the password form stays.
      if (mailer.enabled) return requestJoinLink(req, res, event);
      const created = await registerUser(req, res);
      if (created.limited) return tooMany(res);
      if (created.errors) return res.page(event.name, joinPage({ csrf: res.locals.csrf, event, mailEnabled: false, values: created.values, errors: created.errors }), { status: 422 });
      user = created.user;
    }
    enterEvent(res, event, user);
  });

  // ---------- one-time links ----------
  const deadLink = (res) => res.page('Link nieważny', errorPage(404, 'Ten link wygasł albo został już użyty'), { status: 404 });

  const renderLink = (req, res, link, extra = {}, status = 200) => {
    const event = link.event_id ? store.eventById(link.event_id) : null;
    res.page('Potwierdź', linkPage({ csrf: res.locals.csrf, token: req.params.token, link, event, isNew: !store.userByEmail(link.email), viewer: req.user, ...extra }), { status });
  };

  // GET never logs in: mail scanners open links on their own.
  r.get('/link/:token', (req, res) => {
    const link = store.loginLink(req.params.token);
    if (!link) return deadLink(res);
    renderLink(req, res, link);
  });

  r.post('/link/:token', async (req, res) => {
    if (!limiter.hit(`link-use:${req.ip}`, 100, HOUR)) return tooMany(res);
    const pending = store.loginLink(req.params.token);
    if (!pending) return deadLink(res);

    // Validate before using the link up, so a typo does not burn it.
    const isNew = !store.userByEmail(pending.email);
    const fields = {};
    if (isNew) fields.name = v.line(req.body.name, 60, { required: true, label: 'Imię' });
    if (isNew && pending.purpose === 'organizer') fields.password = v.password(req.body.password);
    const { errors, values } = collectErrors(fields);
    if (isNew && req.body.consent !== '1') errors.consent = 'Potrzebujemy tej zgody, żeby przechowywać Twój profil.';
    if (Object.keys(errors).length) {
      delete values.password;
      return renderLink(req, res, pending, { values, errors }, 422);
    }
    const passwordHash = values.password ? await hashPassword(values.password) : '';

    const link = store.consumeLoginLink(req.params.token);
    if (!link) return deadLink(res);

    let user = store.userByEmail(link.email);
    const event = link.event_id ? store.eventById(link.event_id) : null;
    if (user?.password_hash || user?.is_admin || (user && link.purpose === 'organizer')) {
      res.flash('error', 'To konto już istnieje – zaloguj się albo ustaw hasło przez „Nie pamiętasz hasła?”.');
      return res.redirect(303, event ? `/login?next=/join/${event.invite_token}` : '/login');
    }
    const closed = event && signupClosed(event) && !(user && store.participantFor(event.id, user.id));
    if (closed && !user) return res.redirect(303, `/join/${event.invite_token}`);
    if (!user) user = store.userById(store.createUser({ email: link.email, name: values.name, passwordHash }));
    startSession(ctx, res, user.id);
    if (link.purpose === 'organizer') {
      res.flash('ok', `Witaj, ${user.name}!`);
      return res.redirect(303, v.safeNext(link.next));
    }
    if (closed) {
      res.flash('error', 'Zapisy do tej grupy są już zamknięte.');
      return res.redirect(303, '/');
    }
    if (event) return enterEvent(res, event, user);
    res.flash('ok', `Witaj z powrotem, ${user.name}!`);
    res.redirect(303, '/');
  });

  // ---------- password reset ----------
  r.get('/forgot', (req, res) => res.page('Reset hasła', forgotPage({ csrf: res.locals.csrf, mailEnabled: mailer.enabled })));

  r.post('/forgot', async (req, res) => {
    if (!mailer.enabled) return res.redirect(303, '/forgot');
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 200);
    if (!limiter.hit(`forgot-ip:${req.ip}`, 5, HOUR) || !limiter.hit(`forgot-ip-email:${req.ip}:${email}`, 3, HOUR)) return tooMany(res);
    const user = store.userByEmail(email);
    if (user && addressQuotaLeft(email)) {
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
    const name = v.line(req.body.name, 60, { required: true, label: 'Imię' });
    if (name.error) {
      return res.page('Konto', accountPage({ csrf: res.locals.csrf, user: req.user, errors: { name: name.error }, values: { name: name.value } }), { status: 422 });
    }
    store.renameUser(req.user.id, name.value);
    res.flash('ok', 'Zapisano.');
    res.redirect(303, '/account');
  });

  r.post('/account/logout-all', requireUser, (req, res) => {
    store.deleteOtherSessions(req.user.id, req.user.sid);
    mailer.send({
      to: req.user.email,
      subject: `${config.siteName}: wylogowano inne urządzenia`,
      text: `Cześć ${req.user.name}!\n\nNa Twoim koncie użyto opcji „Wyloguj inne urządzenia”. Jeśli to nie Ty i nie możesz się zalogować, poproś o nowy link: ${config.origin}/login`,
    });
    res.flash('ok', 'Wylogowaliśmy Cię ze wszystkich innych urządzeń.');
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
    if (req.user.password_hash && !(await verifyPassword(String(req.body.password ?? ''), req.user.password_hash))) errors.delete = 'Nieprawidłowe hasło';
    else if (!req.user.password_hash && String(req.body.confirm_email ?? '').trim().toLowerCase() !== req.user.email.toLowerCase()) errors.delete = 'Wpisz swój adres e-mail';
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
