// WhatsApp webhook. In Meta → WhatsApp → Configuration, set the callback URL to
//   https://<your-app>.vercel.app/api/whatsapp
// and the verify token to the same value as WA_VERIFY_TOKEN.
import crypto from 'node:crypto';
import { db } from '../../../lib/db.js';
import { createWhatsApp, parseWebhook } from '../../../lib/whatsapp.js';
import { createBot } from '../../../lib/bot.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Meta calls this once to check the URL is yours.
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.WA_VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

function validSignature(raw, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return true; // allowed while testing; set WA_APP_SECRET before going live
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Bad signature', { status: 401 });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  for (const m of parseWebhook(body)) {
    try {
      const salon = await db.getSalonByPhoneNumberId(m.phoneNumberId);
      if (!salon) {
        console.warn('No salon set up for phone number ID', m.phoneNumberId);
        continue;
      }
      const wa = createWhatsApp({
        token: process.env.WA_TOKEN,
        phoneNumberId: m.phoneNumberId,
        version: process.env.WA_GRAPH_VERSION || 'v23.0',
        onSent: (to, text, id) => db.logOutgoing({ salonId: salon.id, phone: to, msgId: id, body: text }),
      });
      await createBot({ db, wa }).handleIncoming({ salon, ...m });
    } catch (err) {
      // Log and carry on: returning an error makes Meta retry the whole batch.
      console.error('Failed to handle message', m.msgId, err);
    }
  }
  return new Response('OK', { status: 200 });
}
