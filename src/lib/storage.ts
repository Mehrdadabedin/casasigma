import type { Booking, StoreShape } from '../types';

const STORAGE_KEY = 'casasigma.store.v1';
// Bookings captured before the CasaSigma rename still load on this device.
const LEGACY_KEY = 'stayfound.store.v1';

function parse(raw: string | null): Booking[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    if (parsed.version !== 1 || !Array.isArray(parsed.bookings)) return null;
    return parsed.bookings.filter(
      (booking): booking is Booking =>
        Boolean(booking) &&
        typeof booking.id === 'string' &&
        booking.kind === 'visit' &&
        typeof booking.houseId === 'string' &&
        typeof booking.date === 'string' &&
        typeof booking.time === 'string',
    );
  } catch {
    return null;
  }
}

export function loadBookings(): Booking[] {
  try {
    const current = parse(window.localStorage.getItem(STORAGE_KEY));
    if (current) return current;

    const legacy = parse(window.localStorage.getItem(LEGACY_KEY));
    if (legacy) {
      saveBookings(legacy);
      window.localStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveBookings(bookings: Booking[]): void {
  const payload: StoreShape = { version: 1, bookings };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private modes; the app stays usable in memory.
  }
}
