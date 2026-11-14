// All database access goes through here (Supabase / Postgres).
import { createClient } from '@supabase/supabase-js';

let client;
function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

function must({ data, error }) {
  if (error) throw new Error(`DB error: ${error.message}`);
  return data;
}

const timeHHMM = (t) => (t ? String(t).slice(0, 5) : t);
function normSalon(s) {
  return s && { ...s, open_time: timeHHMM(s.open_time), close_time: timeHHMM(s.close_time) };
}

export const db = {
  async getSalonByPhoneNumberId(phoneNumberId) {
    const data = must(await sb().from('salons').select('*').eq('wa_phone_number_id', phoneNumberId).maybeSingle());
    return normSalon(data);
  },

  async getServices(salonId) {
    return must(await sb().from('services').select('id,name,duration_min,price').eq('salon_id', salonId).eq('active', true).order('sort'));
  },

  async getStaff(salonId) {
    return must(await sb().from('staff').select('id,name,off_days').eq('salon_id', salonId).eq('active', true).order('sort'));
  },

  async getBookingsBetween(salonId, fromUtc, toUtc) {
    return must(
      await sb()
        .from('bookings')
        .select('id,staff_id,start_at,end_at,status')
        .eq('salon_id', salonId)
        .in('status', ['confirmed', 'pending'])
        .lt('start_at', toUtc.toISOString())
        .gt('end_at', fromUtc.toISOString())
    );
  },

  async getSession(salonId, phone) {
    return must(await sb().from('sessions').select('data,updated_at').eq('salon_id', salonId).eq('customer_phone', phone).maybeSingle());
  },

  async saveSession(salonId, phone, data) {
    must(await sb().from('sessions').upsert({ salon_id: salonId, customer_phone: phone, data, updated_at: new Date().toISOString() }));
  },

  async clearSession(salonId, phone) {
    must(await sb().from('sessions').delete().eq('salon_id', salonId).eq('customer_phone', phone));
  },

  /** Returns { ok: true, booking } or { ok: false, reason: 'taken' } */
  async createBooking(row) {
    const { data, error } = await sb().from('bookings').insert(row).select('id,ref_no').single();
    if (error) {
      if (error.code === '23P01') return { ok: false, reason: 'taken' }; // no_double_booking constraint
      throw new Error(`DB error: ${error.message}`);
    }
    return { ok: true, booking: data };
  },

  async getUpcomingBookings(salonId, phone, now) {
    const rows = must(
      await sb()
        .from('bookings')
        .select('id,ref_no,start_at,end_at,status,services(name),staff(name)')
        .eq('salon_id', salonId)
        .eq('customer_phone', phone)
        .eq('status', 'confirmed')
        .gt('start_at', now.toISOString())
        .order('start_at')
    );
    return rows.map((r) => ({ ...r, service_name: r.services?.name, staff_name: r.staff?.name }));
  },

  async cancelBooking(salonId, phone, bookingId, now) {
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return false;
    const rows = must(
      await sb()
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('salon_id', salonId)
        .eq('customer_phone', phone)
        .eq('status', 'confirmed')
        .gt('start_at', now.toISOString())
        .select('id')
    );
    return rows.length > 0;
  },

  async createHandoff(salonId, phone, name) {
    must(await sb().from('handoff_requests').insert({ salon_id: salonId, customer_phone: phone, customer_name: name }));
  },

  /** Logs an incoming message. Returns false if we've already seen this WhatsApp message ID. */
  async logIncoming({ salonId, phone, msgId, body }) {
    const { error } = await sb().from('messages').insert({ salon_id: salonId, customer_phone: phone, direction: 'in', wa_message_id: msgId, body });
    if (error) {
      if (error.code === '23505') return false; // duplicate
      throw new Error(`DB error: ${error.message}`);
    }
    return true;
  },

  async logOutgoing({ salonId, phone, msgId, body }) {
    const { error } = await sb().from('messages').insert({ salon_id: salonId, customer_phone: phone, direction: 'out', wa_message_id: msgId || null, body });
    if (error) console.error('Failed to log outgoing message', error.message);
  },

  /** Confirmed bookings starting in the next 24 h, with what the reminder needs. */
  async getReminderCandidates(now) {
    const to = new Date(now.getTime() + 24 * 3600 * 1000);
    const rows = must(
      await sb()
        .from('bookings')
        .select('id,salon_id,customer_phone,customer_name,start_at,created_at,status,reminder_24h_sent_at,reminder_2h_sent_at,services(name),salons(name,wa_phone_number_id)')
        .eq('status', 'confirmed')
        .gt('start_at', now.toISOString())
        .lte('start_at', to.toISOString())
    );
    return rows.map((r) => ({
      ...r,
      service_name: r.services?.name,
      salon_name: r.salons?.name,
      wa_phone_number_id: r.salons?.wa_phone_number_id,
    }));
  },

  async markReminderSent(bookingId, which) {
    const col = which === '2h' ? 'reminder_2h_sent_at' : 'reminder_24h_sent_at';
    must(await sb().from('bookings').update({ [col]: new Date().toISOString() }).eq('id', bookingId));
  },

  // ---- Admin page ----

  async getSalons() {
    const rows = must(await sb().from('salons').select('id,name,open_time,close_time').order('name'));
    return rows.map(normSalon);
  },

  /** Bookings for the admin list, newest first within the window. */
  async getAdminBookings(salonId, { fromUtc, toUtc, limit = 200 } = {}) {
    let q = sb()
      .from('bookings')
      .select('id,ref_no,staff_id,start_at,end_at,status,price,customer_name,customer_phone,source,services(name),staff(name)')
      .eq('salon_id', salonId)
      .order('start_at', { ascending: false })
      .limit(limit);
    if (fromUtc) q = q.gte('start_at', fromUtc.toISOString());
    if (toUtc) q = q.lte('start_at', toUtc.toISOString());
    const rows = must(await q);
    return rows.map((r) => ({ ...r, service_name: r.services?.name, staff_name: r.staff?.name }));
  },

  async adminCancelBooking(salonId, bookingId) {
    const rows = must(
      await sb().from('bookings').update({ status: 'cancelled' }).eq('id', bookingId).eq('salon_id', salonId).select('id')
    );
    return rows.length > 0;
  },

  async adminSetBookingStatus(salonId, bookingId, status) {
    const allowed = ['confirmed', 'pending', 'cancelled', 'noshow', 'completed'];
    if (!allowed.includes(status)) throw new Error('bad status');
    const rows = must(
      await sb().from('bookings').update({ status }).eq('id', bookingId).eq('salon_id', salonId).select('id')
    );
    return rows.length > 0;
  },

  async getMessagesForCustomer(salonId, phone, limit = 300) {
    return must(
      await sb()
        .from('messages')
        .select('id,direction,body,created_at')
        .eq('salon_id', salonId)
        .eq('customer_phone', phone)
        .order('created_at', { ascending: true })
        .limit(limit)
    );
  },

  /** Distinct customers for a salon, most recently active first. */
  async getAdminCustomers(salonId, limit = 100) {
    const rows = must(
      await sb()
        .from('messages')
        .select('customer_phone, created_at')
        .eq('salon_id', salonId)
        .order('created_at', { ascending: false })
        .limit(2000)
    );
    const seen = new Map();
    for (const r of rows) {
      if (!seen.has(r.customer_phone)) seen.set(r.customer_phone, r.created_at);
      if (seen.size >= limit) break;
    }
    const phones = [...seen.keys()];
    if (phones.length === 0) return [];
    const names = must(
      await sb()
        .from('bookings')
        .select('customer_phone,customer_name')
        .eq('salon_id', salonId)
        .in('customer_phone', phones)
        .order('created_at', { ascending: false })
    );
    const nameOf = new Map();
    for (const n of names) if (!nameOf.has(n.customer_phone) && n.customer_name) nameOf.set(n.customer_phone, n.customer_name);
    return phones.map((phone) => ({ phone, name: nameOf.get(phone) || null, lastActive: seen.get(phone) }));
  },

  async getHandoffRequests(salonId, { onlyOpen = true } = {}) {
    let q = sb()
      .from('handoff_requests')
      .select('id,customer_phone,customer_name,resolved,created_at')
      .eq('salon_id', salonId)
      .order('created_at', { ascending: false });
    if (onlyOpen) q = q.eq('resolved', false);
    return must(await q);
  },

  async resolveHandoff(salonId, id) {
    const rows = must(
      await sb().from('handoff_requests').update({ resolved: true }).eq('id', id).eq('salon_id', salonId).select('id')
    );
    return rows.length > 0;
  },
};
