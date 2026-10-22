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
        await transport.sendMail({ from: config.mailFrom || config.siteName, to, subject, text });
      } catch (err) {
        // Never log the message body: it may contain links with tokens.
        console.error('[mail] błąd wysyłki:', err.code || err.message);
      }
    },
  };
}
