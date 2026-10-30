/**
 * Photo compression in the browser, before upload.
 *
 * Every photo is re-encoded as JPEG (which also drops EXIF data such as the
 * GPS position of a phone shot) and made to fit a byte budget: first the
 * longest side is capped, then the quality is lowered, then the size again.
 * The API refuses anything over the same budgets (server/index.mjs), so a
 * photo that cannot fit is reported here instead of failing on upload.
 */

/** Upload ceilings; keep in step with MAX_*_PHOTO_BYTES in server/index.mjs. */
export const LISTING_PHOTO_MAX_BYTES = 1024 * 1024;
export const PROFILE_PHOTO_MAX_BYTES = 512 * 1024;

export const LISTING_PHOTO = { maxEdge: 1600, maxBytes: LISTING_PHOTO_MAX_BYTES };
export const PROFILE_PHOTO = { maxEdge: 900, maxBytes: PROFILE_PHOTO_MAX_BYTES };

const QUALITIES = [0.86, 0.78, 0.7, 0.62];
const EDGE_STEP = 0.8;
const MIN_EDGE = 480;

/** The photo cannot be made small enough, even at the lowest quality and size. */
export class PhotoTooLargeError extends Error {
  constructor() {
    super('photo too large');
    this.name = 'PhotoTooLargeError';
  }
}

export type Encode = (edge: number, quality: number) => Promise<Blob>;

/**
 * Try quality steps at each size, shrinking the longest side by 20% per round,
 * until a result fits `maxBytes`. `edge` never exceeds the original `longest`
 * side, so small photos are not upscaled.
 */
export async function fitToBudget(
  encode: Encode,
  { longest, maxEdge, maxBytes }: { longest: number; maxEdge: number; maxBytes: number },
): Promise<Blob> {
  let edge = Math.min(longest, maxEdge);
  for (;;) {
    for (const quality of QUALITIES) {
      const blob = await encode(edge, quality);
      if (blob.size <= maxBytes) return blob;
    }
    if (edge <= MIN_EDGE) throw new PhotoTooLargeError();
    edge = Math.max(MIN_EDGE, Math.round(edge * EDGE_STEP));
  }
}

/** Downscale and compress `file` to fit `maxBytes`, with `maxEdge` as the longest side. */
export async function shrinkImage(
  file: File,
  { maxEdge, maxBytes }: { maxEdge: number; maxBytes: number },
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');

    const encode: Encode = (edge, quality) => {
      const scale = edge / longest;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // JPEG has no transparency: paint transparent PNG areas white, not black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('could not encode the photo'))),
          'image/jpeg',
          quality,
        );
      });
    };

    return await fitToBudget(encode, { longest, maxEdge, maxBytes });
  } finally {
    bitmap.close();
  }
}

/** True when an upload failed because the photo is too big, here or at the API. */
export function isPhotoTooLarge(error: unknown): boolean {
  if (error instanceof PhotoTooLargeError) return true;
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 413;
}
