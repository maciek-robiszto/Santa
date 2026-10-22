import { randomToken } from '../crypto.js';
import { setCookie } from '../security.js';
import { errorPage } from '../views/pages.js';

export function startSession({ store, config, names }, res, userId) {
  const token = store.createSession(userId, config.sessionDays);
  setCookie(res, config, names.session, token, { maxAge: config.sessionDays * 86400_000 });
  // Rotate the CSRF token on privilege change.
  const csrf = randomToken();
  setCookie(res, config, names.csrf, csrf, { sameSite: 'Strict' });
  res.locals.csrf = csrf;
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (!req.user.is_admin) return notFound(res);
  next();
}

/** Organizer of the group, or the site superadmin. */
export const canManage = (user, event) => Boolean(user && event && (user.is_admin || event.owner_user_id === user.id));

export const canCreateGroups = (config, user) => Boolean(user && (user.is_admin || config.groupCreation === 'everyone'));

export const notFound = (res) => res.page('Nie znaleziono', errorPage(404, 'Nie ma tu takiej strony'), { status: 404 });

export const tooMany = (res) => res.page('Zwolnij', errorPage(429, 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'), { status: 429 });

export function collectErrors(fields) {
  const errors = {};
  const values = {};
  for (const [k, r] of Object.entries(fields)) {
    values[k] = r.value;
    if (r.error) errors[k] = r.error;
  }
  return { errors, values, ok: Object.keys(errors).length === 0 };
}
