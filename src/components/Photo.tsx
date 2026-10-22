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
