// MKT3.1: the seller's photo grid has five slots; slot 1 is the cover.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LanguageProvider } from '../../src/state/LanguageProvider';
import { PhotoSlotGrid } from '../../src/pages/Sell';
import { PHOTO_SLOTS } from '../../src/lib/api';

afterEach(cleanup);

describe('photo slots', () => {
  it('allows five photos', () => {
    expect(PHOTO_SLOTS).toBe(5);
  });

  it('renders one slot per photo and picks the right slot number', () => {
    const onPick = vi.fn();
    const { container } = render(
      <LanguageProvider>
        <PhotoSlotGrid photos={Array(PHOTO_SLOTS).fill(null)} onPick={onPick} />
      </LanguageProvider>,
    );
    expect(container.querySelectorAll('.photoslot')).toHaveLength(5);
    const inputs = container.querySelectorAll('input[type=file]');
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(inputs[4], { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(5, file);
  });
});
