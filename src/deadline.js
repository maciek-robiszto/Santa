const TZ = process.env.TZ_DISPLAY || 'Europe/Warsaw';
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });

function tzOffsetMs(ts) {
  const name = offsetFmt.formatToParts(new Date(ts)).find((p) => p.type === 'timeZoneName').value; // "GMT+01:00"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
}

/** Moment the signup deadline ends: midnight after the given day in the event time zone. */
export function deadlineEnd(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d + 1);
  // Two passes handle a DST switch on that night.
  let ts = utcMidnight - tzOffsetMs(utcMidnight);
  ts = utcMidnight - tzOffsetMs(ts);
  return ts;
}

export function signupClosed(event, now = Date.now()) {
  if (event.status !== 'open') return true;
  const end = deadlineEnd(event.signup_deadline);
  return end !== null && now >= end;
}
