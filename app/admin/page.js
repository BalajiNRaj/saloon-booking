import { cookies } from 'next/headers';
import Link from 'next/link';
import { ADMIN_COOKIE, verifySession } from '../../lib/adminAuth.js';
import { db } from '../../lib/db.js';
import { utcToIst, istToUtc, fmtDate, fmtTime, todayIst, addDays, toMin } from '../../lib/time.js';
import { cancelBookingAction, setStatusAction, resolveHandoffAction, logoutAction } from '../../lib/adminActions.js';
import LoginForm from './LoginForm.js';

export const metadata = { title: 'Admin' };

const ACCENT = '#0F766E';
const ACCENT_DARK = '#0B5D55';

const STATUS = {
  confirmed: { label: 'Confirmed', bg: '#E6F4F1', fg: '#0B5D55', bar: '#0F766E' },
  pending: { label: 'Awaiting payment', bg: '#FDF3E2', fg: '#7A4206', bar: '#D97706' },
  noshow: { label: 'No-show', bg: '#FBE9E9', fg: '#991B1B', bar: '#DC2626' },
  cancelled: { label: 'Cancelled', bg: '#EEEFF1', fg: '#3F4451', bar: '#9AA0AA' },
  completed: { label: 'Completed', bg: '#E3E6EC', fg: '#394150', bar: '#6B7280' },
};
const SOURCE_LABEL = { ai: 'WhatsApp AI', walkin: 'Walk-in', phone: 'Phone call' };

const ICONS = {
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  bookings: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z',
  talk: 'M12 22s8-4.5 8-11.8A8 8 0 0 0 4 10.2C4 17.5 12 22 12 22z',
};
const HOUR_PX = 64;

function Icon({ path, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function rupees(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
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
  const activeTab = ['bookings', 'chat', 'talk'].includes(sp.tab) ? sp.tab : 'calendar';
  const today = todayIst();
  const dayIso = /^\d{4}-\d{2}-\d{2}$/.test(sp.day || '') ? sp.day : today;
  const filter = sp.filter || 'all';
  const q = (sp.q || '').trim();
  const selPhone = sp.phone || null;

  const qs = (overrides) => {
    const base = { salon: salonId, tab: activeTab, day: dayIso };
    if (filter !== 'all') base.filter = filter;
    if (q) base.q = q;
    if (selPhone) base.phone = selPhone;
    const merged = { ...base, ...overrides };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    }
    return `/admin?${p.toString()}`;
  };

  const fromUtc = istToUtc(dayIso, '00:00');
  const toUtc = istToUtc(addDays(dayIso, 1), '00:00');
  const [dayBookings, staff, handoffs] = await Promise.all([
    db.getAdminBookings(salonId, { fromUtc, toUtc, limit: 300 }),
    db.getStaff(salonId),
    db.getHandoffRequests(salonId, { onlyOpen: true }),
  ]);

  const items = dayBookings
    .map((b) => {
      const st = STATUS[b.status] || STATUS.completed;
      const { time: startTime } = utcToIst(b.start_at);
      const { time: endTime } = utcToIst(b.end_at);
      return { ...b, st, startMin: toMin(startTime), endMin: toMin(endTime) };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const active = items.filter((i) => i.status !== 'cancelled');
  const aiCount = active.filter((i) => i.source === 'ai').length;
  const revenue = items.filter((i) => i.status === 'confirmed').reduce((sum, i) => sum + Number(i.price || 0), 0);
  const noShows = items.filter((i) => i.status === 'noshow').length;
  const pending = items.filter((i) => i.status === 'pending').length;
  const cancelled = items.length - active.length;
  const isToday = dayIso === today;

  const stats = [
    { label: 'Bookings', value: String(active.length), note: `${cancelled} cancelled` },
    { label: 'Booked by AI agent', value: `${aiCount} of ${active.length}`, note: 'through WhatsApp' },
    { label: 'Expected revenue', value: rupees(revenue), note: `${pending} awaiting advance payment` },
    { label: 'No-shows', value: String(noShows), note: isToday ? 'so far today' : 'for this day' },
  ];

  const navDefs = [
    { key: 'calendar', label: 'Calendar', icon: ICONS.calendar },
    { key: 'bookings', label: 'Bookings', icon: ICONS.bookings },
    { key: 'chat', label: 'Chat history', icon: ICONS.chat },
    { key: 'talk', label: `Talk requests${handoffs.length ? ` (${handoffs.length})` : ''}`, icon: ICONS.talk },
  ];

  const titles = { calendar: 'Calendar', bookings: 'Bookings', chat: 'Chat history', talk: 'Talk requests' };
  const subs = {
    calendar: 'Every booking the AI agent and your staff have made, by stylist.',
    bookings: 'Full list for the day. Filter by status or search a customer.',
    chat: 'What customers said to the AI agent on WhatsApp.',
    talk: 'Customers who asked to speak with a person.',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', background: '#F6F7F5', color: '#16181D', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet" />

      <aside style={{ flex: '1 1 220px', maxWidth: '100%', boxSizing: 'border-box', background: '#FFFFFF', borderRight: '1px solid #E3E5E8', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 600 }}>{salon.name}</div>
          <div style={{ fontSize: 12, color: '#5B6170' }}>Admin</div>
        </div>

        {salons.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px' }}>
            {salons.map((s) => (
              <Link key={s.id} href={qs({ salon: s.id })} style={{ fontSize: 13, textDecoration: 'none', color: s.id === salonId ? ACCENT_DARK : '#5B6170', fontWeight: s.id === salonId ? 600 : 400 }}>
                {s.name}
              </Link>
            ))}
          </div>
        )}

        <nav aria-label="Sections" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navDefs.map((n) => {
            const on = activeTab === n.key;
            return (
              <Link
                key={n.key}
                href={qs({ tab: n.key, filter: undefined, q: undefined, phone: undefined })}
                prefetch
                style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 12px', borderRadius: 8, textDecoration: 'none', fontSize: 14, background: on ? ACCENT : 'transparent', color: on ? '#FFFFFF' : '#3A3F4A', fontWeight: on ? 600 : 500 }}
              >
                <Icon path={n.icon} />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', border: '1px solid #E3E5E8', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} aria-hidden="true" />
            AI agent online
          </div>
          <div style={{ fontSize: 12, color: '#5B6170', lineHeight: 1.4 }}>Answering customers on WhatsApp</div>
          <form action={logoutAction} style={{ marginTop: 4 }}>
            <button type="submit" style={{ fontSize: 12, color: '#5B6170', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: '999 1 560px', minWidth: 0, boxSizing: 'border-box', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ margin: 0, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 28, fontWeight: 600 }}>{titles[activeTab]}</h1>
            <div style={{ color: '#5B6170' }}>{subs[activeTab]}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 10, padding: 4 }}>
            <Link href={qs({ day: addDays(dayIso, -1) })} prefetch aria-label="Previous day" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: '#16181D', textDecoration: 'none' }}>
              <Icon path="M15 18l-6-6 6-6" />
            </Link>
            <div style={{ minWidth: 130, textAlign: 'center', fontWeight: 600 }}>{isToday ? 'Today' : fmtDate(dayIso)}</div>
            <Link href={qs({ day: addDays(dayIso, 1) })} prefetch aria-label="Next day" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: '#16181D', textDecoration: 'none' }}>
              <Icon path="M9 18l6-6 6-6" />
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
          {stats.map((st) => (
            <div key={st.label} style={{ background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, color: '#5B6170' }}>{st.label}</div>
              <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 26, fontWeight: 600 }}>{st.value}</div>
              <div style={{ fontSize: 12, color: '#5B6170' }}>{st.note}</div>
            </div>
          ))}
        </div>

        {activeTab === 'calendar' && <CalendarView items={items} staff={staff} salon={salon} qs={qs} />}
        {activeTab === 'bookings' && <BookingsView items={items} filter={filter} q={q} qs={qs} salonId={salonId} dayIso={dayIso} />}
        {activeTab === 'chat' && <ChatView items={items} selPhone={selPhone} dayIso={dayIso} isToday={isToday} qs={qs} salonId={salonId} />}
        {activeTab === 'talk' && <TalkView handoffs={handoffs} salonId={salonId} />}
      </main>
    </div>
  );
}

function CalendarView({ items, staff, salon, qs }) {
  if (staff.length === 0) return <Card>No stylists set up yet.</Card>;
  const openMin = salon.open_time ? toMin(salon.open_time) : 9 * 60;
  const closeMin = salon.close_time ? toMin(salon.close_time) : 21 * 60;
  const startHour = Math.floor(openMin / 60);
  const endHour = Math.ceil(closeMin / 60);
  const totalH = Math.max(endHour - startHour, 1);
  const gridHeight = totalH * HOUR_PX;

  const hours = [];
  for (let h = startHour; h < endHour; h++) {
    const hh = h % 12 === 0 ? 12 : h % 12;
    hours.push({ label: `${hh} ${h >= 12 ? 'PM' : 'AM'}`, top: (h - startHour) * HOUR_PX });
  }

  const staffCols = staff.map((s) => {
    const mine = items.filter((i) => i.staff_id === s.id);
    const count = mine.filter((i) => i.status !== 'cancelled').length;
    return { ...s, items: mine, countLabel: `${count} ${count === 1 ? 'booking' : 'bookings'}` };
  });
  const unassigned = items.filter((i) => !i.staff_id);
  if (unassigned.length > 0) {
    const count = unassigned.filter((i) => i.status !== 'cancelled').length;
    staffCols.push({ id: 'unassigned', name: 'Unassigned', items: unassigned, countLabel: `${count} ${count === 1 ? 'booking' : 'bookings'}` });
  }

  const legend = ['confirmed', 'pending', 'completed', 'noshow', 'cancelled'];

  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Day schedule by stylist</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#3A3F4A' }}>
          {legend.map((k) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS[k].bar, display: 'inline-block' }} aria-hidden="true" />
              {STATUS[k].label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `72px repeat(${staffCols.length}, minmax(0, 1fr))`, borderBottom: '1px solid #E3E5E8' }}>
            <div />
            {staffCols.map((col) => (
              <div key={col.id} style={{ padding: '10px 8px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{col.name}</span>
                <span style={{ fontSize: 12, color: '#5B6170' }}>{col.countLabel}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `72px repeat(${staffCols.length}, minmax(0, 1fr))` }}>
            <div style={{ position: 'relative', height: gridHeight }}>
              {hours.map((hr) => (
                <div key={hr.label + hr.top} style={{ position: 'absolute', left: 0, top: hr.top, fontSize: 11, color: '#5B6170', paddingTop: 2 }}>{hr.label}</div>
              ))}
            </div>
            {staffCols.map((col) => (
              <div key={col.id} style={{ position: 'relative', height: gridHeight, borderLeft: '1px solid #EEF0F2', background: `repeating-linear-gradient(to bottom, #EEF0F2 0px, #EEF0F2 1px, transparent 1px, transparent ${HOUR_PX}px)` }}>
                {col.items.map((b) => {
                  const top = (b.startMin - startHour * 60) / 60 * HOUR_PX + 2;
                  const h = Math.max((b.endMin - b.startMin) / 60 * HOUR_PX - 4, 24);
                  return (
                    <Link key={b.id} href={qs({ tab: 'chat', phone: b.customer_phone })} aria-label={`${b.customer_name || b.customer_phone}, ${b.service_name}, ${b.st.label}. Open chat`}
                       style={{ position: 'absolute', left: 4, right: 4, top, height: h, boxSizing: 'border-box', overflow: 'hidden', textAlign: 'left', cursor: 'pointer', border: 0, borderLeft: `4px solid ${b.st.bar}`, borderRadius: 6, background: b.st.bg, color: b.st.fg, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, lineHeight: 1.3, textDecoration: 'none' }}>
                      <span style={{ fontWeight: 600, textDecoration: b.status === 'cancelled' ? 'line-through' : 'none' }}>{b.customer_name || b.customer_phone}</span>
                      <span>{b.service_name}</span>
                      <span>{fmtTime(toMinLabel(b.startMin))} – {fmtTime(toMinLabel(b.endMin))}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#5B6170' }}>Tap a booking to open its WhatsApp chat.</div>
    </section>
  );
}

function toMinLabel(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function BookingsView({ items, filter, q, qs, salonId, dayIso }) {
  const filterDefs = [
    { key: 'all', label: 'All' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'pending', label: 'Awaiting payment' },
    { key: 'noshow', label: 'No-show' },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'completed', label: 'Completed' },
  ];
  const ql = q.toLowerCase();
  const rows = items.filter((i) => {
    if (filter !== 'all' && i.status !== filter) return false;
    if (ql && !(i.customer_name || '').toLowerCase().includes(ql) && !String(i.ref_no).toLowerCase().includes(ql) && !(i.customer_phone || '').includes(ql)) return false;
    return true;
  });

  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Filter by status">
          {filterDefs.map((f) => {
            const on = filter === f.key;
            return (
              <Link key={f.key} href={qs({ filter: f.key === 'all' ? undefined : f.key })} prefetch style={{ minHeight: 36, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, border: `1px solid ${on ? ACCENT : '#C9CDD3'}`, background: on ? ACCENT : '#FFFFFF', color: on ? '#FFFFFF' : '#16181D', fontWeight: on ? 600 : 400, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                {f.label}
              </Link>
            );
          })}
        </div>
        <form method="GET" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input type="hidden" name="salon" value={salonId} />
          <input type="hidden" name="tab" value="bookings" />
          <input type="hidden" name="day" value={dayIso} />
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="search" style={{ fontSize: 12, color: '#5B6170' }}>Search customer</label>
          <input id="search" name="q" type="search" defaultValue={q} placeholder="Name, phone or booking #" style={{ height: 40, width: 220, boxSizing: 'border-box', padding: '0 12px', border: '1px solid #C9CDD3', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }} />
        </form>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#5B6170', borderBottom: '1px solid #E3E5E8' }}>
              {['Ref', 'Customer', 'Service', 'Stylist', 'Time', 'Amount', 'Booked via', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #EEF0F2' }}>
                <td style={{ padding: '12px 8px', color: '#5B6170' }}>B{r.ref_no}</td>
                <td style={{ padding: '12px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{r.customer_name || r.customer_phone}</div>
                  <div style={{ fontSize: 12, color: '#5B6170' }}>{r.customer_phone}</div>
                </td>
                <td style={{ padding: '12px 8px' }}>{r.service_name}</td>
                <td style={{ padding: '12px 8px', color: r.staff_name ? 'inherit' : '#9AA0AA' }}>{r.staff_name || 'Unassigned'}</td>
                <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>{fmtTime(toMinLabel(r.startMin))} – {fmtTime(toMinLabel(r.endMin))}</td>
                <td style={{ padding: '12px 8px' }}>{rupees(r.price)}</td>
                <td style={{ padding: '12px 8px' }}>{SOURCE_LABEL[r.source] || r.source || '—'}</td>
                <td style={{ padding: '12px 8px' }}>
                  <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: r.st.bg, color: r.st.fg }}>{r.st.label}</span>
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Link href={qs({ tab: 'chat', phone: r.customer_phone })} style={actionBtn}>Chat</Link>
                    {r.status === 'confirmed' && (
                      <>
                        <form action={cancelBookingAction}>
                          <input type="hidden" name="salonId" value={salonId} />
                          <input type="hidden" name="bookingId" value={r.id} />
                          <button type="submit" style={actionBtn}>Cancel</button>
                        </form>
                        <form action={setStatusAction}>
                          <input type="hidden" name="salonId" value={salonId} />
                          <input type="hidden" name="bookingId" value={r.id} />
                          <input type="hidden" name="status" value="noshow" />
                          <button type="submit" style={actionBtn}>No-show</button>
                        </form>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#5B6170' }}>No bookings match this filter.</div>}
      </div>
    </section>
  );
}

const actionBtn = {
  fontSize: 12,
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid #C9CDD3',
  background: '#fff',
  cursor: 'pointer',
  color: '#16181D',
  textDecoration: 'none',
  fontFamily: 'inherit',
};

async function ChatView({ items, selPhone, dayIso, isToday, qs, salonId }) {
  const withChat = items.filter((i) => i.customer_phone);
  const sel = withChat.find((i) => i.customer_phone === selPhone) || withChat[0] || null;
  const messages = sel ? await db.getMessagesForCustomer(salonId, sel.customer_phone, 300) : [];

  return (
    <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0, background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: '8px 8px 4px', fontSize: 14, fontWeight: 600 }}>Conversations · {isToday ? 'Today' : fmtDate(dayIso)}</h2>
        {withChat.length === 0 && <div style={{ padding: 16, color: '#5B6170', fontSize: 13 }}>No bookings on this day.</div>}
        {withChat.map((cv) => (
          <Link key={cv.id} href={qs({ phone: cv.customer_phone })} style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', background: sel && sel.id === cv.id ? '#EEF6F4' : 'transparent', color: '#16181D', textDecoration: 'none' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
              <span style={{ fontWeight: 600 }}>{cv.customer_name || cv.customer_phone}</span>
              <span style={{ fontSize: 12, color: '#5B6170' }}>{fmtTime(toMinLabel(cv.startMin))}</span>
            </span>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', fontSize: 12 }}>
              <span style={{ color: '#3A3F4A' }}>{cv.service_name}</span>
              <span style={{ color: cv.st.fg, fontWeight: 500 }}>{cv.st.label}</span>
            </span>
            <span style={{ fontSize: 11, color: '#5B6170' }}>{SOURCE_LABEL[cv.source] || cv.source}</span>
          </Link>
        ))}
      </div>
      <div style={{ flex: '999 1 380px', minWidth: 0, background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, display: 'flex', flexDirection: 'column' }}>
        {sel ? (
          <>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E3E5E8', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{sel.customer_name || sel.customer_phone}</div>
                <div style={{ fontSize: 12, color: '#5B6170' }}>{sel.customer_phone} · B{sel.ref_no} · {sel.service_name}{sel.staff_name ? ` with ${sel.staff_name}` : ' · no stylist assigned yet'}</div>
              </div>
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: sel.st.bg, color: sel.st.fg }}>{sel.st.label}</span>
            </div>
            <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 10, background: '#F9FAF8' }}>
              {messages.length === 0 && (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#5B6170', padding: '40px 0' }}>
                  Booked by staff ({SOURCE_LABEL[sel.source] || sel.source}). No WhatsApp chat for this booking.
                </div>
              )}
              {messages.map((m) => {
                const out = m.direction === 'out';
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '78%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: out ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: out ? '#E3F2EF' : '#FFFFFF', border: out ? '1px solid #CBE6E0' : '1px solid #E3E5E8', color: out ? '#10302C' : '#16181D', fontSize: 14, lineHeight: 1.45 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#5B6170', marginBottom: 2 }}>{out ? 'AI agent' : 'Customer'}</div>
                      <div>{m.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #E3E5E8', fontSize: 12, color: '#5B6170' }}>Read-only history. The AI agent handles replies; staff take-over can come in version 2.</div>
          </>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: '#5B6170' }}>No bookings on this day.</div>
        )}
      </div>
    </section>
  );
}

function TalkView({ handoffs, salonId }) {
  if (handoffs.length === 0) return <Card>No open &ldquo;talk to someone&rdquo; requests.</Card>;
  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#5B6170', background: '#F6F7F5', borderBottom: '1px solid #E3E5E8' }}>
            {['Customer', 'Phone', 'Requested', ''].map((h) => (
              <th key={h} style={{ padding: '10px 14px', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {handoffs.map((h) => {
            const { date, time } = utcToIst(h.created_at);
            return (
              <tr key={h.id} style={{ borderBottom: '1px solid #EEF0F2' }}>
                <td style={{ padding: '12px 14px' }}>{h.customer_name || '—'}</td>
                <td style={{ padding: '12px 14px' }}>{h.customer_phone}</td>
                <td style={{ padding: '12px 14px' }}>{fmtDate(date)} · {fmtTime(time)}</td>
                <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                  <form action={resolveHandoffAction}>
                    <input type="hidden" name="salonId" value={salonId} />
                    <input type="hidden" name="id" value={h.id} />
                    <button type="submit" style={actionBtn}>Mark resolved</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Card({ children }) {
  return <div style={{ background: '#FFFFFF', border: '1px solid #E3E5E8', borderRadius: 12, padding: 24, color: '#5B6170' }}>{children}</div>;
}
