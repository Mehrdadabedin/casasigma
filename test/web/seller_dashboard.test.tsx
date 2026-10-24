// MKT3.2: the seller dashboard at /sell. Sellers manage their own listings;
// a buyer gets an explanation and a sign-up link, not the dashboard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { Sell } from '../../src/pages/Sell';
import type { Listing } from '../../src/lib/api';

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; canSell: boolean },
  ready: true,
}));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({
  mine: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  cities: vi.fn(),
}));
vi.mock('../../src/lib/api', async (original) => {
  const actual = await original<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    cityApi: { list: api.cities },
    listingApi: { ...actual.listingApi, mine: api.mine, create: api.create, update: api.update, remove: api.remove },
  };
});

const villa: Listing = {
  id: 'l1',
  title: 'Villa with a view',
  kind: 'Villa',
  city: 'Mijas',
  price: 450000,
  description: 'Sea view',
  photos: [
    { slot: 2, slug: 'listing-two' },
    { slot: 4, slug: 'listing-four' },
  ],
  createdAt: '2026-10-24T10:00:00Z',
};

function show() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/sell']}>
        <Sell />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  auth.user = { id: 's1', canSell: true };
  api.mine.mockResolvedValue([villa]);
  api.cities.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('seller dashboard', () => {
  it('lists my listings with cover, price and photo count', async () => {
    const { container } = show();
    expect(await screen.findByText('Villa with a view')).toBeTruthy();
    expect(container.textContent).toContain('€450,000');
    expect(container.textContent).toContain('2 of 5 photos');
    expect(container.querySelector('.sell__cover img')?.getAttribute('src')).toBe('api/media/listing-two');
  });

  it('opens the form card with five photo slots from Add listing', async () => {
    const { container } = show();
    await screen.findByText('Villa with a view');
    expect(container.querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add listing' }));
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelectorAll('.photoslot')).toHaveLength(5);
  });

  it('the form validates before calling the API', async () => {
    show();
    await screen.findByText('Villa with a view');
    fireEvent.click(screen.getByRole('button', { name: 'Add listing' }));
    const title = screen.getByPlaceholderText('e.g. Cortijo with two guest houses');
    fireEvent.change(title, { target: { value: 'abc' } });
    fireEvent.submit(title.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('title');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('Edit opens the form with this listing and saves through update', async () => {
    api.update.mockResolvedValue({ ...villa, title: 'Renamed villa' });
    const { container } = show();
    await screen.findByText('Villa with a view');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const title = container.querySelector('form input') as HTMLInputElement;
    expect(title.value).toBe('Villa with a view');
    fireEvent.change(title, { target: { value: 'Renamed villa' } });
    fireEvent.submit(title.closest('form')!);
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][0]).toBe('l1');
    expect(api.update.mock.calls[0][1]).toMatchObject({ title: 'Renamed villa', price: 450000 });
    expect(await screen.findByText('Renamed villa')).toBeTruthy();
  });

  it('Delete asks first, then removes the row', async () => {
    api.remove.mockResolvedValue({ ok: true });
    show();
    await screen.findByText('Villa with a view');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('l1'));
    await waitFor(() => expect(screen.queryByText('Villa with a view')).toBeNull());
  });

  it('a buyer sees an explanation and a sign-up link, and no API call', () => {
    auth.user = { id: 'b1', canSell: false };
    const { container } = show();
    expect(screen.getByText('Selling is for seller accounts')).toBeTruthy();
    expect(container.querySelector('a[href="/signup"]')).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(api.mine).not.toHaveBeenCalled();
  });
});
