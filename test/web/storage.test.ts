import { beforeEach, describe, expect, it } from 'vitest';
import { loadBookings, saveBookings } from '../../src/lib/storage';
import type { Booking } from '../../src/types';

const CURRENT_KEY = 'casasigma.store.v1';
const LEGACY_KEY = 'stayfound.store.v1';

const booking: Booking = {
  kind: 'visit',
  id: 'b1',
  houseId: 'house-1',
  date: '2026-11-01',
  time: '10:00',
  name: 'Test Visitor',
  note: '',
  visitors: 2,
  status: 'Requested',
  createdAt: '2026-10-22T10:00:00.000Z',
};

const store = (bookings: unknown[]) => JSON.stringify({ version: 1, bookings });

beforeEach(() => window.localStorage.clear());

describe('storage', () => {
  it('returns an empty list when nothing is saved', () => {
    expect(loadBookings()).toEqual([]);
  });

  it('round-trips saved bookings', () => {
    saveBookings([booking]);
    expect(loadBookings()).toEqual([booking]);
  });

  it('ignores corrupt or wrong-version data', () => {
    window.localStorage.setItem(CURRENT_KEY, '{not json');
    expect(loadBookings()).toEqual([]);
    window.localStorage.setItem(CURRENT_KEY, JSON.stringify({ version: 2, bookings: [booking] }));
    expect(loadBookings()).toEqual([]);
  });

  it('drops malformed entries and keeps valid ones', () => {
    window.localStorage.setItem(CURRENT_KEY, store([booking, { id: 'x' }, null]));
    expect(loadBookings()).toEqual([booking]);
  });

  it('migrates the legacy stayfound key', () => {
    window.localStorage.setItem(LEGACY_KEY, store([booking]));
    expect(loadBookings()).toEqual([booking]);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CURRENT_KEY)!).bookings).toEqual([booking]);
  });

  it('prefers current data over legacy data', () => {
    const other = { ...booking, id: 'b2' };
    window.localStorage.setItem(CURRENT_KEY, store([other]));
    window.localStorage.setItem(LEGACY_KEY, store([booking]));
    expect(loadBookings()).toEqual([other]);
  });
});
