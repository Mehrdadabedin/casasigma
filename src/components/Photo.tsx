import { useState } from 'react';

interface PhotoProps {
  gradient: [string, string];
  label?: string;
  className?: string;
}

/**
 * Listings use generated gradient artwork instead of stock photography so the
 * app ships without binary assets, works offline in the Android WebView, and
 * never depends on a third-party image host.
 */
export function Photo({ gradient, label, className = '' }: PhotoProps) {
  return (
    <div
      className={`photo ${className}`.trim()}
      style={{ backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
      role="img"
      aria-label={label ? `Illustration of ${label}` : 'Listing illustration'}
    >
      <span className="photo__glow" aria-hidden="true" />
      <span className="photo__line" aria-hidden="true" />
      <span className="photo__line photo__line--two" aria-hidden="true" />
    </div>
  );
}

/**
 * A photo a seller uploaded for a listing. A missing slug (or a failed load)
 * falls back to the generated artwork, so a card never shows a broken image.
 */
export function ListingPhoto({
  slug,
  alt,
  className = '',
}: {
  slug?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!slug || failed) {
    return <Photo gradient={['#efe7dc', '#cbbca8']} label={alt} className={className} />;
  }

  return (
    <img
      className={`photo listing-photo ${className}`.trim()}
      src={`api/media/${slug}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
