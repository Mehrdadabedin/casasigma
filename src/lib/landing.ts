import type { Role } from './api';

export const HOME_PATH = '/';

/** Only allow in-app paths, so `?next=` cannot become an open redirect. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return HOME_PATH;
  if (raw.startsWith('/login') || raw.startsWith('/signup')) return HOME_PATH;
  return raw;
}

/**
 * Where to go after sign-in or sign-up. Admins land on the dashboard (or on the
 * credential step while they still use the starter password), sellers in the
 * studio, buyers on Home unless they asked for another page.
 */
export function landing(user: { role: Role; mustSetPassword: boolean } | null | undefined, next: string) {
  if (user?.role === 'admin') {
    if (user.mustSetPassword) return '/admin/credentials';
    if (next === HOME_PATH || next === '/profile') return '/admin';
    return next;
  }
  if (user?.role === 'seller' && next === HOME_PATH) return '/sell';
  return next;
}
