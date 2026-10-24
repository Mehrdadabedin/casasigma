// MKT1.2: a guest's card is a sign-in prompt. The photo spot is blurred with a
// "Login required" button, the card leads to /login, and the page never holds
// the real price or address. A signed-in account sees everything.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { HouseCard, RestaurantCard } from '../../src/components/cards';
import { houses } from '../../src/data/houses';
import { restaurants } from '../../src/data/restaurants';
import { formatPrice } from '../../src/lib/format';

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, ready: true }));
vi.mock('../../src/state/AuthProvider', () => ({ useAuth: () => auth }));

afterEach(() => {
  cleanup();
  auth.user = null;
});

const house = houses[0];
const restaurant = restaurants[0];

function show(card: 'house' | 'restaurant') {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/homes']}>
        {card === 'house' ? <HouseCard house={house} /> : <RestaurantCard restaurant={restaurant} />}
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('locked listing cards', () => {
  it.each(['house', 'restaurant'] as const)('a guest %s card asks to sign in and holds no price or address', (card) => {
    const { container } = show(card);
    const listing = card === 'house' ? house : restaurant;
    expect(screen.getByText('Login required')).toBeTruthy();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/login?next=%2Fhomes');
    const text = container.textContent ?? '';
    expect(text).not.toContain(formatPrice(listing.price));
    expect(text).not.toContain(listing.neighborhood);
    expect(text).toContain('Price after sign-in');
  });

  it('a signed-in account sees the price and address and opens the listing', () => {
    auth.user = { id: 'buyer-1' };
    const { container } = show('house');
    expect(screen.queryByText('Login required')).toBeNull();
    expect(container.textContent).toContain(formatPrice(house.price));
    expect(container.textContent).toContain(house.neighborhood);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(`/homes/${house.id}`);
  });
});
