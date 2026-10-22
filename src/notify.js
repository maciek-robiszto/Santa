import { DrawError } from './draw.js';
import { deadlineEnd } from './deadline.js';

export function announceDraw({ store, mailer, config }, event) {
  for (const p of store.participants(event.id)) {
    mailer.send({
      to: p.email,
      subject: `${config.siteName}: losowanie zakończone 🎁`,
      text: `Cześć ${p.name}!\n\nLosowanie w „${event.name}” się odbyło. Zaloguj się, żeby zobaczyć, kogo obdarowujesz:\n${config.origin}/events/${event.id}\n`,
    });
  }
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
