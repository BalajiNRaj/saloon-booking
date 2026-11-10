// India has no daylight saving, so a fixed +05:30 offset is safe.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' of today in IST. */
export function todayIst(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST date + 'HH:MM' → JS Date (UTC instant). */
export function istToUtc(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm.slice(0, 5)}:00+05:30`);
}

/** JS Date → { date: 'YYYY-MM-DD', time: 'HH:MM' } in IST. */
export function utcToIst(d) {
  const iso = new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 'HH:MM' → minutes since midnight */
export function toMin(hhmm) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}
export function fromMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '13:30' → '1:30 PM' */
export function fmtTime(hhmm) {
  const min = toMin(hhmm);
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** '2026-11-10' → 'Tue, 10 Nov' */
export function fmtDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${DAY_NAMES[dayOfWeek(dateStr)]}, ${d} ${MONTHS[m - 1]}`;
}
