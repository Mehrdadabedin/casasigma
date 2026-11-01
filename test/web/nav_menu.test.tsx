// The hamburger menu replaces the top links and the phone tab bar on every page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const auth = vi.hoisted(() => ({ user: null as null | { role: string; canSell: boolean; name: string } }));
vi.mock('../../src/state/AuthProvider', () => ({
  useAuth: () => ({ user: auth.user, ready: true, signOut: vi.fn() }),
}));

import { Layout } from '../../src/components/Layout';
import { LanguageProvider } from '../../src/state/LanguageProvider';

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const site = (path = '/homes') =>
  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>
        <Layout><Where /></Layout>
      </MemoryRouter>
    </LanguageProvider>,
  );
const menuButton = () => screen.getByRole('button', { name: 'Menu' });
const panel = () => document.getElementById('navmenu-links');
const labels = () => [...panel()!.querySelectorAll('a')].map((link) => link.textContent);

afterEach(() => {
  cleanup();
  auth.user = null;
});

describe('the hamburger menu', () => {
  it('starts closed, with no tab bar and no top links', () => {
    site();
    expect(panel()).toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(document.querySelector('.topbar__nav')).toBeNull();
  });

  it('shows the links for a guest, and goes to a page and closes', () => {
    site();
    fireEvent.click(menuButton());
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(labels()).toEqual(['Explore', 'Homes', 'Restaurants', 'Book']);
    fireEvent.click([...panel()!.querySelectorAll('a')].find((link) => link.textContent === 'Book')!);
    expect(screen.getByTestId('where').textContent).toBe('/book');
    expect(panel()).toBeNull();
  });

  it('adds Sell and the profile for a seller, Admin for an admin', () => {
    auth.user = { role: 'seller', canSell: true, name: 'Sam Seller' };
    site();
    fireEvent.click(menuButton());
    expect(labels()).toEqual(['Explore', 'Homes', 'Restaurants', 'Sell', 'Book', 'Your profile']);
    cleanup();
    auth.user = { role: 'admin', canSell: true, name: 'Admin' };
    site();
    fireEvent.click(menuButton());
    expect(labels()).toContain('Admin');
    expect(labels()).not.toContain('Sell');
  });

  it('closes on Escape, with focus back on the button', () => {
    site();
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes on a tap outside, and stays open on a tap inside', () => {
    site();
    fireEvent.click(menuButton());
    fireEvent.pointerDown(panel()!);
    expect(panel()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(panel()).toBeNull();
  });
});
