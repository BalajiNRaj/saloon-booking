// Server-side guard for admin pages. Call at the top of every admin page.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifySession } from './adminAuth.js';

export async function requireAdmin() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!verifySession(token)) redirect('/admin');
}
