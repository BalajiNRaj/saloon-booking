// The booking conversation. No AI: customers tap buttons and lists.
//
// Every button/list row carries an ID that says what was tapped:
//   MENU_HOME, MENU_BOOK, MENU_MINE, MENU_TALK
//   SVC_<serviceId>  → STF_<staffId|ANY>  → DAY_<YYYY-MM-DD>  → PART_<M|A|E>  → TIME_<HH:MM>
//   CONFIRM, CHANGE, BKG_<bookingId>, CXL_<bookingId>
// What's been picked so far lives in the `sessions` table.

import { computeSlots, partOfDay } from './slots.js';
import { todayIst, addDays, istToUtc, utcToIst, fmtDate, fmtTime, isValidDate, isValidTime } from './time.js';

const SESSION_TTL_MS = 30 * 60 * 1000; // a half-finished booking expires after 30 min
const DAYS_AHEAD = 14;                 // look this far ahead for free days
const MAX_DAYS_SHOWN = 7;
const PART_LABEL = { M: 'Morning', A: 'Afternoon', E: 'Evening' };

export function createBot({ db, wa, now = () => new Date() }) {
  // ---------- helpers ----------
  async function loadSession(salon, phone) {
    const s = await db.getSession(salon.id, phone);
    if (!s) return {};
    if (now().getTime() - new Date(s.updated_at).getTime() > SESSION_TTL_MS) return {};
    return s.data || {};
  }
  const save = (salon, phone, data) => db.saveSession(salon.id, phone, data);
  const clear = (salon, phone) => db.clearSession(salon.id, phone);

  async function catalogue(salon) {
    const [services, staff] = await Promise.all([db.getServices(salon.id), db.getStaff(salon.id)]);
    return { services, staff };
  }

  async function bookingsFor(salon, fromDate, days) {
    return db.getBookingsBetween(salon.id, istToUtc(fromDate, '00:00'), istToUtc(addDays(fromDate, days), '00:00'));
  }

  function staffListFor(sess, staff) {
    if (sess.staffId) return staff.filter((s) => s.id === sess.staffId);
    return staff;
  }

  async function slotsFor(salon, sess, date, cat) {
    const service = cat.services.find((s) => s.id === sess.serviceId);
    if (!service) return null;
    const bookings = await bookingsFor(salon, date, 1);
    return computeSlots({ salon, date, service, staffList: staffListFor(sess, cat.staff), bookings, now: now() });
  }

  const staffName = (cat, id) => cat.staff.find((s) => s.id === id)?.name || 'our stylist';

  // ---------- screens ----------
  async function showMenu(salon, to, intro) {
    const body = `${intro ? intro + '\n\n' : ''}Welcome to *${salon.name}*! What would you like to do?`;
    await wa.buttons(to, body, [
      { id: 'MENU_BOOK', title: 'Book appointment' },
      { id: 'MENU_MINE', title: 'My bookings' },
      { id: 'MENU_TALK', title: 'Talk to salon' },
    ]);
  }

  async function showServices(salon, to) {
    const { services } = await catalogue(salon);
    if (!services.length) return wa.text(to, 'Online booking is not set up yet. Please call the salon.');
    await save(salon, to, {});
    await wa.list(to, 'Which service would you like?', 'Choose service', 'Services',
      services.map((s) => ({ id: `SVC_${s.id}`, title: s.name, description: `${s.duration_min} min · ₹${s.price}` })));
  }

  async function showStaff(salon, to, cat) {
    await wa.list(to, 'Any stylist you prefer?', 'Choose stylist', 'Stylists', [
      { id: 'STF_ANY', title: 'Anyone available', description: 'Earliest free stylist' },
      ...cat.staff.slice(0, 9).map((s) => ({ id: `STF_${s.id}`, title: s.name })),
    ]);
  }

  async function showDays(salon, to, sess, cat) {
    const service = cat.services.find((s) => s.id === sess.serviceId);
    if (!service) return showServices(salon, to);
    const today = todayIst(now());
    const bookings = await bookingsFor(salon, today, DAYS_AHEAD);
    const staffList = staffListFor(sess, cat.staff);
    const rows = [];
    for (let i = 0; i < DAYS_AHEAD && rows.length < MAX_DAYS_SHOWN; i++) {
      const date = addDays(today, i);
      const n = computeSlots({ salon, date, service, staffList, bookings, now: now() }).length;
      if (!n) continue;
      const title = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(date);
      rows.push({ id: `DAY_${date}`, title, description: `${fmtDate(date)} · ${n} slot${n === 1 ? '' : 's'} free` });
    }
    if (!rows.length) {
      await wa.text(to, `Sorry, there are no free slots for ${service.name} in the next two weeks.`);
      return showMenu(salon, to);
    }
    await wa.list(to, `When would you like your ${service.name}?`, 'Choose day', 'Available days', rows);
  }

  async function showTimes(salon, to, sess, cat, part) {
    const slots = await slotsFor(salon, sess, sess.date, cat);
    if (slots === null) return showServices(salon, to);
    if (!slots.length) {
      await wa.text(to, `Sorry, ${fmtDate(sess.date)} just filled up. Please pick another day.`);
      return showDays(salon, to, sess, cat);
    }
    let pick = slots;
    if (!part && slots.length > 10) {
      const parts = ['M', 'A', 'E'].filter((p) => slots.some((s) => partOfDay(s.time) === p));
      return wa.buttons(to, `Which part of ${fmtDate(sess.date)} suits you?`,
        parts.map((p) => ({ id: `PART_${p}`, title: PART_LABEL[p] })));
    }
    if (part) pick = slots.filter((s) => partOfDay(s.time) === part);
    if (!pick.length) return showTimes(salon, to, sess, cat, null);
    await wa.list(to, `Free times on ${fmtDate(sess.date)}:`, 'Choose time', part ? PART_LABEL[part] : 'Times',
      pick.slice(0, 10).map((s) => ({ id: `TIME_${s.time}`, title: fmtTime(s.time), description: `with ${staffName(cat, s.staffId)}` })));
  }

  async function showSummary(salon, to, sess, cat) {
    const service = cat.services.find((s) => s.id === sess.serviceId);
    const body =
      `Please confirm your booking:\n\n` +
      `*${service.name}* (${service.duration_min} min)\n` +
      `With ${staffName(cat, sess.resolvedStaffId)}\n` +
      `${fmtDate(sess.date)} at ${fmtTime(sess.time)}\n` +
      `Price: ₹${service.price}`;
    await wa.buttons(to, body, [
      { id: 'CONFIRM', title: 'Confirm' },
      { id: 'CHANGE', title: 'Change time' },
      { id: 'MENU_HOME', title: 'Cancel' },
    ]);
  }

  async function confirm(salon, to, name, sess, cat) {
    const service = cat.services.find((s) => s.id === sess.serviceId);
    if (!service || !sess.date || !sess.time) {
      await clear(salon, to);
      return showMenu(salon, to, "Sorry, that took a while and the booking expired. Let's start again.");
    }
    // Re-check: someone may have taken the slot while this customer was deciding.
    const slots = (await slotsFor(salon, sess, sess.date, cat)) || [];
    const stillFree = slots.find((s) => s.time === sess.time && s.staffId === sess.resolvedStaffId) || slots.find((s) => s.time === sess.time);
    if (!stillFree) {
      await wa.text(to, 'Sorry, that time was just taken. Here are the times still free:');
      return showTimes(salon, to, sess, cat, null);
    }
    const start = istToUtc(sess.date, sess.time);
    const end = new Date(start.getTime() + service.duration_min * 60000);
    const res = await db.createBooking({
      salon_id: salon.id,
      staff_id: stillFree.staffId,
      service_id: service.id,
      customer_phone: to,
      customer_name: name || null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      price: service.price,
      status: 'confirmed',
      source: 'whatsapp',
    });
    if (!res.ok) {
      await wa.text(to, 'Sorry, that time was just taken. Here are the times still free:');
      return showTimes(salon, to, sess, cat, null);
    }
    await clear(salon, to);
    await wa.text(to,
      `Your booking is confirmed.\n\n` +
      `Ref: *B${res.booking.ref_no}*\n` +
      `${service.name} with ${staffName(cat, stillFree.staffId)}\n` +
      `${fmtDate(sess.date)} at ${fmtTime(sess.time)}\n\n` +
      `We'll remind you before your appointment. Send *menu* any time to book again or cancel.`);
  }

  async function showMine(salon, to) {
    const list = await db.getUpcomingBookings(salon.id, to, now());
    if (!list.length) return showMenu(salon, to, "You don't have any upcoming bookings.");
    await wa.list(to, 'Your upcoming bookings. Tap one to see or cancel it.', 'View bookings', 'Upcoming',
      list.slice(0, 10).map((b) => {
        const { date, time } = utcToIst(b.start_at);
        return { id: `BKG_${b.id}`, title: `${fmtDate(date)} ${fmtTime(time)}`, description: `${b.service_name} with ${b.staff_name} · Ref B${b.ref_no}` };
      }));
  }

  async function showBooking(salon, to, id) {
    const list = await db.getUpcomingBookings(salon.id, to, now());
    const b = list.find((x) => x.id === id);
    if (!b) return showMine(salon, to);
    const { date, time } = utcToIst(b.start_at);
    await wa.buttons(to, `*${b.service_name}* with ${b.staff_name}\n${fmtDate(date)} at ${fmtTime(time)}\nRef: B${b.ref_no}`, [
      { id: `CXL_${b.id}`, title: 'Cancel booking' },
      { id: 'MENU_MINE', title: 'Back' },
      { id: 'MENU_HOME', title: 'Main menu' },
    ]);
  }

  async function cancel(salon, to, id) {
    const ok = await db.cancelBooking(salon.id, to, id, now());
    if (!ok) return showMine(salon, to);
    await showMenu(salon, to, 'Your booking is cancelled.');
  }

  // ---------- entry point ----------
  async function handleIncoming({ salon, from, name, msgId, type, text, replyId }) {
    const fresh = await db.logIncoming({ salonId: salon.id, phone: from, msgId, body: replyId ? `${text} [${replyId}]` : text || `[${type}]` });
    if (!fresh) return; // WhatsApp retried a message we already handled

    if (type !== 'interactive' || !replyId) {
      const t = (text || '').trim().toLowerCase();
      if (/^(my bookings?|cancel)$/.test(t)) return showMine(salon, from);
      if (/^(book|booking)$/.test(t)) return showServices(salon, from);
      return showMenu(salon, from, name ? `Hi ${name.split(' ')[0]}!` : 'Hi!');
    }

    const [key, ...rest] = replyId.split('_');
    const arg = rest.join('_');

    switch (key) {
      case 'MENU':
        if (arg === 'BOOK') return showServices(salon, from);
        if (arg === 'MINE') return showMine(salon, from);
        if (arg === 'TALK') {
          await db.createHandoff(salon.id, from, name);
          return wa.text(from, "Thanks! We've asked the salon to call you back on this number shortly.");
        }
        await clear(salon, from);
        return showMenu(salon, from);

      case 'SVC': {
        const cat = await catalogue(salon);
        if (!cat.services.some((s) => s.id === arg)) return showServices(salon, from);
        await save(salon, from, { serviceId: arg });
        return showStaff(salon, from, cat);
      }

      case 'STF': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        if (!sess.serviceId) return showServices(salon, from);
        sess.staffId = arg === 'ANY' || !cat.staff.some((s) => s.id === arg) ? null : arg;
        await save(salon, from, sess);
        return showDays(salon, from, sess, cat);
      }

      case 'DAY': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        if (!sess.serviceId) return showServices(salon, from);
        if (!isValidDate(arg)) return showDays(salon, from, sess, cat);
        sess.date = arg;
        await save(salon, from, sess);
        return showTimes(salon, from, sess, cat, null);
      }

      case 'PART': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        if (!sess.serviceId || !sess.date) return showServices(salon, from);
        return showTimes(salon, from, sess, cat, PART_LABEL[arg] ? arg : null);
      }

      case 'TIME': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        if (!sess.serviceId || !sess.date) return showServices(salon, from);
        if (!isValidTime(arg)) return showTimes(salon, from, sess, cat, null);
        const slots = await slotsFor(salon, sess, sess.date, cat);
        if (!slots) return showServices(salon, from);
        const slot = slots.find((s) => s.time === arg);
        if (!slot) {
          await wa.text(from, 'Sorry, that time was just taken.');
          return showTimes(salon, from, sess, cat, null);
        }
        sess.time = arg;
        sess.resolvedStaffId = slot.staffId;
        await save(salon, from, sess);
        return showSummary(salon, from, sess, cat);
      }

      case 'CHANGE': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        if (!sess.serviceId || !sess.date) return showServices(salon, from);
        return showTimes(salon, from, sess, cat, null);
      }

      case 'CONFIRM': {
        const cat = await catalogue(salon);
        const sess = await loadSession(salon, from);
        return confirm(salon, from, name, sess, cat);
      }

      case 'BKG':
        return showBooking(salon, from, arg);

      case 'CXL':
        return cancel(salon, from, arg);

      default:
        return showMenu(salon, from);
    }
  }

  return { handleIncoming };
}
