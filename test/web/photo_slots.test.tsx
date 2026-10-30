// MKT3.1/3.3: the seller's photo grid shows the photos so far and one "Add photo"
// box for the next slot; slot 1 is the cover.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { nextPhotoSlot, PhotoSlotGrid } from '../../src/pages/Sell';
import { PHOTO_SLOTS } from '../../src/lib/api';

afterEach(cleanup);

describe('photo slots', () => {
  it('allows twenty photos', () => {
    expect(PHOTO_SLOTS).toBe(20);
  });

  it('shows one add box and no other when there are no photos', () => {
    const onPick = vi.fn();
    const { container } = render(
      <LanguageProvider>
        <PhotoSlotGrid photos={[]} nextSlot={1} onPick={onPick} />
      </LanguageProvider>,
    );
    expect(container.querySelectorAll('.photoslot')).toHaveLength(1);
    expect(container.querySelectorAll('.photoslot__add')).toHaveLength(1);
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(1, file);
  });

  it('shows the photos and the add box with the next slot', () => {
    const onPick = vi.fn();
    const { container } = render(
      <LanguageProvider>
        <PhotoSlotGrid
          photos={[
            { slot: 2, src: 'a' },
            { slot: 3, src: 'b' },
          ]}
          nextSlot={4}
          onPick={onPick}
        />
      </LanguageProvider>,
    );
    expect(container.querySelectorAll('.photoslot.is-filled')).toHaveLength(2);
    expect(container.querySelectorAll('.photoslot__add')).toHaveLength(1);
    const inputs = container.querySelectorAll('input[type=file]');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(inputs[2], { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(4, file);
  });

  it('has no add box at the limit, and says why', () => {
    const { container } = render(
      <LanguageProvider>
        <PhotoSlotGrid photos={[{ slot: 1, src: 'a' }]} nextSlot={null} onPick={vi.fn()} />
      </LanguageProvider>,
    );
    expect(container.querySelector('.photoslot__add')).toBeNull();
    expect(container.textContent).toContain('limit of 20 photos');
  });
});

describe('next photo slot', () => {
  it('goes after the highest slot in use, so a new photo is never the cover by accident', () => {
    expect(nextPhotoSlot([], 20)).toBe(1);
    expect(nextPhotoSlot([2, 3], 18)).toBe(4);
    expect(nextPhotoSlot([1, 5], 18)).toBe(6);
  });

  it('falls back to the lowest free slot past 20, and to nothing without room', () => {
    expect(nextPhotoSlot([1, 3, 20], 17)).toBe(2);
    expect(nextPhotoSlot(Array.from({ length: 20 }, (_, i) => i + 1), 5)).toBeNull();
    expect(nextPhotoSlot([1], 0)).toBeNull();
  });
});
