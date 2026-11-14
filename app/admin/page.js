import { cookies } from 'next/headers';
import { ADMIN_COOKIE, verifySession } from '../../lib/adminAuth.js';
import { db } from '../../lib/db.js';
import { utcToIst, fmtDate, fmtTime } from '../../lib/time.js';
import { cancelBookingAction, setStatusAction, resolveHandoffAction, logoutAction } from '../../lib/adminActions.js';
import LoginForm from './LoginForm.js';

export const metadata = { title: 'Admin' };

const statusColors = {
  confirmed: { bg: '#E6F1DB', fg: '#2F5E12' },
  pending: { bg: '#FBEFD9', fg: '#8A5A00' },
  cancelled: { bg: '#F1E3E3', fg: '#8A2E2E' },
  noshow: { bg: '#F1E3E3', fg: '#8A2E2E' },
  completed: { bg: '#E3E6EC', fg: '#394150' },
};

function Pill({ status }) {
  const c = statusColors[status] || statusColors.completed;
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function tab(active, href, label) {
  return (
    <a
      href={href}
      style={{
        padding: '7px 14px',
        borderRadius: 8,
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: 600,
        color: active ? '#fff' : '#16181D',
        background: active ? '#16181D' : 'transparent',
      }}
    >
      {label}
    </a>
  );
}

export default async function AdminPage({ searchParams }) {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!verifySession(token)) return <LoginForm />;

  const sp = await searchParams;
  const salons = await db.getSalons();
  if (salons.length === 0) {
    return <main style={{ padding: 40 }}>No salons set up yet.</main>;
  }
  const salonId = sp.salon && salons.some((s) => s.id === sp.salon) ? sp.salon : salons[0].id;
  const salon = salons.find((s) => s.id === salonId);
  const activeTab = sp.tab === 'customers' || sp.tab === 'handoffs' ? sp.tab : 'bookings';
  const qs = (overrides) => {
    const p = new URLSearchParams({ salon: salonId, tab: activeTab, ...overrides });
    return `/admin?${p.toString()}`;
  };

  const bookings = activeTab === 'bookings' ? await db.getAdminBookings(salonId, { limit: 150 }) : [];
  const customers = activeTab === 'customers' ? await db.getAdminCustomers(salonId, 100) : [];
  const handoffs = activeTab === 'handoffs' ? await db.getHandoffRequests(salonId, { onlyOpen: true }) : [];

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{salon.name}</h1>
          {salons.length > 1 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              {salons.map((s) => (
                <a
                  key={s.id}
                  href={qs({ salon: s.id })}
                  style={{ fontSize: 13, color: s.id === salonId ? '#16181D' : '#7A7D74', textDecoration: 'none', fontWeight: s.id === salonId ? 700 : 400 }}
                >
                  {s.name}
                </a>
              ))}
            </div>
          )}
        </div>
        <form action={logoutAction}>
          <button type="submit" style={{ fontSize: 13, color: '#7A7D74', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Sign out
          </button>
        </form>
      </div>

      <nav style={{ display: 'flex', gap: 6, marginBottom: 24, background: '#EEF0EA', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {tab(activeTab === 'bookings', qs({ tab: 'bookings' }), 'Bookings')}
        {tab(activeTab === 'customers', qs({ tab: 'customers' }), 'Customers')}
        {tab(activeTab === 'handoffs', qs({ tab: 'handoffs' }), `Talk requests${handoffs.length ? ` (${handoffs.length})` : ''}`)}
      </nav>

      {activeTab === 'bookings' && (
        <BookingsTable bookings={bookings} salonId={salonId} />
      )}
      {activeTab === 'customers' && <CustomersTable customers={customers} salonId={salonId} />}
      {activeTab === 'handoffs' && <HandoffsTable handoffs={handoffs} salonId={salonId} />}
    </main>
  );
}

function BookingsTable({ bookings, salonId }) {
  if (bookings.length === 0) return <p style={{ color: '#7A7D74' }}>No bookings yet.</p>;
  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E4E6DF' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#F6F7F5', textAlign: 'left' }}>
            {['Ref', 'When', 'Customer', 'Service', 'Staff', 'Price', 'Status', ''].map((h) => (
              <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 12, color: '#7A7D74', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const { date, time } = utcToIst(b.start_at);
            return (
              <tr key={b.id} style={{ borderTop: '1px solid #EEF0EA' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>B{b.ref_no}</td>
                <td style={{ padding: '10px 14px' }}>{fmtDate(date)} · {fmtTime(time)}</td>
                <td style={{ padding: '10px 14px' }}>
                  <a href={`/admin/chat/${encodeURIComponent(b.customer_phone)}?salon=${salonId}`} style={{ color: '#16181D', textDecoration: 'none' }}>
                    {b.customer_name || b.customer_phone}
                  </a>
                  <div style={{ fontSize: 12, color: '#7A7D74' }}>{b.customer_phone}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>{b.service_name}</td>
                <td style={{ padding: '10px 14px' }}>{b.staff_name}</td>
                <td style={{ padding: '10px 14px' }}>₹{b.price}</td>
                <td style={{ padding: '10px 14px' }}>
                  <Pill status={b.status} />
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {b.status === 'confirmed' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <form action={cancelBookingAction}>
                        <input type="hidden" name="salonId" value={salonId} />
                        <input type="hidden" name="bookingId" value={b.id} />
                        <button type="submit" style={rowBtnStyle}>Cancel</button>
                      </form>
                      <form action={setStatusAction}>
                        <input type="hidden" name="salonId" value={salonId} />
                        <input type="hidden" name="bookingId" value={b.id} />
                        <input type="hidden" name="status" value="noshow" />
                        <button type="submit" style={rowBtnStyle}>No-show</button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CustomersTable({ customers, salonId }) {
  if (customers.length === 0) return <p style={{ color: '#7A7D74' }}>No conversations yet.</p>;
  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E4E6DF' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#F6F7F5', textAlign: 'left' }}>
            {['Customer', 'Phone', 'Last active', ''].map((h) => (
              <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 12, color: '#7A7D74', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => {
            const { date, time } = utcToIst(c.lastActive);
            return (
              <tr key={c.phone} style={{ borderTop: '1px solid #EEF0EA' }}>
                <td style={{ padding: '10px 14px' }}>{c.name || '—'}</td>
                <td style={{ padding: '10px 14px' }}>{c.phone}</td>
                <td style={{ padding: '10px 14px' }}>{fmtDate(date)} · {fmtTime(time)}</td>
                <td style={{ padding: '10px 14px' }}>
                  <a href={`/admin/chat/${encodeURIComponent(c.phone)}?salon=${salonId}`} style={{ color: '#16181D', fontWeight: 600, fontSize: 13 }}>
                    View chat →
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HandoffsTable({ handoffs, salonId }) {
  if (handoffs.length === 0) return <p style={{ color: '#7A7D74' }}>No open "talk to someone" requests.</p>;
  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #E4E6DF' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#F6F7F5', textAlign: 'left' }}>
            {['Customer', 'Phone', 'Requested', ''].map((h) => (
              <th key={h} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 12, color: '#7A7D74', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {handoffs.map((h) => {
            const { date, time } = utcToIst(h.created_at);
            return (
              <tr key={h.id} style={{ borderTop: '1px solid #EEF0EA' }}>
                <td style={{ padding: '10px 14px' }}>{h.customer_name || '—'}</td>
                <td style={{ padding: '10px 14px' }}>{h.customer_phone}</td>
                <td style={{ padding: '10px 14px' }}>{fmtDate(date)} · {fmtTime(time)}</td>
                <td style={{ padding: '10px 14px' }}>
                  <form action={resolveHandoffAction}>
                    <input type="hidden" name="salonId" value={salonId} />
                    <input type="hidden" name="id" value={h.id} />
                    <button type="submit" style={rowBtnStyle}>Mark resolved</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const rowBtnStyle = {
  fontSize: 12,
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid #D4D7D0',
  background: '#fff',
  cursor: 'pointer',
};
