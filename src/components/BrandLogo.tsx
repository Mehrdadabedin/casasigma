import { useMediaSrc } from '../lib/media';

/** Bundled artwork — also the fallback when the media API is not reachable. */
export const BRAND_WORDMARK = `${import.meta.env.BASE_URL}brand/casasigma-wordmark.png`;

export function BrandLogo() {
  const src = useMediaSrc('brand-logo', BRAND_WORDMARK);
  return (
    <img
      className="brand__logo"
      src={src}
      alt=""
      width={597}
      height={193}
      decoding="async"
    />
  );
}
