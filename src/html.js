// Minimal auto-escaping HTML templating: every interpolated value is escaped
// unless it is itself the result of `html` / `raw`.
class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"'`=]/g, (c) => ESCAPES[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const raw = (value) => new SafeHtml(String(value));

/** Returns the URL only if it is a plain http(s) link, otherwise null. */
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Escapes text and turns newlines into <br>. */
export function multiline(text) {
  return raw(escapeHtml(text ?? '').replace(/\r?\n/g, '<br>'));
}
