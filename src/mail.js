import nodemailer from 'nodemailer';

export function createMailer(config) {
  if (!config.smtpUrl) {
    return {
      enabled: false,
      async send({ to, subject }) {
        if (!config.isProd) console.info(`[mail] (SMTP wyłączony) do=${to} temat="${subject}"`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    enabled: true,
    async send({ to, subject, text }) {
      try {
        const info = await transport.sendMail({ from: config.mailFrom || config.siteName, to, subject, text });
        // No addresses or subjects: only whether the server accepted the message.
        console.info(`[mail] przyjęte przez serwer: ${info.accepted.length}, odrzucone: ${info.rejected.length}`);
      } catch (err) {
        // Never log the message body: it may contain links with tokens.
        console.error('[mail] błąd wysyłki:', err.code || err.message);
      }
    },
  };
}
