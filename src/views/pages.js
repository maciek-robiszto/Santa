import { html, multiline, safeUrl } from '../html.js';
import { csrfField, fmtDate, fmtDateTime, statusTag } from './layout.js';
import { input, textarea } from './forms.js';
import { PROFILE_FIELDS, GIFT_STATUSES } from '../store.js';
import { signupClosed } from '../deadline.js';

export const AUDIT_LABELS = {
  'event.create': 'Utworzono wydarzenie',
  'event.update': 'Zmieniono ustawienia',
  'event.invite_rotate': 'Wygenerowano nowy link zaproszenia',
  'event.finish': 'Zakończono wydarzenie',
  'event.reopen': 'Wznowiono wydarzenie',
  'participant.join': 'Dołączył(a) uczestnik',
  'participant.leave': 'Uczestnik zrezygnował',
  'participant.remove': 'Organizator usunął uczestnika',
  'exclusion.add': 'Dodano wykluczenie',
  'exclusion.remove': 'Usunięto wykluczenie',
  'draw.run': 'Przeprowadzono losowanie',
  'draw.reset': 'Losowanie zostało anulowane',
  'draw.auto': 'Automatyczne losowanie po terminie zapisów',
  'draw.auto_failed': 'Automatyczne losowanie nie powiodło się',
  'admin.reveal': '⚠️ Organizator awaryjnie podejrzał przydział',
  'admin.password_reset': 'Administrator strony wygenerował link resetu hasła',
};

const eventMeta = (e) => html`<dl class="meta">
  ${e.budget ? html`<div><dt>Budżet</dt><dd>${e.budget}</dd></div>` : ''}
  ${e.signup_deadline ? html`<div><dt>Zapisy do</dt><dd>${fmtDate(e.signup_deadline)}${e.auto_draw && e.status === 'open' ? html` <span class="muted">· potem losowanie</span>` : ''}</dd></div>` : ''}
  ${e.exchange_date ? html`<div><dt>Wymiana prezentów</dt><dd>${fmtDate(e.exchange_date)}</dd></div>` : ''}
  ${e.location ? html`<div><dt>Miejsce</dt><dd>${e.location}</dd></div>` : ''}
</dl>`;

export function homeAnon() {
  return html`
  <section class="hero">
    <div>
      <p class="kicker">Edycja świąteczna</p>
      <h1>Makerskie Mikołajki</h1>
      <p class="lead">Losujesz osobę, <b>robisz</b> dla niej prezent (albo wyszukujesz coś z sercem), wręczasz. Proste.
      Bez arkuszy, bez „ups, wylosowałem siebie” i bez podglądania.</p>
      <p class="actions">
        <a class="btn btn-primary" href="/register?next=/manage">Załóż grupę</a>
        <a class="btn" href="/login">Zaloguj się</a>
      </p>
      <p class="hint">Masz link z zaproszeniem? Otwórz go, żeby dołączyć. Chcesz zorganizować mikołajki dla swoich znajomych? Załóż grupę – to nic nie kosztuje.</p>
    </div>
    <div class="dotted">
      <ol class="steps">
        <li><b>Załóż grupę</b> albo dołącz przez link od znajomych.</li>
        <li><b>Opisz się</b> – pasje, projekty, co lubisz, czego nie.</li>
        <li><b>Losowanie</b> – automatyczne, szyfrowane, bez par „na krzyż”.</li>
        <li><b>Działaj</b> – zobacz profil swojej osoby i pytaj ją anonimowo.</li>
      </ol>
    </div>
  </section>`;
}

export function loginPage({ csrf, email = '', error, next = '/' }) {
  return html`<section class="card narrow">
    <h1>Zaloguj się</h1>
    ${error ? html`<p class="flash flash-error">${error}</p>` : ''}
    <form method="post" action="/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">
      ${csrfField(csrf)}
      ${input({ label: 'E-mail', name: 'email', type: 'email', value: email, required: true, autocomplete: 'username' })}
      ${input({ label: 'Hasło', name: 'password', type: 'password', required: true, autocomplete: 'current-password' })}
      <button class="btn btn-primary">Wejdź</button>
    </form>
    <p class="hint"><a href="/forgot">Nie pamiętasz hasła?</a></p>
  </section>`;
}

export function registerPage({ csrf, next = '/', values = {}, errors = {} }) {
  return html`<section class="card narrow">
    <p class="kicker">Nowe konto</p>
    <h1>Załóż konto</h1>
    <form method="post" action="/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">
      ${csrfField(csrf)}
      ${input({ label: 'Imię / ksywka', name: 'name', value: values.name, required: true, max: 60, error: errors.name, autocomplete: 'nickname', hint: 'Tak zobaczą Cię inni w grupie.' })}
      ${input({ label: 'E-mail', name: 'email', type: 'email', value: values.email, required: true, max: 200, error: errors.email, autocomplete: 'email' })}
      ${input({ label: 'Hasło', name: 'password', type: 'password', required: true, min: 10, error: errors.password, autocomplete: 'new-password', hint: 'Min. 10 znaków.' })}
      <label class="check"><input type="checkbox" name="consent" value="1" required>
        Zgadzam się na przetwarzanie moich danych na potrzeby zabawy. Mogę je usunąć w każdej chwili.</label>
      ${errors.consent ? html`<p class="error">${errors.consent}</p>` : ''}
      <button class="btn btn-primary">Załóż konto</button>
    </form>
    <p class="hint">Masz już konto? <a href="/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">Zaloguj się</a>.</p>
  </section>`;
}

export function forgotPage({ csrf, sent, mailEnabled }) {
  return html`<section class="card narrow">
    <h1>Reset hasła</h1>
    ${sent ? html`<p class="flash flash-ok">Jeśli konto istnieje, wysłaliśmy link na podany e-mail.</p>` : ''}
    ${mailEnabled ? html`
      <form method="post" action="/forgot">
        ${csrfField(csrf)}
        ${input({ label: 'E-mail', name: 'email', type: 'email', required: true, autocomplete: 'username' })}
        <button class="btn btn-primary">Wyślij link</button>
      </form>` : html`<p>Napisz do administratora strony – wygeneruje Ci jednorazowy link do ustawienia nowego hasła.</p>`}
  </section>`;
}

export function resetPage({ csrf, token, error }) {
  return html`<section class="card narrow">
    <h1>Ustaw nowe hasło</h1>
    ${error ? html`<p class="flash flash-error">${error}</p>` : ''}
    <form method="post" action="/reset/${token}">
      ${csrfField(csrf)}
      ${input({ label: 'Nowe hasło', name: 'password', type: 'password', required: true, min: 10, autocomplete: 'new-password', hint: 'Min. 10 znaków. Najlepiej kilka losowych słów.' })}
      <button class="btn btn-primary">Zapisz hasło</button>
    </form>
  </section>`;
}

export function joinPage({ csrf, event, user, values = {}, errors = {} }) {
  const closed = signupClosed(event);
  return html`<section class="grid-2">
    <div class="card">
      <p class="kicker">zaproszenie</p>
      <h1>${event.name}</h1>
      ${event.description ? html`<p>${multiline(event.description)}</p>` : ''}
      ${eventMeta(event)}
    </div>
    <div class="card">
      ${closed ? html`<h2>Zapisy zamknięte</h2><p>${event.status === 'open' ? 'Termin zapisów minął.' : 'Losowanie już się odbyło.'} Jeśli to pomyłka, odezwij się do organizatora.</p>`
      : user ? html`
        <h2>Dołączasz jako ${user.name}</h2>
        <form method="post" action="/join/${event.invite_token}">${csrfField(csrf)}
          <button class="btn btn-primary">Dołączam! 🎁</button>
        </form>`
      : html`
        <h2>Załóż konto i dołącz</h2>
        <form method="post" action="/join/${event.invite_token}">
          ${csrfField(csrf)}
          ${errors.form ? html`<p class="flash flash-error">${errors.form}</p>` : ''}
          ${input({ label: 'Imię / ksywka', name: 'name', value: values.name, required: true, max: 60, error: errors.name, autocomplete: 'nickname', hint: 'Tak zobaczą Cię inni uczestnicy.' })}
          ${input({ label: 'E-mail', name: 'email', type: 'email', value: values.email, required: true, max: 200, error: errors.email, autocomplete: 'email' })}
          ${input({ label: 'Hasło', name: 'password', type: 'password', required: true, min: 10, error: errors.password, autocomplete: 'new-password', hint: 'Min. 10 znaków.' })}
          <label class="check"><input type="checkbox" name="consent" value="1" required>
            Zgadzam się na przetwarzanie moich danych na potrzeby tej zabawy. Mogę je usunąć w każdej chwili.</label>
          ${errors.consent ? html`<p class="error">${errors.consent}</p>` : ''}
          <button class="btn btn-primary">Dołączam! 🎁</button>
        </form>
        <p class="hint">Masz już konto? <a href="/login?next=/join/${event.invite_token}">Zaloguj się</a>.</p>`}
    </div>
  </section>`;
}

export function dashboard({ events, user }) {
  return html`
  <h1>Cześć, ${user.name}! 👋</h1>
  ${events.length ? html`<div class="cards">
    ${events.map((e) => html`<a class="card card-link" href="/events/${e.id}">
      <div class="card-top">${statusTag(e.status)}<span class="muted">${e.participant_count} os.</span></div>
      <h2>${e.name}</h2>
      ${e.exchange_date ? html`<p class="muted">Wymiana: ${fmtDate(e.exchange_date)}</p>` : ''}
      ${!e.profile_complete ? html`<p class="warn">✏️ Uzupełnij swój profil</p>` : ''}
      ${e.status === 'drawn' ? html`<p class="go">Zobacz, kogo wylosowałeś/aś →</p>` : ''}
    </a>`)}
  </div>` : html`<div class="card empty">
    <p>Nie bierzesz jeszcze udziału w żadnych mikołajkach.</p>
    <p class="muted">Poproś organizatora o link z zaproszeniem albo zorganizuj własne.</p>
    <p><a class="btn btn-primary" href="/manage">Załóż grupę</a></p>
  </div>`}`;
}

function profileView(profile) {
  const social = safeUrl(profile.social);
  const rows = PROFILE_FIELDS.filter((f) => f.key !== 'social' && profile[f.key]);
  return html`
    ${rows.length ? rows.map((f) => html`<div class="profile-row"><h4>${f.label}</h4><p>${multiline(profile[f.key])}</p></div>`)
      : html`<p class="muted">Ta osoba jeszcze nic o sobie nie napisała. Zadaj jej anonimowe pytanie poniżej 👇</p>`}
    ${social ? html`<div class="profile-row"><h4>Social / portfolio</h4>
      <p><a href="${social}" target="_blank" rel="noopener noreferrer nofollow ugc">${social}</a></p></div>` : ''}`;
}

function thread(messages, { meIsSanta }) {
  if (!messages.length) return html`<p class="muted">Brak wiadomości.</p>`;
  return html`<ul class="thread">${messages.map((m) => {
    const mine = Boolean(m.from_santa) === meIsSanta;
    return html`<li class="${mine ? 'mine' : 'theirs'}">
      <span class="who">${mine ? 'Ty' : meIsSanta ? 'Obdarowany/a' : 'Twój Mikołaj 🎅'}</span>
      <p>${multiline(m.body)}</p>
      <time>${fmtDateTime(m.created_at)}</time>
    </li>`;
  })}</ul>`;
}

function messageForm(csrf, eventId, to, placeholder) {
  return html`<form method="post" action="/events/${eventId}/messages" class="msg-form">
    ${csrfField(csrf)}<input type="hidden" name="to" value="${to}">
    <label class="sr-only" for="msg-${to}">Wiadomość</label>
    <textarea id="msg-${to}" name="body" rows="2" maxlength="1000" required placeholder="${placeholder}"></textarea>
    <button class="btn">Wyślij anonimowo</button>
  </form>`;
}

export function eventPage(ctx) {
  const { csrf, event, me, profile, participants, recipient, recipientProfile, myGiftStatus, santaGiftStatus,
    santaThread, recipientThread, publicLog, revealedSanta, errors = {} } = ctx;
  const canEditProfile = event.status !== 'finished';
  return html`
  <div class="page-head">
    <div>
      <p class="kicker">${event.status === 'open' ? 'zapisy trwają' : event.status === 'drawn' ? 'czas działać' : 'po wszystkim'}</p>
      <h1>${event.name}</h1>
    </div>
    ${statusTag(event.status)}
  </div>
  ${event.description ? html`<p class="lead">${multiline(event.description)}</p>` : ''}
  ${eventMeta(event)}

  ${event.status !== 'open' && recipient ? html`
  <section class="card card-accent reveal" id="przydzial">
    <h2>🎯 Twoja osoba</h2>
    <details class="envelope">
      <summary><span class="btn btn-primary"><span class="when-closed">Otwórz kopertę</span><span class="when-open">Zamknij kopertę</span></span>
        <span class="hint">Upewnij się, że nikt nie patrzy Ci przez ramię 👀</span></summary>
      <div class="envelope-body">
        <div class="dotted dotted-sm"><p class="recipient-name">${recipient.name}</p></div>
        ${profileView(recipientProfile)}
        <p class="label-cta"><a class="btn" href="/events/${event.id}/label">🏷️ Etykieta na prezent</a>
          <span class="hint">Wydrukuj, wytnij i przyczep do paczki – na spotkaniu każdy od razu znajdzie swój prezent.</span></p>
        <form method="post" action="/events/${event.id}/gift-status" class="gift-status">
          ${csrfField(csrf)}
          <label for="gs">Status prezentu (widzi go obdarowana osoba):</label>
          <select id="gs" name="status">
            ${Object.entries(GIFT_STATUSES).map(([k, v]) => html`<option value="${k}" ${k === myGiftStatus ? html`selected` : ''}>${v}</option>`)}
          </select>
          <button class="btn btn-small">Zapisz</button>
        </form>
        <h3>Anonimowe pytania <span class="muted">(do: ${recipient.name})</span></h3>
        ${thread(recipientThread, { meIsSanta: true })}
        ${event.status === 'drawn' ? messageForm(csrf, event.id, 'recipient', 'Np. „Jaki masz rozmiar ręki? 😉” albo „Wolisz PLA czy PETG?”') : ''}
      </div>
    </details>
  </section>

  <section class="card" id="mikolaj">
    <h2>🎅 Twój Mikołaj</h2>
    ${revealedSanta ? html`<p>Twoim Mikołajem był(a): <b>${revealedSanta}</b> 🎉</p>` : html`<p class="muted">Ktoś już nad czymś dla Ciebie myśli. Kto? Tajemnica.</p>`}
    <p>Status prezentu: <b>${GIFT_STATUSES[santaGiftStatus ?? 'none']}</b></p>
    ${thread(santaThread, { meIsSanta: false })}
    ${event.status === 'drawn' ? messageForm(csrf, event.id, 'santa', 'Odpowiedz swojemu Mikołajowi…') : ''}
  </section>` : ''}

  <section class="card" id="profil">
    <h2>✏️ Mój profil</h2>
    <p class="muted">Zobaczy go tylko osoba, która Cię wylosuje (i organizator w sytuacji awaryjnej). Możesz go zmieniać także po losowaniu.</p>
    ${canEditProfile ? html`<form method="post" action="/events/${event.id}/profile">
      ${csrfField(csrf)}
      ${PROFILE_FIELDS.map((f) => f.url
        ? input({ label: f.label, name: f.key, type: 'url', value: profile[f.key], max: f.max, hint: f.hint, error: errors[f.key] })
        : textarea({ label: f.label, name: f.key, value: profile[f.key], max: f.max, hint: f.hint, error: errors[f.key] }))}
      <button class="btn btn-primary">Zapisz profil</button>
    </form>` : profileView(profile)}
  </section>

  <section class="grid-2">
    <div class="card">
      <h2>👥 Ekipa (${participants.length})</h2>
      <ul class="people">${participants.map((p) => html`<li>${p.name}${p.id === me.id ? ' (Ty)' : ''}</li>`)}</ul>
      ${event.status === 'open' ? html`<form method="post" action="/events/${event.id}/leave" data-confirm="Na pewno chcesz zrezygnować z udziału?">
        ${csrfField(csrf)}<button class="btn btn-ghost btn-small">Rezygnuję z udziału</button></form>` : ''}
    </div>
    <div class="card">
      <h2>🔍 Przejrzystość</h2>
      <p class="muted">Każde ważne działanie organizatora jest tu widoczne – również awaryjne podejrzenie przydziału.</p>
      ${publicLog.length ? html`<ul class="log">${publicLog.map((l) => html`<li class="${l.action === 'admin.reveal' ? 'log-alert' : ''}">
        <time>${fmtDateTime(l.created_at)}</time> ${AUDIT_LABELS[l.action] ?? l.action}${l.detail ? html` – ${l.detail}` : ''}</li>`)}</ul>`
      : html`<p class="muted">Pusto.</p>`}
    </div>
  </section>`;
}

export function accountPage({ csrf, user, errors = {}, values = {}, mailEnabled }) {
  return html`
  <h1>Konto</h1>
  <div class="grid-2">
    <section class="card">
      <h2>Dane</h2>
      <form method="post" action="/account">
        ${csrfField(csrf)}
        ${input({ label: 'Imię / ksywka', name: 'name', value: values.name ?? user.name, required: true, max: 60, error: errors.name })}
        ${input({ label: 'E-mail', name: 'email', type: 'email', value: values.email ?? user.email, required: true, max: 200, error: errors.email })}
        <button class="btn btn-primary">Zapisz</button>
      </form>
    </section>
    <section class="card">
      <h2>Zmiana hasła</h2>
      <form method="post" action="/account/password">
        ${csrfField(csrf)}
        <input type="text" name="username" value="${user.email}" autocomplete="username" hidden>
        ${input({ label: 'Obecne hasło', name: 'current', type: 'password', required: true, error: errors.current, autocomplete: 'current-password' })}
        ${input({ label: 'Nowe hasło', name: 'password', type: 'password', required: true, min: 10, error: errors.password, autocomplete: 'new-password' })}
        <button class="btn btn-primary">Zmień hasło</button>
      </form>
      <p class="hint">Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń.</p>
    </section>
  </div>
  <section class="card card-danger">
    <h2>Usuń konto</h2>
    <p>Usuwa konto, profile i wiadomości. Nie da się tego cofnąć. Jeśli trwa losowanie, w którym bierzesz udział, najpierw daj znać organizatorowi.</p>
    <form method="post" action="/account/delete" data-confirm="Na pewno usunąć konto i wszystkie dane?">
      ${csrfField(csrf)}
      ${input({ label: 'Potwierdź hasłem', name: 'password', type: 'password', required: true, error: errors.delete, autocomplete: 'current-password' })}
      <button class="btn btn-danger">Usuń konto</button>
    </form>
  </section>`;
}

export function errorPage(status, message) {
  return html`<section class="card narrow center">
    <p class="big-code">${status}</p>
    <h1>${message}</h1>
    <p><a class="btn" href="/">Wróć na start</a></p>
  </section>`;
}

function giftTag({ event, recipient, siteName, variant }) {
  return html`<article class="gift-tag gift-tag-${variant}"><div class="tag-inner">
    ${variant === 'tag' ? html`<span class="tag-hole" aria-hidden="true"></span>` : ''}
    <div class="tag-body">
      <p class="tag-event">${event.name || siteName}</p>
      <p class="tag-for">Dla</p>
      <p class="tag-name">${recipient.name}</p>
      <p class="tag-from">od Tajemniczego Mikołaja 🎅</p>
      ${event.exchange_date && variant === 'tag' ? html`<p class="tag-date">Nie otwierać przed ${fmtDate(event.exchange_date)}</p>` : ''}
    </div>
  </div></article>`;
}

export function giftLabelPage({ event, recipient, siteName }) {
  return html`
  <div class="no-print">
    <p><a href="/events/${event.id}#przydzial">← Wróć do wydarzenia</a></p>
    <p class="kicker">Do druku</p>
    <h1>Etykieta na prezent</h1>
    <p class="lead">Wydrukuj, wytnij po przerywanej linii i przyczep do paczki. Duża zawieszka ma otwór na sznurek,
    małe naklejki możesz przykleić taśmą. Twojego imienia tu nie ma 🤫</p>
    <p><button class="btn btn-primary" type="button" data-print>Drukuj</button></p>
  </div>
  <section class="label-sheet" aria-label="Podgląd wydruku">
    ${giftTag({ event, recipient, siteName, variant: 'tag' })}
    <div class="sticker-row">
      ${giftTag({ event, recipient, siteName, variant: 'sticker' })}
      ${giftTag({ event, recipient, siteName, variant: 'sticker' })}
    </div>
  </section>`;
}
