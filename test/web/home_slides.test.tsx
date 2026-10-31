// The landing page's photos take turns every 5 seconds, sliding left to right.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeSlides, SLIDE_MS } from '../../src/components/HomeSlides';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { Home } from '../../src/pages/Home';

const slide = (name: string) =>
  [...screen.getByTestId('home-slides').querySelectorAll('img')].find((img) =>
    img.getAttribute('src')?.endsWith(`/home/${name}.webp`),
  )!;
const next = () => act(() => { vi.advanceTimersByTime(SLIDE_MS); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the landing photos', () => {
  it('starts on the first photo, with nothing leaving', () => {
    render(<HomeSlides />);
    expect(SLIDE_MS).toBe(5000);
    expect(slide('casa1').classList.contains('is-on')).toBe(true);
    expect(screen.getByTestId('home-slides').querySelector('.is-out')).toBeNull();
  });

  it('goes through all four and back to the first', () => {
    render(<HomeSlides />);
    for (const [on, out] of [['casa2', 'casa1'], ['casa3', 'casa2'], ['rest1', 'casa3'], ['casa1', 'rest1']]) {
      next();
      expect(slide(on).classList.contains('is-on')).toBe(true);
      expect(slide(out).classList.contains('is-out')).toBe(true);
    }
  });

  it('stays on the first photo with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    render(<HomeSlides />);
    next();
    expect(slide('casa1').classList.contains('is-on')).toBe(true);
  });

  it('stops when the page closes', () => {
    const { unmount } = render(<HomeSlides />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the landing page', () => {
  it('shows only the headline and the search', () => {
    render(<LanguageProvider><MemoryRouter><Home /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});
