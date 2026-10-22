import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { cookieNames, csrf, parseCookies, securityHeaders, setCookie, createRateLimiter } from './security.js';
import { layout } from './views/layout.js';
import { errorPage } from './views/pages.js';
import { publicRoutes } from './routes/public.js';
import { eventRoutes } from './routes/events.js';
import { manageRoutes } from './routes/manage.js';
import { canCreateGroups } from './routes/helpers.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ config, store, mailer }) {
  const app = express();
  const names = cookieNames(config);
  const limiter = createRateLimiter();
  const ctx = { config, store, mailer, limiter, names };

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 'false' ? false : /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.use(securityHeaders(config));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use('/static', express.static(PUBLIC_DIR, { maxAge: config.isProd ? '7d' : 0, index: false }));

  app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));
  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    // Pages contain personal data: never cache them anywhere.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(csrf(config));

  // Session + flash + render helper
  app.use((req, res, next) => {
    req.user = store.sessionUser(req.cookies[names.session]);
    if (!req.user && req.cookies[names.session]) res.clearCookie(names.session, { path: '/', secure: config.secureCookies });

    let flash = null;
    if (req.cookies[names.flash]) {
      try { flash = JSON.parse(Buffer.from(req.cookies[names.flash], 'base64url').toString('utf8')); } catch { /* ignore */ }
      res.clearCookie(names.flash, { path: '/', secure: config.secureCookies });
    }
    res.flash = (type, text) => setCookie(res, config, names.flash, Buffer.from(JSON.stringify({ type, text })).toString('base64url'), { maxAge: 60_000 });
    res.page = (title, body, opts = {}) => {
      res.status(opts.status ?? 200).type('html').send(String(layout({
        title, body, user: req.user, csrf: res.locals.csrf, flash: opts.flash ?? flash, siteName: config.siteName, wide: opts.wide,
        canOrganize: canCreateGroups(config, req.user), openRegistration: config.openRegistration,
      })));
    };
    next();
  });

  app.use(publicRoutes(ctx));
  app.use(eventRoutes(ctx));
  app.use('/manage', manageRoutes(ctx));
  app.get(['/admin', '/admin/*rest'], (req, res) => res.redirect(301, req.originalUrl.replace(/^\/admin/, '/manage')));

  app.use((req, res) => res.page('Nie znaleziono', errorPage(404, 'Nie ma tu takiej strony'), { status: 404 }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).send('Za duże dane');
    console.error('[error]', req.method, req.path, err.stack || err);
    if (res.headersSent) return;
    res.status(500).type('html').send('<h1>500</h1><p>Coś poszło nie tak. Spróbuj ponownie.</p>');
  });

  return app;
}
