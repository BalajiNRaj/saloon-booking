import { utcToIst, fmtDate, fmtTime } from './time.js';

const H = 3600 * 1000;

/**
 * Which reminder (if any) is due for a booking right now.
 * - '24h': appointment is within 24 h (but more than 3 h away) and was booked at least 20 h ahead.
 * - '2h' : appointment is within 2 h and was booked at least 3 h ahead.
 * Bookings made at the last minute just skip the reminder they'd find pointless.
 */
export function pickReminder(b, now = new Date()) {
  if (b.status !== 'confirmed') return null;
  const start = new Date(b.start_at).getTime();
  const created = new Date(b.created_at).getTime();
  const until = start - now.getTime();
  const leadTime = start - created;
  if (until <= 0) return null;
  if (!b.reminder_2h_sent_at && until <= 2 * H && leadTime >= 3 * H) return '2h';
  if (!b.reminder_24h_sent_at && until <= 24 * H && until > 3 * H && leadTime >= 20 * H) return '24h';
  return null;
}

/** Template parameters, in order: {{1}} name, {{2}} service, {{3}} date, {{4}} time, {{5}} salon */
export function reminderParams(b) {
  const { date, time } = utcToIst(b.start_at);
  return [
    (b.customer_name || 'there').split(' ')[0],
    b.service_name,
    fmtDate(date),
    fmtTime(time),
    b.salon_name,
  ];
}
