import { html } from '../html.js';
import { csrfField, fmtDate, fmtDateTime, statusTag } from './layout.js';
import { input, textarea, checkbox } from './forms.js';
import { AUDIT_LABELS } from './pages.js';

function eventForm({ csrf, action, values = {}, errors = {}, submit }) {
  return html`<form method="post" action="${action}">
    ${csrfField(csrf)}
    ${input({ label: 'Nazwa', name: 'name', value: values.name, required: true, max: 100, error: errors.name, hint: 'np. Makerskie Mikołajki 2026' })}
    ${textarea({ label: 'Opis / zasady', name: 'description', value: values.description, max: 3000, rows: 4, hint: 'Widoczny dla uczestników i na stronie zaproszenia.' })}
    ${input({ label: 'Budżet', name: 'budget', value: values.budget, max: 60, hint: 'np. do 100 zł albo „własnoręcznie”' })}
    ${input({ label: 'Miejsce spotkania', name: 'location', value: values.location, max: 200, hint: 'np. robisz.to Warszawa, ul. …, godz. 18:00' })}
    <div class="row-2">
      ${input({ label: 'Zapisy do', name: 'signup_deadline', type: 'date', value: values.signup_deadline, error: errors.signup_deadline })}
      ${input({ label: 'Wymiana prezentów', name: 'exchange_date', type: 'date', value: values.exchange_date, error: errors.exchange_date })}
    </div>
    ${checkbox({ label: 'Po zakończeniu pokaż każdemu, kto był jego Mikołajem', name: 'reveal_santas', checked: values.reveal_santas })}
    <button class="btn btn-primary">${submit}</button>
  </form>`;
}

export function adminIndex({ csrf, events, values, errors }) {
  return html`
  <h1>Panel admina</h1>
  <div class="grid-2">
    <section class="card">
      <h2>Wydarzenia</h2>
      ${events.length ? html`<ul class="list">${events.map((e) => html`<li>
        <a href="/admin/events/${e.id}"><b>${e.name}</b></a> ${statusTag(e.status)}
        <span class="muted">${e.participant_count} os.${e.exchange_date ? html` · ${fmtDate(e.exchange_date)}` : ''}</span>
      </li>`)}</ul>` : html`<p class="muted">Brak wydarzeń.</p>`}
    </section>
    <section class="card">
      <h2>Nowe wydarzenie</h2>
      ${eventForm({ csrf, action: '/admin/events', values, errors, submit: 'Utwórz' })}
    </section>
  </div>`;
}

export function adminEvent({ csrf, event, inviteUrl, participants, exclusions, log, errors = {}, values }) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const incomplete = participants.filter((p) => !p.profile_complete).length;
  const open = event.status === 'open';
  return html`
  <p><a href="/admin">← Wszystkie wydarzenia</a></p>
  <div class="page-head"><h1>${event.name}</h1>${statusTag(event.status)}</div>

  <section class="card card-accent">
    <h2>🔗 Link z zaproszeniem</h2>
    <div class="copy">
      <input id="invite" readonly value="${inviteUrl}" aria-label="Link z zaproszeniem">
      <button class="btn" type="button" data-copy="#invite">Kopiuj</button>
    </div>
    <form method="post" action="/admin/events/${event.id}/invite" data-confirm="Stary link przestanie działać. Kontynuować?">
      ${csrfField(csrf)}<button class="btn btn-ghost btn-small">Wygeneruj nowy link</button>
    </form>
  </section>

  <section class="card">
    <h2>🎲 Losowanie</h2>
    ${errors.draw ? html`<p class="flash flash-error">${errors.draw}</p>` : ''}
    ${open ? html`
      <p>Uczestników: <b>${participants.length}</b>${incomplete ? html` · <span class="warn">${incomplete} bez uzupełnionego profilu</span>` : ''}</p>
      <p class="muted">Po losowaniu zapisy zostają zamknięte. Wynik jest szyfrowany – nikt nie zobaczy pełnej listy par.</p>
      <form method="post" action="/admin/events/${event.id}/draw" data-confirm="Rozpocząć losowanie dla ${participants.length} osób?">
        ${csrfField(csrf)}<button class="btn btn-primary" ${participants.length < 3 ? html`disabled` : ''}>Losuj!</button>
      </form>`
    : html`
      <p>Losowanie: <b>${fmtDateTime(event.drawn_at)}</b></p>
      <div class="actions">
        ${event.status === 'drawn' ? html`
        <form method="post" action="/admin/events/${event.id}/finish" data-confirm="Zakończyć wydarzenie? Wiadomości zostaną zablokowane.">
          ${csrfField(csrf)}<button class="btn">Zakończ wydarzenie</button></form>` : html`
        <form method="post" action="/admin/events/${event.id}/reopen">
          ${csrfField(csrf)}<button class="btn">Wznów wydarzenie</button></form>`}
      </div>
      <details class="danger-zone">
        <summary>Anuluj losowanie</summary>
        <p>Usuwa wszystkie pary i wiadomości, otwiera zapisy ponownie. Fakt anulowania i powód zobaczą wszyscy uczestnicy.</p>
        <form method="post" action="/admin/events/${event.id}/reset" data-confirm="Na pewno anulować losowanie?">
          ${csrfField(csrf)}
          ${input({ label: 'Powód (widoczny dla wszystkich)', name: 'reason', required: true, max: 300 })}
          <button class="btn btn-danger">Anuluj losowanie</button>
        </form>
      </details>`}
  </section>

  <section class="card">
    <h2>👥 Uczestnicy (${participants.length})</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Imię</th><th>E-mail</th><th>Profil</th><th>Dołączył(a)</th><th><span class="sr-only">Akcje</span></th></tr></thead>
      <tbody>${participants.map((p) => html`<tr>
        <td>${p.name}</td><td>${p.email}</td>
        <td>${p.profile_complete ? '✅' : '—'}</td>
        <td>${fmtDateTime(p.joined_at)}</td>
        <td class="actions">
          <form method="post" action="/admin/users/${p.user_id}/reset-link" class="inline">
            ${csrfField(csrf)}<input type="hidden" name="event_id" value="${event.id}">
            <button class="btn btn-small btn-ghost" title="Jednorazowy link do ustawienia hasła">Reset hasła</button></form>
          ${open ? html`<form method="post" action="/admin/events/${event.id}/participants/${p.id}/remove" class="inline" data-confirm="Usunąć ${p.name} z wydarzenia?">
            ${csrfField(csrf)}<button class="btn btn-small btn-danger">Usuń</button></form>` : ''}
        </td>
      </tr>`)}</tbody>
    </table></div>
  </section>

  <section class="card">
    <h2>🚫 Wykluczenia</h2>
    <p class="muted">Pary, które nie mogą wylosować siebie nawzajem (np. partnerzy, współlokatorzy).</p>
    ${exclusions.length ? html`<ul class="list">${exclusions.map((x) => html`<li>
      ${byId.get(x.a)?.name} ↔ ${byId.get(x.b)?.name}
      ${open ? html`<form method="post" action="/admin/events/${event.id}/exclusions/remove" class="inline">
        ${csrfField(csrf)}<input type="hidden" name="a" value="${x.a}"><input type="hidden" name="b" value="${x.b}">
        <button class="btn btn-small btn-ghost" aria-label="Usuń wykluczenie">✕</button></form>` : ''}
    </li>`)}</ul>` : html`<p class="muted">Brak.</p>`}
    ${open && participants.length >= 2 ? html`<form method="post" action="/admin/events/${event.id}/exclusions" class="row-3">
      ${csrfField(csrf)}
      <select name="a" aria-label="Osoba 1">${participants.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
      <select name="b" aria-label="Osoba 2">${participants.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
      <button class="btn">Dodaj</button>
    </form>` : ''}
  </section>

  <section class="card">
    <h2>⚙️ Ustawienia</h2>
    ${eventForm({ csrf, action: `/admin/events/${event.id}`, values: values ?? event, errors, submit: 'Zapisz zmiany' })}
  </section>

  ${event.status !== 'open' ? html`<section class="card card-danger">
    <h2>🆘 Awaryjne podejrzenie przydziału</h2>
    <p>Tylko w krytycznej sytuacji (np. ktoś zgubił dostęp, zniknął, trzeba przekazać prezent dalej).
    Pokazuje <b>jedną</b> parę. <b>Każde użycie jest widoczne dla wszystkich uczestników</b> razem z powodem.</p>
    ${errors.reveal ? html`<p class="flash flash-error">${errors.reveal}</p>` : ''}
    <form method="post" action="/admin/events/${event.id}/reveal" data-confirm="To zostanie publicznie odnotowane. Kontynuować?">
      ${csrfField(csrf)}
      <div class="field"><label for="rv-p">Czyj przydział?</label>
        <select id="rv-p" name="participant_id">${participants.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
      <div class="field"><label for="rv-mode">Co pokazać?</label>
        <select id="rv-mode" name="mode">
          <option value="recipient">Kogo ta osoba obdarowuje</option>
          <option value="santa">Kto jest Mikołajem tej osoby</option>
        </select></div>
      ${input({ label: 'Powód (widoczny dla wszystkich)', name: 'reason', required: true, max: 300 })}
      ${input({ label: 'Twoje hasło', name: 'password', type: 'password', required: true, autocomplete: 'current-password' })}
      <button class="btn btn-danger">Podejrzyj</button>
    </form>
  </section>` : ''}

  <section class="card">
    <h2>📜 Dziennik zdarzeń</h2>
    <ul class="log">${log.map((l) => html`<li class="${l.action === 'admin.reveal' ? 'log-alert' : ''}">
      <time>${fmtDateTime(l.created_at)}</time> <b>${l.actor_name}</b>: ${AUDIT_LABELS[l.action] ?? l.action}${l.detail ? html` – ${l.detail}` : ''}
      ${l.public ? html`<span class="tag tag-muted">publiczne</span>` : ''}</li>`)}</ul>
  </section>

  <section class="card card-danger">
    <h2>🗑️ Usuń wydarzenie</h2>
    <p>Trwale usuwa wydarzenie, profile uczestników, pary i wiadomości (konta zostają). Zrób to po zakończonej zabawie – mniej danych = mniej ryzyka.</p>
    <form method="post" action="/admin/events/${event.id}/delete" data-confirm="Trwale usunąć wydarzenie i wszystkie jego dane?">
      ${csrfField(csrf)}
      ${input({ label: `Wpisz nazwę wydarzenia, aby potwierdzić`, name: 'confirm', required: true, error: errors.delete })}
      <button class="btn btn-danger">Usuń na zawsze</button>
    </form>
  </section>`;
}

export function adminReveal({ event, subject, mode, other }) {
  return html`<section class="card card-danger narrow">
    <h1>Wynik awaryjnego podejrzenia</h1>
    <p class="big">${mode === 'recipient'
      ? html`<b>${subject.name}</b> obdarowuje <b>${other?.name ?? '?'}</b>`
      : html`Mikołajem <b>${subject.name}</b> jest <b>${other?.name ?? '?'}</b>`}</p>
    <p class="muted">To zdarzenie zostało zapisane w dzienniku i jest widoczne dla uczestników. Ta strona nie jest zapisywana – po odświeżeniu nie wróci.</p>
    <p><a class="btn" href="/admin/events/${event.id}">Wróć</a></p>
  </section>`;
}

export function adminResetLink({ user, link, eventId }) {
  return html`<section class="card narrow">
    <h1>Link do ustawienia hasła</h1>
    <p>Przekaż go <b>${user.name}</b> (${user.email}) prywatnym kanałem. Ważny 24 h, jednorazowy.</p>
    <div class="copy"><input id="reset-link" readonly value="${link}" aria-label="Link resetu"><button class="btn" type="button" data-copy="#reset-link">Kopiuj</button></div>
    <p><a class="btn btn-ghost" href="${eventId ? `/admin/events/${eventId}` : '/admin'}">Wróć</a></p>
  </section>`;
}
