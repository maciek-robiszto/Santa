import { DrawError } from './draw.js';
import { deadlineEnd } from './deadline.js';
import { PROFILE_FIELDS } from './store.js';
import { fmtDate } from './views/layout.js';

function drawMail({ store, config }, event, giver) {
  const recipientId = store.recipientIdOf(event.id, giver.id);
  const recipient = recipientId && store.participantInEvent(event.id, recipientId);
  const profile = recipient ? store.profile(recipient) : {};
  const about = PROFILE_FIELDS.filter((f) => profile[f.key]).map((f) => `${f.label}:\n${profile[f.key]}`).join('\n\n');
  const meeting = [
    event.budget && `Budżet: ${event.budget}`,
    event.exchange_date && `Wymiana prezentów: ${fmtDate(event.exchange_date)}`,
    event.location && `Miejsce: ${event.location}`,
  ].filter(Boolean).join('\n');
  return [
    `Cześć ${giver.name}!`,
    `Losowanie w „${event.name}” się odbyło. Robisz prezent dla: ${recipient?.name ?? '(otwórz stronę grupy)'}`,
    about ? `O tej osobie\n\n${about}` : 'Ta osoba nie uzupełniła jeszcze profilu. Zajrzyj na stronę grupy później.',
    meeting,
    `Zachowaj to dla siebie 🤫 Aktualny profil i anonimowe pytania do tej osoby znajdziesz na stronie:\n${config.origin}/events/${event.id}`,
  ].filter(Boolean).join('\n\n') + '\n';
}

// The mail carries the recipient and the profile in plain text: there is no need to
// log in, but mailboxes (also "Sent" of the account sending it) keep this for good.
export function announceDraw(ctx, event) {
  for (const p of ctx.store.participants(event.id)) sendDrawMail(ctx, event, p);
}

/** Records how delivery ended, so the organizer can see it in the panel and send it again. */
export function sendDrawMail({ store, mailer, config }, event, p) {
  if (!mailer.enabled) return Promise.resolve();
  const drawnAt = store.eventById(event.id)?.drawn_at;
  // After a cancelled draw, a removed person or a deleted group a waiting retry must not go out.
  const stillValid = () => {
    const current = store.eventById(event.id);
    return current && current.status !== 'open' && current.drawn_at === drawnAt && store.participantById(p.id)?.event_id === event.id;
  };
  store.setDrawMail(p.id, 'pending');
  return Promise.resolve(mailer.send({
    to: p.email,
    subject: `${config.siteName}: losowanie zakończone 🎁`,
    text: drawMail({ store, config }, event, p),
    stillValid,
  })).then((ok) => {
    if (ok === null || !stillValid()) return;
    store.setDrawMail(p.id, ok === false ? 'failed' : 'sent');
    if (ok !== false) return;
    const owner = event.owner_user_id && store.userById(event.owner_user_id);
    for (const admin of owner ? [owner] : store.admins()) {
      mailer.send({
        to: admin.email,
        subject: `${config.siteName}: nie udało się wysłać maila po losowaniu`,
        text: `Co najmniej jeden uczestnik nie dostał maila po losowaniu. Sprawdź listę i wyślij ponownie:\n${config.origin}/manage/events/${event.id}\n`,
      });
    }
  }).catch((err) => console.error('[mail] stan wysyłki:', err.message));
}

const REMINDER_MS = 48 * 3600_000;

/**
 * Runs every minute: sends a reminder to people with an empty profile two days
 * before the signup deadline and performs the automatic draw once it passes.
 */
export function createScheduler(ctx, now = () => Date.now()) {
  const { store, mailer, config } = ctx;

  function tick() {
    for (const event of store.openEventsWithDeadline()) {
      const end = deadlineEnd(event.signup_deadline);
      const t = now();
      if (event.auto_draw && t >= end) {
        autoDraw(event);
      } else if (!event.reminder_sent && t >= end - REMINDER_MS && t < end) {
        store.markReminderSent(event.id);
        for (const p of store.participants(event.id).filter((x) => !x.profile_complete)) {
          mailer.send({
            to: p.email,
            subject: `${config.siteName}: uzupełnij profil przed losowaniem ✏️`,
            text: `Cześć ${p.name}!\n\nZapisy do „${event.name}” kończą się wkrótce, a Twój profil jest jeszcze pusty.\nNapisz kilka słów o sobie i o tym, co by Cię ucieszyło – Twój Mikołaj będzie wdzięczny:\n${config.origin}/events/${event.id}#profil\n`,
          });
        }
      }
    }
  }

  function autoDraw(event) {
    try {
      const count = store.runDraw(event.id);
      store.audit({ eventId: event.id, action: 'draw.auto', detail: `${count} osób`, isPublic: true });
      announceDraw(ctx, event);
    } catch (err) {
      if (!(err instanceof DrawError)) throw err;
      // Do not retry every minute – the organizer has to fix it and draw manually.
      store.setAutoDraw(event.id, false);
      store.audit({ eventId: event.id, action: 'draw.auto_failed', detail: err.message, isPublic: true });
      const owner = event.owner_user_id && store.userById(event.owner_user_id);
      for (const admin of owner ? [owner] : store.admins()) {
        mailer.send({
          to: admin.email,
          subject: `${config.siteName}: automatyczne losowanie nie powiodło się`,
          text: `Wydarzenie „${event.name}”: ${err.message}\nPopraw i wylosuj ręcznie: ${config.origin}/manage/events/${event.id}\n`,
        });
      }
    }
  }

  return {
    tick,
    start() {
      const run = () => { try { tick(); } catch (err) { console.error('[scheduler]', err); } };
      run();
      setInterval(run, 60_000).unref();
    },
  };
}
