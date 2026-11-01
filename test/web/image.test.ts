// Photos are compressed in the browser to fit the API's upload budgets
// (1 MB per listing photo, 512 KB per portrait). jsdom has no canvas encoder,
// so these tests drive the budget loop with a fake encoder.
import { describe, expect, it } from 'vitest';
import {
  fitToBudget,
  isPhotoTooLarge,
  LISTING_PHOTO,
  PhotoTooLargeError,
  PROFILE_PHOTO,
  type Encode,
} from '../../src/lib/image';
import { ApiError } from '../../src/lib/api';

/** A fake encoder whose output size grows with edge² and quality; it records each call. */
function fakeEncoder(bytesPerPixel: number) {
  const calls: { edge: number; quality: number }[] = [];
  const encode: Encode = async (edge, quality) => {
    calls.push({ edge, quality });
    return new Blob([new Uint8Array(Math.round(edge * edge * bytesPerPixel * quality))]);
  };
  return { encode, calls };
}

describe('photo budgets', () => {
  it('match the API limits', () => {
    expect(LISTING_PHOTO).toEqual({ maxEdge: 1600, maxBytes: 1024 * 1024 });
    expect(PROFILE_PHOTO).toEqual({ maxEdge: 900, maxBytes: 512 * 1024 });
  });
});

describe('fitToBudget', () => {
  it('caps the longest side and keeps the best quality when that already fits', async () => {
    const { encode, calls } = fakeEncoder(0.2);
    const blob = await fitToBudget(encode, { longest: 4000, ...LISTING_PHOTO });
    expect(calls).toEqual([{ edge: 1600, quality: 0.86 }]);
    expect(blob.size).toBeLessThanOrEqual(LISTING_PHOTO.maxBytes);
  });

  it('never upscales a small photo', async () => {
    const { encode, calls } = fakeEncoder(0.2);
    await fitToBudget(encode, { longest: 640, ...LISTING_PHOTO });
    expect(calls[0].edge).toBe(640);
  });

  it('lowers the quality before the size', async () => {
    const { encode, calls } = fakeEncoder(0.5);
    const blob = await fitToBudget(encode, { longest: 4000, ...LISTING_PHOTO });
    expect(calls.map((call) => call.edge)).toEqual([1600, 1600]);
    expect(calls.map((call) => call.quality)).toEqual([0.86, 0.78]);
    expect(blob.size).toBeLessThanOrEqual(LISTING_PHOTO.maxBytes);
  });

  it('then shrinks the size by steps until the photo fits', async () => {
    const { encode, calls } = fakeEncoder(1.2);
    const blob = await fitToBudget(encode, { longest: 4000, ...PROFILE_PHOTO });
    expect(blob.size).toBeLessThanOrEqual(PROFILE_PHOTO.maxBytes);
    const edges = [...new Set(calls.map((call) => call.edge))];
    expect(edges[0]).toBe(900);
    expect(edges.length).toBeGreaterThan(1);
    expect(edges).toEqual([...edges].sort((a, b) => b - a));
  });

  it('gives up with PhotoTooLargeError instead of uploading something the API refuses', async () => {
    const encode: Encode = async () => new Blob([new Uint8Array(PROFILE_PHOTO.maxBytes + 1)]);
    await expect(fitToBudget(encode, { longest: 4000, ...PROFILE_PHOTO })).rejects.toBeInstanceOf(
      PhotoTooLargeError,
    );
  });
});

describe('isPhotoTooLarge', () => {
  it('covers a photo that could not be compressed and a 413 from the API', () => {
    expect(isPhotoTooLarge(new PhotoTooLargeError())).toBe(true);
    expect(isPhotoTooLarge(new ApiError('payload too large', 413))).toBe(true);
    expect(isPhotoTooLarge(new ApiError('unsupported media type', 415))).toBe(false);
    expect(isPhotoTooLarge(new Error('network'))).toBe(false);
  });
});
