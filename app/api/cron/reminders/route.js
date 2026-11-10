// Sends appointment reminders. Call this every 15 minutes (see README: cron-job.org),
// with header  Authorization: Bearer <CRON_SECRET>   or  ?key=<CRON_SECRET>
import { db } from '../../../../lib/db.js';
import { createWhatsApp } from '../../../../lib/whatsapp.js';
import { pickReminder, reminderParams } from '../../../../lib/reminders.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const key = new URL(req.url).searchParams.get('key');
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const candidates = await db.getReminderCandidates(now);
  const template = process.env.WA_REMINDER_TEMPLATE || 'booking_reminder';
  const lang = process.env.WA_TEMPLATE_LANG || 'en';
  let sent = 0, failed = 0;

  for (const b of candidates) {
    const which = pickReminder(b, now);
    if (!which) continue;
    const wa = createWhatsApp({
      token: process.env.WA_TOKEN,
      phoneNumberId: b.wa_phone_number_id,
      version: process.env.WA_GRAPH_VERSION || 'v23.0',
      onSent: (to, text, id) => db.logOutgoing({ salonId: b.salon_id, phone: to, msgId: id, body: text }),
    });
    try {
      await wa.template(b.customer_phone, template, lang, reminderParams(b));
      await db.markReminderSent(b.id, which);
      sent++;
    } catch (err) {
      failed++;
      console.error('Reminder failed for booking', b.id, err.message);
    }
  }
  return Response.json({ checked: candidates.length, sent, failed });
}
