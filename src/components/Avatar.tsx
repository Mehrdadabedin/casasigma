import { useState } from 'react';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Profile portrait. The slug is only handed to non-owners once an admin has
 * approved it, so a missing slug simply falls back to initials. Paths stay
 * relative so the Android WebView resolves them against its own origin.
 */
export function Avatar({
  name,
  photoSlug,
  size = 72,
}: {
  name: string;
  photoSlug?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (!photoSlug || failed) {
    return (
      <span className="avatar avatar--initials" style={style} aria-hidden="true">
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      className="avatar"
      style={style}
      src={`api/media/${photoSlug}`}
      alt={`Portrait of ${name}`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
