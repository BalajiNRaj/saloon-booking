// In-memory stand-ins for the database and WhatsApp, so the whole conversation can be tested offline.
import { randomUUID } from 'node:crypto';

export function makeFakeDb() {
  const salon = { id: 'salon-1', name: 'Demo Salon', wa_phone_number_id: 'PNID', open_time: '10:00', close_time: '20:00', closed_days: [], slot_step_min: 30, min_lead_min: 30 };
  const staff = [
    { id: 'st-priya', name: 'Priya', off_days: [] },
    { id: 'st-arun', name: 'Arun', off_days: [] },
  ];
  const services = [
    { id: 'sv-cut', name: 'Haircut', duration_min: 30, price: 350 },
    { id: 'sv-colour', name: 'Hair colour', duration_min: 120, price: 2800 },
  ];
  const bookings = [];
  const sessions = new Map();
  const seen = new Set();
  const handoffs = [];
  let ref = 1000;
  const overlaps = (a, b) => new Date(a.start_at) < new Date(b.end_at) && new Date(a.end_at) > new Date(b.start_at);
  const active = (b) => b.status === 'confirmed' || b.status === 'pending';

  return {
    salon, staff, services, bookings, sessions, handoffs,
    async getServices() { return services; },
    async getStaff() { return staff; },
    async getBookingsBetween(_s, from, to) {
      return bookings.filter((b) => active(b) && new Date(b.start_at) < to && new Date(b.end_at) > from);
    },
    async getSession(_s, phone) { return sessions.get(phone) || null; },
    async saveSession(_s, phone, data) { sessions.set(phone, { data: JSON.parse(JSON.stringify(data)), updated_at: new Date().toISOString() }); },
    async clearSession(_s, phone) { sessions.delete(phone); },
    async createBooking(row) {
      // same rule as the Postgres exclusion constraint
      if (bookings.some((b) => b.staff_id === row.staff_id && active(b) && overlaps(b, row))) return { ok: false, reason: 'taken' };
      const b = { ...row, id: randomUUID(), ref_no: ++ref, created_at: new Date().toISOString() };
      bookings.push(b);
      return { ok: true, booking: { id: b.id, ref_no: b.ref_no } };
    },
    async getUpcomingBookings(_s, phone, now) {
      return bookings
        .filter((b) => b.customer_phone === phone && b.status === 'confirmed' && new Date(b.start_at) > now)
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
        .map((b) => ({ ...b, service_name: services.find((s) => s.id === b.service_id).name, staff_name: staff.find((s) => s.id === b.staff_id).name }));
    },
    async cancelBooking(_s, phone, id, now) {
      const b = bookings.find((x) => x.id === id && x.customer_phone === phone && x.status === 'confirmed' && new Date(x.start_at) > now);
      if (!b) return false;
      b.status = 'cancelled';
      return true;
    },
    async createHandoff(_s, phone, name) { handoffs.push({ phone, name }); },
    async logIncoming({ msgId }) {
      if (seen.has(msgId)) return false;
      seen.add(msgId);
      return true;
    },
  };
}

export function makeFakeWa() {
  const sent = [];
  return {
    sent,
    last() { return sent[sent.length - 1]; },
    async text(to, body) { sent.push({ to, kind: 'text', body }); },
    async buttons(to, body, buttons) { sent.push({ to, kind: 'buttons', body, options: buttons }); },
    async list(to, body, label, section, rows) { sent.push({ to, kind: 'list', body, options: rows }); },
    async template(to, name, lang, params) { sent.push({ to, kind: 'template', name, params }); },
  };
}
