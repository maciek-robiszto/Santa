import { html, raw } from '../html.js';

const TZ = process.env.TZ_DISPLAY || 'Europe/Warsaw';
const dateTimeFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'UTC' });

export const fmtDateTime = (ms) => (ms ? dateTimeFmt.format(new Date(ms)) : '');
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
};

export const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

export const LOGO = raw(`<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <rect x="7" y="20" width="34" height="23" fill="var(--yellow)"/>
  <rect x="4" y="13" width="40" height="8" fill="var(--teal)"/>
  <rect x="21" y="13" width="6" height="30" fill="var(--ink)"/>
  <path d="M24 13c-3-7-12-8-11-2 1 3 7 3 11 2zm0 0c3-7 12-8 11-2-1 3-7 3-11 2z" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
</svg>`);

const STATUS = {
  open: ['Zapisy otwarte', 'tag-green'],
  drawn: ['Wylosowane', 'tag-accent'],
  finished: ['Zakończone', 'tag-muted'],
};
export const statusTag = (status) => html`<span class="tag ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

export function layout({ title, body, user, csrf, flash, siteName, wide = false, canOrganize, openRegistration }) {
  return html`<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<title>${title ? `${title} · ` : ''}${siteName}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Przejdź do treści</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">${LOGO}<span><b>${siteName}</b><small>losujesz.to · robisz.to · dajesz.to</small></span></a>
    <nav class="nav" aria-label="Główna nawigacja">
      ${user ? html`
        <a href="/">Moje mikołajki</a>
        ${canOrganize || user.is_admin ? html`<a href="/manage">Organizuj</a>` : ''}
        <a href="/account">Konto</a>
        <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="link">Wyloguj</button></form>
      ` : html`<a href="/login">Zaloguj</a>${openRegistration ? html`<a href="/register">Załóż konto</a>` : ''}`}
    </nav>
  </div>
</header>
<main id="main" class="wrap ${wide ? 'wide' : ''}">
  ${flash ? html`<div class="flash flash-${flash.type}" role="status">${flash.text}</div>` : ''}
  ${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>🔒 Pary są szyfrowane. Nikt – także organizator – nie widzi listy „kto komu”.</span>
    <span>Zrobione z 🧡 przez makerów, dla makerów.</span>
  </div>
</footer>
</body>
</html>`;
}
