import { Router } from 'express';
import * as v from '../validate.js';
import { PROFILE_FIELDS, GIFT_STATUSES } from '../store.js';
import { eventPage, giftLabelPage } from '../views/pages.js';
import { requireUser, notFound, tooMany } from './helpers.js';

export function eventRoutes({ store, config, mailer, limiter }) {
  const r = Router();

  // Resolves the event and the current user's participation; 404 for non-members.
  function load(req, res, next) {
    const eventId = v.id(req.params.id);
    const event = eventId && store.eventById(eventId);
    const me = event && store.participantFor(event.id, req.user.id);
    if (!me) return notFound(res);
    req.event = event;
    req.me = me;
    next();
  }

  function buildContext(req, res, extra = {}) {
    const { event, me } = req;
    const ctx = {
      csrf: res.locals.csrf,
      event,
      me,
      profile: store.profile(me),
      participants: store.participants(event.id),
      publicLog: store.auditLog(event.id, true),
      santaThread: [],
      recipientThread: [],
      ...extra,
    };
    if (event.status !== 'open') {
      const recipientId = store.recipientIdOf(event.id, me.id);
      const recipient = recipientId && store.participantById(recipientId);
      if (recipient) {
        ctx.recipient = recipient;
        ctx.recipientProfile = store.profile(recipient);
        ctx.myGiftStatus = store.assignmentOf(event.id, me.id).gift_status;
        ctx.recipientThread = store.thread(event.id, me.id);
      }
      const santa = store.santaOf(event.id, me.id);
      if (santa) {
        ctx.santaGiftStatus = santa.gift_status;
        ctx.santaThread = store.thread(event.id, santa.giver_id);
        if (event.status === 'finished' && event.reveal_santas) {
          ctx.revealedSanta = store.participantById(santa.giver_id)?.name;
        }
      }
    }
    return ctx;
  }

  r.get('/events/:id', requireUser, load, (req, res) => {
    res.page(req.event.name, eventPage(buildContext(req, res)));
  });

  r.get('/events/:id/label', requireUser, load, (req, res) => {
    const recipientId = req.event.status !== 'open' && store.recipientIdOf(req.event.id, req.me.id);
    const recipient = recipientId && store.participantById(recipientId);
    if (!recipient) return notFound(res);
    res.page('Etykieta na prezent', giftLabelPage({ event: req.event, recipient, siteName: config.siteName }));
  });

  r.post('/events/:id/profile', requireUser, load, (req, res) => {
    if (req.event.status === 'finished') return res.redirect(303, `/events/${req.event.id}`);
    const profile = {};
    const errors = {};
    for (const f of PROFILE_FIELDS) {
      const result = f.url ? v.url(req.body[f.key], f.max) : v.text(req.body[f.key], f.max);
      profile[f.key] = result.value;
      if (result.error) errors[f.key] = result.error;
    }
    if (Object.keys(errors).length) {
      return res.page(req.event.name, eventPage(buildContext(req, res, { profile, errors })), {
        status: 422, flash: { type: 'error', text: 'Popraw zaznaczone pola.' },
      });
    }
    const complete = Boolean((profile.about || profile.passions) && profile.wishes);
    store.saveProfile(req.me, profile, complete);
    res.flash('ok', complete ? 'Profil zapisany 🎉' : 'Zapisano. Dopisz jeszcze coś o sobie i o tym, co by Cię ucieszyło.');
    res.redirect(303, `/events/${req.event.id}#profil`);
  });

  r.post('/events/:id/messages', requireUser, load, (req, res) => {
    const { event, me } = req;
    if (event.status !== 'drawn') return res.redirect(303, `/events/${event.id}`);
    if (!limiter.hit(`msg:${req.user.id}`, 40, 60 * 60_000)) return tooMany(res);
    const body = v.text(req.body.body, 1000);
    if (body.error || !body.value) {
      res.flash('error', body.error ?? 'Wiadomość jest pusta.');
      return res.redirect(303, `/events/${event.id}`);
    }

    let giverId;
    let notifyId;
    if (req.body.to === 'recipient') {
      giverId = me.id;
      notifyId = store.recipientIdOf(event.id, me.id);
    } else if (req.body.to === 'santa') {
      giverId = store.santaOf(event.id, me.id)?.giver_id;
      notifyId = giverId;
    }
    if (!giverId) return notFound(res);

    store.addMessage(event.id, giverId, req.body.to === 'recipient', body.value);
    const target = notifyId && store.participantById(notifyId);
    if (target) {
      mailer.send({
        to: target.email,
        subject: `${config.siteName}: nowa anonimowa wiadomość`,
        text: `Cześć ${target.name}!\n\nMasz nową wiadomość w „${event.name}”.\nZobacz: ${config.origin}/events/${event.id}\n`,
      });
    }
    res.flash('ok', 'Wysłano 📨');
    res.redirect(303, `/events/${event.id}#${req.body.to === 'recipient' ? 'przydzial' : 'mikolaj'}`);
  });

  r.post('/events/:id/gift-status', requireUser, load, (req, res) => {
    const status = String(req.body.status);
    if (req.event.status !== 'open' && Object.hasOwn(GIFT_STATUSES, status) && store.assignmentOf(req.event.id, req.me.id)) {
      store.setGiftStatus(req.event.id, req.me.id, status);
      res.flash('ok', 'Status prezentu zaktualizowany.');
    }
    res.redirect(303, `/events/${req.event.id}#przydzial`);
  });

  r.post('/events/:id/leave', requireUser, load, (req, res) => {
    if (req.event.status !== 'open') return res.redirect(303, `/events/${req.event.id}`);
    store.removeParticipant(req.me.id);
    store.audit({ eventId: req.event.id, actor: req.user, action: 'participant.leave', detail: req.user.name, isPublic: true });
    res.flash('ok', `Zrezygnowano z „${req.event.name}”.`);
    res.redirect(303, '/');
  });

  return r;
}
