// MKT4.2: the seller dashboard shows the viewing requests for the seller's own
// listings, with a count per listing, and lets the seller confirm or decline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { Sell } from '../../src/pages/Sell';
import type { Listing, ViewingRequest } from '../../src/lib/api';

const auth = vi.hoisted(() => ({ user: { id: 's1', canSell: true } as null | { id: string; canSell: boolean }, ready: true }));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ mine: vi.fn(), cities: vi.fn(), requests: vi.fn(), answer: vi.fn() }));
vi.mock('../../src/lib/api', async (original) => {
  const actual = await original<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    cityApi: { list: api.cities },
    listingApi: { ...actual.listingApi, mine: api.mine },
    sellerViewingApi: { list: api.requests, answer: api.answer },
  };
});

const listing = (id: string, title: string): Listing => ({
  id, title, kind: 'Villa', city: 'Mijas', price: 300000, description: '', photos: [], createdAt: '2026-10-24T10:00:00Z',
});
const visit = (id: string, listingId: string, name: string, status: ViewingRequest['status'] = 'Requested'): ViewingRequest => ({
  id, listingId: `listing:${listingId}`, listingTitle: listingId === 'a' ? 'Villa Alpha' : 'Villa Beta', name, email: `${name.toLowerCase()}@example.test`,
  description: `Message from ${name}`, date: '2026-10-30', time: '11:00', status, createdAt: '2026-10-24T10:00:00Z',
});

beforeEach(() => {
  api.mine.mockResolvedValue({
    listings: [listing('a', 'Villa Alpha'), listing('b', 'Villa Beta')],
    photoUsage: { used: 0, max: 20 },
  });
  api.cities.mockResolvedValue([]);
  api.requests.mockResolvedValue([visit('r1', 'a', 'Ana'), visit('r2', 'a', 'Bo', 'Confirmed')]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const show = () =>
  render(
    <LanguageProvider>
      <MemoryRouter>
        <Sell />
      </MemoryRouter>
    </LanguageProvider>,
  );

describe('seller viewing requests', () => {
  it('shows a request count per listing and the requests with visitor details', async () => {
    const { container } = show();
    await screen.findByText('Message from Ana');
    const rows = [...container.querySelectorAll('.sell__item')];
    expect(rows[0].textContent).toContain('2 viewing requests');
    expect(rows[1].textContent).toContain('0 viewing requests');
    const inbox = container.querySelector('.sell__requests') as HTMLElement;
    expect(inbox.textContent).toContain('Villa Alpha');
    expect(inbox.textContent).toContain('Message from Ana');
    expect(inbox.querySelector('a[href="mailto:ana@example.test"]')).not.toBeNull();
  });

  it('Confirm and Decline call the API and update the row', async () => {
    api.answer.mockImplementation(async (id: string, status: ViewingRequest['status']) => ({ ...visit(id, 'a', 'Ana'), status }));
    const { container } = show();
    await screen.findByText('Message from Ana');
    const card = container.querySelector('.sell__request') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('r1', 'Confirmed'));
    await waitFor(() => expect(within(card).getByText('Confirmed')).toBeTruthy());
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('r1', 'Cancelled'));
  });

  it('says so when there are no requests', async () => {
    api.requests.mockResolvedValue([]);
    show();
    expect(await screen.findByText('No viewing requests yet.')).toBeTruthy();
  });
});
