// Thin client for the WhatsApp Cloud API (Meta). Docs: developers.facebook.com/docs/whatsapp/cloud-api

// WhatsApp limits (messages are rejected if exceeded)
const LIMITS = { buttonTitle: 20, rowTitle: 24, rowDesc: 72, listButton: 20, sectionTitle: 24, body: 1024 };
const cut = (s, n) => {
  s = String(s ?? '');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
};

export function createWhatsApp({ token, phoneNumberId, version = 'v23.0', onSent, fetchImpl = fetch }) {
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  async function post(payload, logText) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      throw new Error(`WhatsApp send failed (${res.status}): ${msg}`);
    }
    const id = data?.messages?.[0]?.id;
    if (onSent) await onSent(payload.to, logText, id);
    return id;
  }

  return {
    text(to, body) {
      return post({ to, type: 'text', text: { body: cut(body, 4096) } }, body);
    },

    /** Up to 3 reply buttons: [{ id, title }] */
    buttons(to, body, buttons) {
      const btns = buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, LIMITS.buttonTitle) } }));
      return post(
        { to, type: 'interactive', interactive: { type: 'button', body: { text: cut(body, LIMITS.body) }, action: { buttons: btns } } },
        `${body}\n[${buttons.map((b) => b.title).join(' | ')}]`
      );
    },

    /** A tap-to-open list, max 10 rows: rows = [{ id, title, description? }] */
    list(to, body, buttonLabel, sectionTitle, rows) {
      const r = rows.slice(0, 10).map((x) => ({
        id: x.id,
        title: cut(x.title, LIMITS.rowTitle),
        ...(x.description ? { description: cut(x.description, LIMITS.rowDesc) } : {}),
      }));
      return post(
        {
          to,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: cut(body, LIMITS.body) },
            action: { button: cut(buttonLabel, LIMITS.listButton), sections: [{ title: cut(sectionTitle, LIMITS.sectionTitle), rows: r }] },
          },
        },
        `${body}\n[${buttonLabel}: ${rows.map((x) => x.title).join(' | ')}]`
      );
    },

    /** Pre-approved template (needed to message someone who hasn't written in the last 24 h, e.g. reminders). */
    template(to, name, lang, params) {
      return post(
        {
          to,
          type: 'template',
          template: {
            name,
            language: { code: lang },
            components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }],
          },
        },
        `[template ${name}] ${params.join(' | ')}`
      );
    },
  };
}

/** Pull the messages we care about out of a webhook body. */
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const item = { phoneNumberId, from: m.from, name: names[m.from] || null, msgId: m.id, type: m.type, text: null, replyId: null };
        if (m.type === 'text') item.text = m.text?.body || '';
        if (m.type === 'interactive') {
          item.replyId = m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || null;
          item.text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
        }
        if (m.type === 'button') { // tap on a template quick-reply button
          item.type = 'text';
          item.text = m.button?.text || '';
        }
        out.push(item);
      }
    }
  }
  return out;
}
