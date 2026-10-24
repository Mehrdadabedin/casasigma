// MKT4.1: a visitor who is not signed in can book a viewing from /book, and
// the locked detail pages point to it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { BookingsProvider } from '../../src/state/BookingsProvider';
import { Book } from '../../src/pages/Book';
import { HouseDetail } from '../../src/pages/HouseDetail';
import { RestaurantDetail } from '../../src/pages/RestaurantDetail';
import { ListingDetail } from '../../src/pages/ListingDetail';
import { houses } from '../../src/data/houses';
import { restaurants } from '../../src/data/restaurants';

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, ready: true }));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), live: vi.fn() }));
vi.mock('../../src/lib/api', async (original) => {
  const actual = await original<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    viewingApi: { ...actual.viewingApi, create: api.create, list: api.list },
    listingApi: { ...actual.listingApi, list: api.live },
  };
});

beforeEach(() => {
  api.live.mockResolvedValue([]);
  api.create.mockImplementation(async (input) => ({
    ...input,
    id: 'r1',
    status: 'Requested',
    createdAt: '2026-10-24T10:00:00Z',
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function at(path: string) {
  return render(
    <LanguageProvider>
      <BookingsProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/book" element={<Book />} />
            <Route path="/homes/:id" element={<HouseDetail />} />
            <Route path="/restaurants/:id" element={<RestaurantDetail />} />
            <Route path="/listings/:id" element={<ListingDetail />} />
          </Routes>
        </MemoryRouter>
      </BookingsProvider>
    </LanguageProvider>,
  );
}

describe('guest booking', () => {
  it('a guest sends a request from /book without signing in', async () => {
    const { container } = at('/book');
    fireEvent.change(screen.getByPlaceholderText('e.g. Ana Torres'), { target: { value: 'Guest Visitor' } });
    fireEvent.change(container.querySelector('input[type=email]')!, { target: { value: 'guest@example.test' } });
    fireEvent.click(container.querySelector('.timeslot, .slots button, [class*=slot] button') as HTMLElement);
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0]).toMatchObject({
      listingId: `house:${houses[0].id}`,
      name: 'Guest Visitor',
      email: 'guest@example.test',
    });
    expect(await screen.findByText('Meeting requested')).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('/book?listing=house:<id> preselects that home for a guest', () => {
    const house = houses[1];
    const { container } = at(`/book?listing=house:${house.id}`);
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe(`house:${house.id}`);
  });

  it.each([
    ['home', `/homes/${houses[0].id}`, `/book?listing=house:${houses[0].id}`],
    ['restaurant', `/restaurants/${restaurants[0].id}`, `/book?listing=restaurant:${restaurants[0].id}`],
  ])('the locked %s page offers booking without signing in', (_name, path, href) => {
    const { container } = at(path);
    expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
  });

  it('the locked seller-listing page offers booking without signing in', () => {
    const { container } = at('/listings/4f9c1a52-7e6b-4a53-9d0e-2b6f1c0a1111');
    expect(container.querySelector('a[href="/book?listing=listing:4f9c1a52-7e6b-4a53-9d0e-2b6f1c0a1111"]')).not.toBeNull();
  });
});
