import { istToUtc, dayOfWeek, toMin, fromMin } from './time.js';

const ACTIVE = new Set(['confirmed', 'pending']);

/**
 * Free start times for ONE stylist on one day.
 * busy: [{ start: Date, end: Date }]
 * Returns ['10:00', '10:30', ...] (IST).
 */
export function freeSlotsForStaff({ date, openTime, closeTime, durationMin, stepMin = 30, busy = [], now = new Date(), minLeadMin = 30 }) {
  const open = toMin(openTime), close = toMin(closeTime);
  const earliest = now.getTime() + minLeadMin * 60000;
  const out = [];
  for (let t = open; t + durationMin <= close; t += stepMin) {
    const hhmm = fromMin(t);
    const start = istToUtc(date, hhmm).getTime();
    const end = start + durationMin * 60000;
    if (start < earliest) continue;
    const clash = busy.some((b) => start < b.end.getTime() && end > b.start.getTime());
    if (!clash) out.push(hhmm);
  }
  return out;
}

/**
 * Free slots across a list of stylists ("Anyone" = all of them).
 * bookings: rows with staff_id, start_at, end_at, status.
 * Returns [{ time: 'HH:MM', staffId }] sorted by time; for each time the first free stylist wins.
 */
export function computeSlots({ salon, date, service, staffList, bookings, now = new Date() }) {
  const dow = dayOfWeek(date);
  if ((salon.closed_days || []).includes(dow)) return [];
  const byTime = new Map();
  for (const st of staffList) {
    if ((st.off_days || []).includes(dow)) continue;
    const busy = bookings
      .filter((b) => b.staff_id === st.id && ACTIVE.has(b.status))
      .map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) }));
    const times = freeSlotsForStaff({
      date,
      openTime: salon.open_time,
      closeTime: salon.close_time,
      durationMin: service.duration_min,
      stepMin: salon.slot_step_min || 30,
      minLeadMin: salon.min_lead_min ?? 30,
      busy,
      now,
    });
    for (const t of times) if (!byTime.has(t)) byTime.set(t, st.id);
  }
  return [...byTime.entries()]
    .map(([time, staffId]) => ({ time, staffId }))
    .sort((a, b) => toMin(a.time) - toMin(b.time));
}

/** Morning < 12:00, Afternoon 12:00–16:59, Evening ≥ 17:00 */
export function partOfDay(hhmm) {
  const m = toMin(hhmm);
  if (m < 12 * 60) return 'M';
  if (m < 17 * 60) return 'A';
  return 'E';
}
