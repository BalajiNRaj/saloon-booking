import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReminder, reminderParams } from '../lib/reminders.js';
import { parseWebhook } from '../lib/whatsapp.js';

const H = 3600 * 1000;
const now = new Date('2026-11-09T12:00:00+05:30');
const at = (hoursFromNow) => new Date(now.getTime() + hoursFromNow * H).toISOString();

test('24h reminder for a booking made days ago', () => {
  assert.equal(pickReminder({ status: 'confirmed', start_at: at(23), created_at: at(-48) }, now), '24h');
});
test('no 24h reminder if booked only 10 hours ahead', () => {
  assert.equal(pickReminder({ status: 'confirmed', start_at: at(8), created_at: at(-2) }, now), null);
});
test('2h reminder', () => {
  assert.equal(pickReminder({ status: 'confirmed', start_at: at(1.5), created_at: at(-48), reminder_24h_sent_at: at(-22) }, now), '2h');
});
test('nothing twice, nothing for cancelled', () => {
  assert.equal(pickReminder({ status: 'confirmed', start_at: at(1.5), created_at: at(-48), reminder_2h_sent_at: at(-0.1) }, now), null);
  assert.equal(pickReminder({ status: 'cancelled', start_at: at(1.5), created_at: at(-48) }, now), null);
});
test('reminder text parameters', () => {
  const p = reminderParams({ customer_name: 'Meena R', service_name: 'Haircut', start_at: '2026-11-10T10:00:00Z', salon_name: 'Demo Salon' });
  assert.deepEqual(p, ['Meena', 'Haircut', 'Tue, 10 Nov', '3:30 PM', 'Demo Salon']);
});

test('parses text and button/list replies from a webhook', () => {
  const body = {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'PNID' },
      contacts: [{ wa_id: '9198', profile: { name: 'Meena' } }],
      messages: [
        { from: '9198', id: 'a', type: 'text', text: { body: 'hi' } },
        { from: '9198', id: 'b', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'SVC_x', title: 'Haircut' } } },
        { from: '9198', id: 'c', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'CONFIRM', title: 'Confirm' } } },
      ],
    } }] }],
  };
  const m = parseWebhook(body);
  assert.equal(m.length, 3);
  assert.deepEqual([m[0].type, m[0].text, m[0].name, m[0].phoneNumberId], ['text', 'hi', 'Meena', 'PNID']);
  assert.equal(m[1].replyId, 'SVC_x');
  assert.equal(m[2].replyId, 'CONFIRM');
});

test('status-only webhooks produce no messages', () => {
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] }), []);
});
