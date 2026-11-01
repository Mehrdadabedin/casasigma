import { useEffect, useState } from 'react';

const SLIDES = [
  // very wide, so a phone shows it far bigger than the screen's width and needs the large file
  { name: 'casa1', width: 1920, sizes: 'max(100vw, 218vh)' },
  { name: 'casasigmasol2', width: 1484, sizes: 'max(100vw, 137vh)' },
  { name: 'casa2', width: 1920, sizes: '100vw' },
  { name: 'casa3', width: 1920, sizes: '100vw' },
  { name: 'rest1', width: 1920, sizes: '100vw' },
];
/** How long each photo stays on the landing page (the owner, 31 Oct). */
export const SLIDE_MS = 5000;

const url = (name: string) => `${import.meta.env.BASE_URL}home/${name}`;

/**
 * The landing page's full-page photos, each sliding in from the left and out to
 * the right. With reduced motion the first photo stays. Decorative, so hidden
 * from screen readers.
 */
export function HomeSlides() {
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setTurn((current) => current + 1), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const showing = turn % SLIDES.length;
  const leaving = turn === 0 ? null : (turn - 1) % SLIDES.length;

  return (
    <div className="home-slides" aria-hidden="true" data-testid="home-slides">
      {SLIDES.map(({ name, width, sizes }, index) => (
        <img
          key={name}
          className={`home-slide home-slide--${name} ${index === showing ? 'is-on' : ''} ${index === leaving ? 'is-out' : ''}`}
          src={url(`${name}.webp`)}
          srcSet={`${url(`${name}-960.webp`)} 960w, ${url(`${name}.webp`)} ${width}w`}
          sizes={sizes}
          alt=""
          decoding="async"
        />
      ))}
    </div>
  );
}
