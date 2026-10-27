// The built web app (dist/), served by the API process in production so the
// page and /api share one origin: the API rejects cross-origin writes and its
// session cookie is SameSite=Lax. In development Vite serves the page instead.
//
// Routes are hash-based (/#/...), so every page is index.html and an unknown
// path is a plain 404, with no SPA fallback.
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** The directory to serve: WEB_DIST when set, dist/ in production, otherwise none. */
export function webRoot(root, env = process.env) {
  if (env.WEB_DIST) return resolve(root, env.WEB_DIST);
  return env.NODE_ENV === 'production' ? resolve(root, 'dist') : null;
}

/** The file for a URL path, or null when it would leave `dir` or name a dotfile. */
export function resolveWebPath(dir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.split('/').some((part) => part.startsWith('.'))) return null;
  const file = resolve(dir, relative);
  return file.startsWith(dir + sep) ? file : null;
}

function cacheControl(dir, file) {
  // Vite puts a content hash in every name under assets/.
  if (file.startsWith(resolve(dir, 'assets') + sep)) return 'public, max-age=31536000, immutable';
  if (file.endsWith('.html')) return 'no-cache';
  return 'public, max-age=3600';
}

function notFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

export async function serveWeb(dir, request, response, pathname) {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const file = resolveWebPath(dir, pathname);
  if (!file) {
    notFound(response);
    return;
  }
  let body;
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    body = await readFile(file);
  } catch {
    notFound(response);
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': cacheControl(dir, file),
    'x-content-type-options': 'nosniff',
  });
  response.end(method === 'HEAD' ? undefined : body);
}
