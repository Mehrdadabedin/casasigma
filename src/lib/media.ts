import { useEffect, useState } from 'react';

/**
 * Resolve an image from the media API (`GET /api/media/:slug`) and fall back to
 * a bundled file when the API is unreachable — for example inside the Capacitor
 * Android WebView, which has no local API server.
 *
 * Only an `image/*` response is accepted: a static host that answers unknown
 * paths with `index.html` must not replace the logo with markup.
 */
export function useMediaSrc(slug: string, fallback: string): string {
  const [src, setSrc] = useState(fallback);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let active = true;

    fetch(`api/media/${slug}`, { signal: controller.signal })
      .then((response) => {
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.startsWith('image/')) {
          throw new Error(`media ${slug}: ${response.status} ${type}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        // Keep the bundled fallback; offline and Android builds rely on it.
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slug]);

  return src;
}
