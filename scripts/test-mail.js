// Wysyła maila testowego, żeby sprawdzić ustawienia SMTP z .env.
// Użycie: node scripts/test-mail.js ty@example.pl
import nodemailer from 'nodemailer';
import { loadConfig } from '../src/config.js';

const to = process.argv[2];
if (!to) { console.error('Podaj adres: node scripts/test-mail.js ty@example.pl'); process.exit(1); }
const config = loadConfig();
if (!config.smtpUrl) { console.error('Brak SMTP_URL w .env'); process.exit(1); }

const transport = nodemailer.createTransport(config.smtpUrl);
try {
  await transport.verify();
  console.log('✔ Połączenie z serwerem poczty OK');
  const info = await transport.sendMail({
    from: config.mailFrom || config.siteName,
    to,
    subject: `${config.siteName}: test poczty 🎁`,
    text: `Działa! Maile z ${config.origin} będą dochodzić.`,
  });
  console.log('✔ Wysłano:', info.response);
} catch (err) {
  // Nie wypisujemy SMTP_URL – zawiera hasło.
  console.error('✘ Błąd:', err.code || '', err.response || err.message);
  if (err.code === 'EAUTH') console.error('  Sprawdź login (@ zapisane jako %40) i 16-znakowe hasło aplikacji bez spacji.');
  process.exit(1);
}
