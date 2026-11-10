import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../lib/bot.js';
import { makeFakeDb, makeFakeWa } from './fakes.js';

// Freeze "now" at Mon 9 Nov 2026, 9:00 AM IST
const NOW = new Date('2026-11-09T09:00:00+05:30');
const PHONE = '919800000001';

function setup() {
  const db = makeFakeDb();
  const wa = makeFakeWa();
  const bot = createBot({ db, wa, now: () => NOW });
  let n = 0;
  const say = (text) => bot.handleIncoming({ salon: db.salon, from: PHONE, name: 'Meena R', msgId: `m${++n}`, type: 'text', text });
  const tap = (replyId, phone = PHONE) => bot.handleIncoming({ salon: db.salon, from: phone, name: 'Meena R', msgId: `m${++n}`, type: 'interactive', text: '', replyId });
  return { db, wa, bot, say, tap };
}

test('full booking: hi → service → anyone → tomorrow → afternoon → time → confirm', async () => {
  const { db, wa, say, tap } = setup();

  await say('hi');
  assert.equal(wa.last().kind, 'buttons');
  assert.match(wa.last().body, /Hi Meena!/);
  assert.deepEqual(wa.last().options.map((o) => o.id), ['MENU_BOOK', 'MENU_MINE', 'MENU_TALK']);

  await tap('MENU_BOOK');
  assert.equal(wa.last().kind, 'list');
  assert.deepEqual(wa.last().options.map((o) => o.id), ['SVC_sv-cut', 'SVC_sv-colour']);

  await tap('SVC_sv-cut');
  assert.equal(wa.last().options[0].id, 'STF_ANY');

  await tap('STF_ANY');
  const days = wa.last().options;
  assert.equal(days[0].id, 'DAY_2026-11-09');
  assert.equal(days[0].title, 'Today');
  assert.equal(days[1].title, 'Tomorrow');
  assert.equal(days.length, 7);

  await tap('DAY_2026-11-10');
  // 10:00–20:00 in 30-min steps = 20 slots → too many for one list, so ask part of day
  assert.equal(wa.last().kind, 'buttons');
  assert.deepEqual(wa.last().options.map((o) => o.id), ['PART_M', 'PART_A', 'PART_E']);

  await tap('PART_A');
  assert.equal(wa.last().kind, 'list');
  assert.equal(wa.last().options[0].id, 'TIME_12:00');
  assert.equal(wa.last().options[0].title, '12:00 PM');
  assert.equal(wa.last().options.length, 10);

  await tap('TIME_15:30');
  assert.match(wa.last().body, /Haircut/);
  assert.match(wa.last().body, /Tue, 10 Nov at 3:30 PM/);
  assert.match(wa.last().body, /₹350/);

  await tap('CONFIRM');
  assert.equal(wa.last().kind, 'text');
  assert.match(wa.last().body, /confirmed/);
  assert.match(wa.last().body, /Ref: \*B1001\*/);
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].start_at, new Date('2026-11-10T15:30:00+05:30').toISOString());
  assert.equal(db.bookings[0].customer_name, 'Meena R');
  assert.equal(db.sessions.has(PHONE), false, 'session cleared after booking');
});

test('today only offers times at least 30 min from now', async () => {
  const { wa, tap } = setup();
  await tap('SVC_sv-cut');
  await tap('STF_ANY');
  await tap('DAY_2026-11-09'); // now is 9:00, salon opens 10:00 → all 20 slots
  await tap('PART_M');
  assert.equal(wa.last().options[0].id, 'TIME_10:00');
});

test('"Anyone" moves to the next stylist when the first is busy', async () => {
  const { db, wa, tap } = setup();
  db.bookings.push({ id: 'x', staff_id: 'st-priya', start_at: new Date('2026-11-10T15:30:00+05:30').toISOString(), end_at: new Date('2026-11-10T16:00:00+05:30').toISOString(), status: 'confirmed', customer_phone: 'other', service_id: 'sv-cut' });
  await tap('SVC_sv-cut');
  await tap('STF_ANY');
  await tap('DAY_2026-11-10');
  await tap('PART_A');
  const row = wa.last().options.find((o) => o.id === 'TIME_15:30');
  assert.equal(row.description, 'with Arun');
});

test('specific stylist: busy time is not offered', async () => {
  const { db, wa, tap } = setup();
  db.bookings.push({ id: 'x', staff_id: 'st-priya', start_at: new Date('2026-11-10T15:30:00+05:30').toISOString(), end_at: new Date('2026-11-10T16:00:00+05:30').toISOString(), status: 'confirmed', customer_phone: 'other', service_id: 'sv-cut' });
  await tap('SVC_sv-cut');
  await tap('STF_st-priya');
  await tap('DAY_2026-11-10');
  await tap('PART_A');
  assert.ok(!wa.last().options.some((o) => o.id === 'TIME_15:30'));
});

test('long service does not run past closing', async () => {
  const { wa, tap } = setup();
  await tap('SVC_sv-colour'); // 2 hours
  await tap('STF_st-priya');
  await tap('DAY_2026-11-10');
  await tap('PART_E');
  const ids = wa.last().options.map((o) => o.id);
  assert.deepEqual(ids, ['TIME_17:00', 'TIME_17:30', 'TIME_18:00']); // 18:00 + 2h = 20:00 close
});

test('two customers race for the same slot: second one is told and shown times again', async () => {
  const { db, wa, tap } = setup();
  for (const phone of ['A', 'B']) {
    await tap('SVC_sv-cut', phone);
    await tap('STF_st-priya', phone);
    await tap('DAY_2026-11-10', phone);
    await tap('PART_A', phone);
    await tap('TIME_15:30', phone);
  }
  await tap('CONFIRM', 'A');
  await tap('CONFIRM', 'B');
  assert.equal(db.bookings.filter((b) => b.status === 'confirmed').length, 1);
  const toB = wa.sent.filter((m) => m.to === 'B');
  assert.match(toB[toB.length - 2].body, /just taken/);
});

test('my bookings → cancel frees the slot', async () => {
  const { db, wa, tap, say } = setup();
  await tap('SVC_sv-cut');
  await tap('STF_st-priya');
  await tap('DAY_2026-11-10');
  await tap('PART_A');
  await tap('TIME_15:30');
  await tap('CONFIRM');
  const id = db.bookings[0].id;

  await say('my bookings');
  assert.equal(wa.last().kind, 'list');
  assert.equal(wa.last().options[0].id, `BKG_${id}`);
  assert.equal(wa.last().options[0].title, 'Tue, 10 Nov 3:30 PM');

  await tap(`BKG_${id}`);
  assert.equal(wa.last().options[0].id, `CXL_${id}`);

  await tap(`CXL_${id}`);
  assert.equal(db.bookings[0].status, 'cancelled');
  assert.match(wa.last().body, /cancelled/);

  // slot is offered again
  await tap('SVC_sv-cut');
  await tap('STF_st-priya');
  await tap('DAY_2026-11-10');
  await tap('PART_A');
  assert.ok(wa.last().options.some((o) => o.id === 'TIME_15:30'));
});

test("can't cancel someone else's booking", async () => {
  const { db, tap } = setup();
  db.bookings.push({ id: '11111111-1111-1111-1111-111111111111', staff_id: 'st-priya', start_at: new Date('2026-11-10T15:30:00+05:30').toISOString(), end_at: new Date('2026-11-10T16:00:00+05:30').toISOString(), status: 'confirmed', customer_phone: 'someone-else', service_id: 'sv-cut' });
  await tap('CXL_11111111-1111-1111-1111-111111111111');
  assert.equal(db.bookings[0].status, 'confirmed');
});

test('talk to salon creates a call-back request', async () => {
  const { db, wa, tap } = setup();
  await tap('MENU_TALK');
  assert.equal(db.handoffs.length, 1);
  assert.match(wa.last().body, /call you back/);
});

test('WhatsApp retry of the same message is ignored', async () => {
  const { db, wa } = setup();
  const bot = createBot({ db, wa, now: () => NOW });
  const msg = { salon: db.salon, from: PHONE, name: null, msgId: 'dup', type: 'text', text: 'hi' };
  await bot.handleIncoming(msg);
  await bot.handleIncoming(msg);
  assert.equal(wa.sent.length, 1);
});

test('tapping an old button after the session expired starts over safely', async () => {
  const { wa, tap } = setup();
  await tap('CONFIRM'); // no session
  assert.match(wa.last().body, /start again/);
  await tap('TIME_15:30');
  assert.equal(wa.last().kind, 'list'); // back to services
});

test('closed day and staff day off are skipped', async () => {
  const { db, wa, tap } = setup();
  db.salon.closed_days = [3]; // Wednesday
  db.staff[0].off_days = [2]; // Priya off Tuesday
  await tap('SVC_sv-cut');
  await tap('STF_st-priya');
  const ids = wa.last().options.map((o) => o.id);
  assert.ok(!ids.includes('DAY_2026-11-10'), 'Tue skipped for Priya');
  assert.ok(!ids.includes('DAY_2026-11-11'), 'Wed skipped (salon closed)');
});
