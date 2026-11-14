'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from './db.js';
import { requireAdmin } from './requireAdmin.js';
import { ADMIN_COOKIE } from './adminAuth.js';

export async function cancelBookingAction(formData) {
  await requireAdmin();
  const salonId = formData.get('salonId');
  const bookingId = formData.get('bookingId');
  await db.adminCancelBooking(salonId, bookingId);
  revalidatePath('/admin');
}

export async function setStatusAction(formData) {
  await requireAdmin();
  const salonId = formData.get('salonId');
  const bookingId = formData.get('bookingId');
  const status = formData.get('status');
  await db.adminSetBookingStatus(salonId, bookingId, status);
  revalidatePath('/admin');
}

export async function resolveHandoffAction(formData) {
  await requireAdmin();
  const salonId = formData.get('salonId');
  const id = formData.get('id');
  await db.resolveHandoff(salonId, id);
  revalidatePath('/admin');
}

export async function logoutAction() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  redirect('/admin');
}
