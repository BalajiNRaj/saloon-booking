import { redirect } from 'next/navigation';
import { db } from '../../../../lib/db.js';

// Chat is now a tab inside the main admin page (two-pane view). Old links to
// this per-phone route are redirected there so nothing that was bookmarked breaks.
export default async function ChatPageRedirect({ params, searchParams }) {
  const { phone } = await params;
  const sp = await searchParams;
  const salons = await db.getSalons();
  const salonId = sp.salon && salons.some((s) => s.id === sp.salon) ? sp.salon : salons[0]?.id;
  const p = new URLSearchParams({ tab: 'chat', phone: decodeURIComponent(phone) });
  if (salonId) p.set('salon', salonId);
  redirect(`/admin?${p.toString()}`);
}
