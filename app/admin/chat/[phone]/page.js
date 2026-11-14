import { requireAdmin } from '../../../../lib/requireAdmin.js';
import { db } from '../../../../lib/db.js';
import { utcToIst, fmtDate, fmtTime } from '../../../../lib/time.js';

export const metadata = { title: 'Chat history' };

export default async function ChatPage({ params, searchParams }) {
  await requireAdmin();
  const { phone } = await params;
  const sp = await searchParams;
  const salons = await db.getSalons();
  const salonId = sp.salon && salons.some((s) => s.id === sp.salon) ? sp.salon : salons[0]?.id;
  if (!salonId) return <main style={{ padding: 40 }}>No salon found.</main>;

  const decodedPhone = decodeURIComponent(phone);
  const messages = await db.getMessagesForCustomer(salonId, decodedPhone, 300);

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
      <a href={`/admin?salon=${salonId}`} style={{ fontSize: 13, color: '#7A7D74', textDecoration: 'none' }}>← Back</a>
      <h1 style={{ fontSize: 20, margin: '10px 0 20px' }}>{decodedPhone}</h1>

      {messages.length === 0 ? (
        <p style={{ color: '#7A7D74' }}>No messages found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m) => {
            const { date, time } = utcToIst(m.created_at);
            const out = m.direction === 'out';
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '75%',
                    background: out ? '#DCF2CE' : '#fff',
                    border: out ? 'none' : '1px solid #E4E6DF',
                    borderRadius: 12,
                    padding: '8px 12px',
                    fontSize: 14,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <div>{m.body}</div>
                  <div style={{ fontSize: 11, color: '#7A7D74', marginTop: 4, textAlign: 'right' }}>
                    {fmtDate(date)} · {fmtTime(time)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
