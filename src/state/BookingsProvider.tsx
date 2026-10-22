import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Booking } from '../types';
import { loadBookings, saveBookings } from '../lib/storage';

interface VisitInput {
  houseId: string;
  date: string;
  time: string;
  name: string;
  visitors: number;
  note: string;
}

interface BookingsContextValue {
  bookings: Booking[];
  addVisit: (input: VisitInput) => Booking | null;
  cancelBooking: (id: string) => void;
  isSlotTaken: (houseId: string, date: string, time: string) => boolean;
}

const BookingsContext = createContext<BookingsContextValue | null>(null);

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function BookingsProvider({ children }: { children: ReactNode }) {
  const [bookings, setBookings] = useState<Booking[]>(() => loadBookings());

  useEffect(() => {
    saveBookings(bookings);
  }, [bookings]);

  const isSlotTaken = useCallback(
    (houseId: string, date: string, time: string) =>
      bookings.some(
        (booking) =>
          booking.status !== 'Cancelled' &&
          booking.houseId === houseId &&
          booking.date === date &&
          booking.time === time,
      ),
    [bookings],
  );

  const addVisit = useCallback(
    (input: VisitInput): Booking | null => {
      const duplicate = bookings.some(
        (booking) =>
          booking.kind === 'visit' &&
          booking.status !== 'Cancelled' &&
          booking.houseId === input.houseId &&
          booking.date === input.date &&
          booking.time === input.time,
      );
      if (duplicate) return null;

      const visit: Booking = {
        kind: 'visit',
        id: createId(),
        status: 'Requested',
        createdAt: new Date().toISOString(),
        ...input,
      };
      setBookings((current) => [visit, ...current]);
      return visit;
    },
    [bookings],
  );

  const cancelBooking = useCallback((id: string) => {
    setBookings((current) =>
      current.map((booking) =>
        booking.id === id ? { ...booking, status: 'Cancelled' as const } : booking,
      ),
    );
  }, []);

  const value = useMemo<BookingsContextValue>(
    () => ({ bookings, addVisit, cancelBooking, isSlotTaken }),
    [bookings, addVisit, cancelBooking, isSlotTaken],
  );

  return <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>;
}

export function useBookings(): BookingsContextValue {
  const context = useContext(BookingsContext);
  if (!context) throw new Error('useBookings must be used inside <BookingsProvider>');
  return context;
}
