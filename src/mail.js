import nodemailer from 'nodemailer';

// A few connections at a time: Gmail answers a burst (e.g. everyone's mail after a draw) with 421.
function pooled(smtpUrl) {
  const url = new URL(smtpUrl);
  url.searchParams.set('pool', 'true');
  url.searchParams.set('maxConnections', '2');
  return url.toString();
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// 5xx will not change on retry; 4xx and lost connections usually do.
const isTransient = (err) => !(err.responseCode >= 500);

export function createMailer(config, { transport, retryDelays = RETRY_DELAYS_MS } = {}) {
  if (!config.smtpUrl && !transport) {
    return {
      enabled: false,
      async send({ to, subject }) {
        if (!config.isProd) console.info(`[mail] (SMTP wyłączony) do=${to} temat="${subject}"`);
        return false;
      },
    };
  }
  const smtp = transport ?? nodemailer.createTransport(pooled(config.smtpUrl));
  return {
    enabled: true,
    /** Resolves to true/false, or null when `stillValid` says this mail is no longer wanted. */
    async send({ to, subject, text, stillValid }) {
      for (let attempt = 0; ; attempt++) {
        if (stillValid && !stillValid()) return null;
        try {
          const info = await smtp.sendMail({ from: config.mailFrom || config.siteName, to, subject, text });
          // No addresses or subjects: only whether the server accepted the message.
          console.info(`[mail] przyjęte przez serwer: ${info.accepted.length}, odrzucone: ${info.rejected.length}`);
          return info.rejected.length === 0;
        } catch (err) {
          const code = err.responseCode ?? err.code ?? 'nieznany';
          if (!isTransient(err) || attempt >= retryDelays.length) {
            // Never log the message body: it may contain links with tokens.
            console.error('[mail] błąd wysyłki:', code);
            return false;
          }
          console.info(`[mail] ponawiam (kod ${code}, próba ${attempt + 2})`);
          await sleep(retryDelays[attempt]);
        }
      }
    },
  };
}
