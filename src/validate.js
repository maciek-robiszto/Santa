// Strip control characters (except newline / tab) and normalize line endings.
const clean = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '');

export function text(v, max) {
  const s = clean(v).trim();
  return s.length > max ? { error: `Maksymalnie ${max} znaków`, value: s } : { value: s };
}

export function line(v, max, { required = false, label = 'To pole' } = {}) {
  const s = clean(v).replace(/\s+/g, ' ').trim();
  if (required && !s) return { error: `${label} jest wymagane`, value: s };
  if (s.length > max) return { error: `Maksymalnie ${max} znaków`, value: s };
  return { value: s };
}

export function email(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { error: 'Podaj poprawny e-mail', value: s };
  return { value: s };
}

export function password(v) {
  const s = String(v ?? '');
  if (s.length < 10) return { error: 'Hasło musi mieć co najmniej 10 znaków' };
  if (s.length > 200) return { error: 'Hasło jest za długie' };
  return { value: s };
}

export function url(v, max = 300) {
  let s = clean(v).trim();
  if (!s) return { value: '' };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  if (s.length > max) return { error: `Maksymalnie ${max} znaków`, value: s };
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error();
    return { value: u.href };
  } catch {
    return { error: 'To nie wygląda na poprawny link', value: s };
  }
}

export function date(v) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return { error: 'Niepoprawna data', value: s };
  return { value: s };
}

export function id(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Only allow local redirects ("/path"), never "//host" or "/\host". */
export function safeNext(v) {
  const s = String(v ?? '');
  return /^\/(?![/\\])[\w\-./?=&%]*$/.test(s) ? s : '/';
}
