// MKT4.4: the booking form carries a hidden field that people never fill, and
// shows the server's message when the request limit is hit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { BookingsProvider } from '../../src/state/BookingsProvider';
import { Book } from '../../src/pages/Book';
import { ApiError } from '../../src/lib/api';

const auth = vi.hoisted(() => ({ user: null, ready: true }));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ create: vi.fn(), live: vi.fn() }));
vi.mock('../../src/lib/api', async (original) => {
  const actual = await original<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    viewingApi: { ...actual.viewingApi, create: api.create },
    listingApi: { ...actual.listingApi, list: api.live },
  };
});

beforeEach(() => api.live.mockResolvedValue([]));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillAndSubmit(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText('e.g. Ana Torres'), { target: { value: 'Guest Visitor' } });
  fireEvent.change(container.querySelector('input[type=email]')!, { target: { value: 'guest@example.test' } });
  fireEvent.click(container.querySelector('[class*=slot] button') as HTMLElement);
  fireEvent.submit(container.querySelector('form')!);
}

const show = () =>
  render(
    <LanguageProvider>
      <BookingsProvider>
        <MemoryRouter initialEntries={['/book']}>
          <Book />
        </MemoryRouter>
      </BookingsProvider>
    </LanguageProvider>,
  );

describe('booking spam guard', () => {
  it('has a hidden field that screen readers and the keyboard skip', () => {
    const { container } = show();
    const field = container.querySelector('input[name=website]') as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field.value).toBe('');
    expect(field.tabIndex).toBe(-1);
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.closest('[aria-hidden=true]')).not.toBeNull();
  });

  it('sends the field empty for a person', async () => {
    api.create.mockResolvedValue({ id: 'r1', listingId: 'x', listingTitle: 'x', name: 'x', email: 'guest@example.test', description: '', date: '2026-10-30', time: '10:00', status: 'Requested', createdAt: '' });
    const { container } = show();
    fillAndSubmit(container);
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0].website).toBe('');
  });

  it('shows the limit message from the server', async () => {
    api.create.mockRejectedValue(new ApiError('Too many requests. Try again later.', 429));
    const { container } = show();
    fillAndSubmit(container);
    expect((await screen.findByRole('alert')).textContent).toContain('Too many requests');
  });
});
