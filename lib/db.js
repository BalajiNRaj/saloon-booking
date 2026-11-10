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
};
