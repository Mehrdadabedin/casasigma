import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const { Pool } = pg;
const scrypt = promisify(scryptCallback);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// API_PORT, not PORT: `PORT=0` is common in hosted shells and would bind a
// random port the Vite proxy cannot reach.
const PORT = Number(process.env.API_PORT ?? 8787);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://casasigma@127.0.0.1:5434/casasigma';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = new Set(['buyer', 'seller']);
const ADMIN = 'admin';
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const SESSION_COOKIE = 'cs_session';
const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const loginFailures = new Map();

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function readBody(request, limit = MAX_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('payload too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const bytes = await readBody(request, MAX_JSON_BYTES);
  if (bytes.length === 0) return {};
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('expected a JSON object');
      error.status = 400;
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    const invalid = new Error('invalid JSON body');
    invalid.status = 400;
    throw invalid;
  }
}

function hashPassword(password) {
  const salt = randomBytes(16);
  return scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  }).then(
    (key) =>
      `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`,
  );
}

async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (!salt.length || !expected.length) return false;
  const key = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const jar = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      jar[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      jar[name] = part.slice(index + 1).trim();
    }
  }
  return jar;
}

function requestIsSecure(request) {
  return (
    COOKIE_SECURE ||
    Boolean(request.socket.encrypted) ||
    request.headers['x-forwarded-proto'] === 'https'
  );
}

function sessionCookie(request, token, maxAge = SESSION_MAX_AGE) {
  const secure = requestIsSecure(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clientIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || request.socket.remoteAddress || 'unknown';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Reject cross-site writes. Same-origin fetches send Origin; curl does not. */
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin);
    const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '');
    if (!host) return false;
    if (from.host === host) return true;
    const target = new URL(`http://${host}`);
    // The Vite dev proxy can present 127.0.0.1:8787 while the page is at
    // localhost:5173; both are loopback, so allow that pair only.
    return isLoopbackHost(from.hostname) && isLoopbackHost(target.hostname);
  } catch {
    return false;
  }
}

function rejectCrossOrigin(request, response) {
  if (sameOrigin(request)) return false;
  sendJson(response, 403, { error: 'cross-origin request rejected' });
  return true;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role,
    username: row.username ?? null,
    canBuy: row.can_buy,
    canSell: row.can_sell,
    suspended: row.suspended_at != null,
    mustSetPassword: row.must_set_password === true,
    createdAt: row.created_at,
  };
}

/** Columns every admin/user query returns, so publicUser() has one shape. */
const USER_COLUMNS =
  'id, email, name, phone, role, username, can_buy, can_sell, suspended_at, must_set_password, created_at';

/** Admin-only guard; writes the response itself when the caller is not allowed. */
async function requireAdmin(request, response) {
  const user = await currentUser(request, response);
  if (!user) return null;
  if (user.role !== ADMIN) {
    sendJson(response, 403, { error: 'admin access required' });
    return null;
  }
  return user;
}

async function findSession(request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 200) return null;

  const { rows } = await pool.query(
    `select s.id as session_id, s.last_seen_at, s.expires_at,
            u.id, u.email, u.name, u.phone, u.role, u.username, u.can_buy, u.can_sell,
            u.suspended_at, u.must_set_password, u.created_at
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.suspended_at is null`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    await pool.query(
      `update sessions
          set last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days'
        where id = $1`,
      [row.session_id],
    );
  }

  return { user: publicUser(row), sessionId: row.session_id };
}

async function startSession(request, response, userId) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, now() + interval '${SESSION_DAYS} days', $3)`,
    [userId, tokenHash(token), String(request.headers['user-agent'] ?? '').slice(0, 300)],
  );
  response.setHeader('set-cookie', sessionCookie(request, token));
}

async function currentUser(request, response) {
  const session = await findSession(request);
  if (!session) {
    sendJson(response, 401, { error: 'not signed in' });
    return null;
  }
  return session.user;
}

function rateKey(request, email) {
  return `${clientIp(request)}|${email}`;
}

function isRateLimited(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.startedAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.startedAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, startedAt: Date.now() });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 1000) {
    for (const [candidate, value] of loginFailures) {
      if (Date.now() - value.startedAt > LOGIN_WINDOW_MS) loginFailures.delete(candidate);
    }
  }
}

async function signup(request, response) {
  if (rejectCrossOrigin(request, response)) return;
  const body = await readJson(request);

  const email = String(body.email ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const phone = body.phone == null ? null : String(body.phone).trim().slice(0, 40) || null;
  const role = String(body.role ?? '');
  const password = String(body.password ?? '');

  if (!EMAIL.test(email) || email.length > 254) {
    sendJson(response, 400, { error: 'Enter a valid email address.', field: 'email' });
    return;
  }
  if (name.length < 2 || name.length > 80) {
    sendJson(response, 400, { error: 'Enter your name (2–80 characters).', field: 'name' });
    return;
  }
  if (!ROLES.has(role)) {
    sendJson(response, 400, { error: 'Choose whether you are buying or selling.', field: 'role' });
    return;
  }
  if (password.length < 10 || password.length > 200) {
    sendJson(response, 400, {
      error: 'Use a password of at least 10 characters.',
      field: 'password',
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    const { rows } = await pool.query(
      `insert into users (email, name, phone, role, password_hash, can_buy, can_sell)
       values ($1, $2, $3, $4, $5, true, $6)
       returning id, email, name, phone, role, can_buy, can_sell, created_at`,
      [email, name, phone, role, passwordHash, role === 'seller'],
    );
    user = publicUser(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      sendJson(response, 409, {
        error: 'That email already has an account. Sign in instead.',
        field: 'email',
      });
      return;
    }
    throw error;
  }

  await startSession(request, response, user.id);
  sendJson(response, 201, { user });
}

async function login(request, response) {
  if (rejectCrossOrigin(request, response)) return;
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const key = rateKey(request, email);

  if (isRateLimited(key)) {
    response.setHeader('retry-after', '900');
    sendJson(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    return;
  }

  const invalid = () => {
    recordFailure(key);
    sendJson(response, 401, { error: 'Email or password is not correct.', field: 'password' });
  };

  if (!email || !password) {
    invalid();
    return;
  }

  const { rows } = await pool.query(
    `select ${USER_COLUMNS}, password_hash
       from users
      where lower(email) = lower($1) or lower(coalesce(username, '')) = lower($1)`,
    [email],
  );
  const row = rows[0];
  // An admin seeded without a password has password_hash null until the setup
  // code is redeemed, so there is nothing to verify against yet.
  if (!row || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
    invalid();
    return;
  }

  if (row.suspended_at != null) {
    // Only checked after the password matches, so this cannot be used to
    // discover which emails have accounts.
    recordFailure(key);
    sendJson(response, 403, {
      error: 'This account is suspended. Contact support if you think that is a mistake.',
    });
    return;
  }

  loginFailures.delete(key);
  await startSession(request, response, row.id);
  sendJson(response, 200, { user: publicUser(row) });
}

/**
 * Replace the starter admin credentials with the admin's own username and
 * password. The new password must differ from the current one, so the
 * first-run step can never leave the account on the starter password.
 */
async function updateAdminCredentials(request, response, admin) {
  const body = await readJson(request);
  const currentPassword = String(body.currentPassword ?? '');
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const { rows } = await pool.query('select password_hash from users where id = $1', [admin.id]);
  const stored = rows[0]?.password_hash;
  if (!stored || !(await verifyPassword(currentPassword, stored))) {
    sendJson(response, 401, {
      error: 'The current password is not correct.',
      field: 'currentPassword',
    });
    return;
  }

  if (!USERNAME.test(username)) {
    sendJson(response, 400, {
      error: 'Use 2–32 characters: letters, numbers, dot, dash or underscore.',
      field: 'username',
    });
    return;
  }
  if (password.length < 10 || password.length > 200) {
    sendJson(response, 400, {
      error: 'Use a password of at least 10 characters.',
      field: 'password',
    });
    return;
  }
  if (password === currentPassword) {
    sendJson(response, 400, {
      error: 'Choose a password that is different from your current one.',
      field: 'password',
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  let saved;
  try {
    const { rows: updated } = await pool.query(
      `update users
          set password_hash = $1, username = $2, must_set_password = false, updated_at = now()
        where id = $3
        returning ${USER_COLUMNS}`,
      [passwordHash, username, admin.id],
    );
    saved = updated[0];
  } catch (error) {
    if (error.code === '23505') {
      sendJson(response, 409, { error: 'That username is already taken.', field: 'username' });
      return;
    }
    throw error;
  }

  // Other devices signed in with the starter password are signed out; this
  // browser gets a fresh session so the admin stays where they are.
  await pool.query('delete from sessions where user_id = $1', [admin.id]);
  await startSession(request, response, saved.id);
  sendJson(response, 200, { user: publicUser(saved) });
}

async function logout(request, response) {
  if (rejectCrossOrigin(request, response)) return;
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (token) {
    await pool.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
  }
  response.setHeader('set-cookie', sessionCookie(request, '', 0));
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

async function getMedia(slug, request, response) {
  const { rows } = await pool.query(
    'select mime, bytes, md5(bytes) as etag from media where slug = $1',
    [slug],
  );
  const row = rows[0];
  if (!row) {
    sendJson(response, 404, { error: 'not found', slug });
    return;
  }

  const etag = `"${row.etag}"`;
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { etag });
    response.end();
    return;
  }

  response.writeHead(200, {
    'content-type': row.mime,
    'content-length': row.bytes.length,
    'cache-control': 'public, max-age=60, must-revalidate',
    etag,
    'x-content-type-options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : row.bytes);
}

async function putMedia(slug, request, response) {
  const mime = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mime)) {
    sendJson(response, 415, {
      error: 'unsupported media type',
      allowed: [...MIME_TYPES],
    });
    return;
  }

  const bytes = await readBody(request);
  if (bytes.length === 0) {
    sendJson(response, 400, { error: 'empty body' });
    return;
  }

  const { rows } = await pool.query(
    `insert into media (slug, mime, bytes)
     values ($1, $2, $3)
     on conflict (slug) do update
       set mime = excluded.mime, bytes = excluded.bytes, updated_at = now()
     returning slug, mime, octet_length(bytes) as byte_size, updated_at`,
    [slug, mime, bytes],
  );
  sendJson(response, 200, rows[0]);
}

async function listMedia(response) {
  const { rows } = await pool.query(
    `select slug, mime, octet_length(bytes) as byte_size, updated_at
       from media order by slug`,
  );
  sendJson(response, 200, { media: rows });
}

/**
 * Accounts dashboard data for admins: one row per account plus totals. The
 * search runs in SQL so the page can filter without downloading every row.
 */
async function listUsers(url, response) {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const like = `%${q.toLowerCase()}%`;
  const filter = q
    ? 'where lower(email) like $1 or lower(name) like $1'
    : '';
  const params = q ? [like] : [];

  const { rows } = await pool.query(
    `select ${USER_COLUMNS}
       from users
       ${filter}
      order by suspended_at is not null, created_at desc, email asc
      limit 500`,
    params,
  );

  const { rows: totals } = await pool.query(
    `select count(*)::int as total,
            count(*) filter (where role = 'buyer')::int as buyers,
            count(*) filter (where role = 'seller')::int as sellers,
            count(*) filter (where role = 'admin')::int as admins,
            count(*) filter (where suspended_at is not null)::int as suspended
       from users`,
  );

  sendJson(response, 200, { users: rows.map(publicUser), stats: totals[0] });
}

/**
 * Shared checks for destructive account actions. Returns the target row, or
 * writes an error and returns null. Admin accounts are off limits from the
 * dashboard so a single mistake cannot lock every admin out of the app.
 */
async function accountTarget(userId, response, admin) {
  if (!UUID.test(userId)) {
    sendJson(response, 400, { error: 'invalid user id' });
    return null;
  }
  if (userId === admin.id) {
    sendJson(response, 409, { error: 'You cannot suspend or delete your own account.' });
    return null;
  }

  const { rows } = await pool.query(`select ${USER_COLUMNS} from users where id = $1`, [userId]);
  const row = rows[0];
  if (!row) {
    sendJson(response, 404, { error: 'no such user' });
    return null;
  }
  if (row.role === ADMIN) {
    sendJson(response, 409, { error: 'Admin accounts cannot be suspended or deleted here.' });
    return null;
  }
  return row;
}

async function suspendUser(userId, request, response, admin) {
  const body = await readJson(request);
  if (typeof body.suspended !== 'boolean') {
    sendJson(response, 400, { error: 'suspended must be true or false', field: 'suspended' });
    return;
  }

  const target = await accountTarget(userId, response, admin);
  if (!target) return;

  const { rows } = await pool.query(
    `update users
        set suspended_at = case when $1 then now() else null end, updated_at = now()
      where id = $2
      returning ${USER_COLUMNS}`,
    [body.suspended, userId],
  );

  if (body.suspended) {
    // Sign the account out everywhere straight away instead of waiting for the
    // session to expire or the next request to notice.
    await pool.query('delete from sessions where user_id = $1', [userId]);
  }

  sendJson(response, 200, { user: publicUser(rows[0]) });
}

async function deleteUser(userId, response, admin) {
  const target = await accountTarget(userId, response, admin);
  if (!target) return;

  // Sessions and any future owned rows cascade from the users table.
  await pool.query('delete from users where id = $1', [userId]);
  sendJson(response, 200, { deleted: userId, email: target.email });
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = request.method ?? 'GET';

  if (pathname === '/api/health') {
    const { rows } = await pool.query(
      'select now() as time, (select count(*)::int from media) as media, (select count(*)::int from users) as users',
    );
    sendJson(response, 200, { ok: true, db: rows[0] });
    return;
  }

  if (pathname === '/api/auth/signup' && method === 'POST') {
    await signup(request, response);
    return;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    await login(request, response);
    return;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await logout(request, response);
    return;
  }

  if (pathname === '/api/auth/admin-credentials' && method === 'POST') {
    if (rejectCrossOrigin(request, response)) return;
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    await updateAdminCredentials(request, response, admin);
    return;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = await findSession(request);
    if (!session) {
      sendJson(response, 401, { error: 'not signed in' });
      return;
    }
    sendJson(response, 200, { user: session.user });
    return;
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!(await requireAdmin(request, response))) return;
    await listUsers(url, response);
    return;
  }

  const adminUser = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUser && (method === 'PATCH' || method === 'POST' || method === 'DELETE')) {
    if (rejectCrossOrigin(request, response)) return;
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    const userId = decodeURIComponent(adminUser[1]);
    if (method === 'DELETE') {
      await deleteUser(userId, response, admin);
      return;
    }
    await suspendUser(userId, request, response, admin);
    return;
  }

  if (pathname === '/api/media' && method === 'GET') {
    await listMedia(response);
    return;
  }

  const match = pathname.match(/^\/api\/media\/([^/]+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    if (!SLUG.test(slug)) {
      sendJson(response, 400, { error: 'invalid slug' });
      return;
    }
    if (method === 'GET' || method === 'HEAD') {
      await getMedia(slug, request, response);
      return;
    }
    if (method === 'PUT' || method === 'POST') {
      const user = await currentUser(request, response);
      if (!user) return;
      if (!user.canSell) {
        sendJson(response, 403, { error: 'selling permission is not enabled for this account' });
        return;
      }
      if (!slug.startsWith('listing-')) {
        sendJson(response, 403, { error: 'brand assets are managed by the seed script' });
        return;
      }
      await putMedia(slug, request, response);
      return;
    }
    response.writeHead(405, { allow: 'GET, HEAD, PUT, POST' });
    response.end();
    return;
  }

  sendJson(response, 404, { error: 'no route', path: pathname });
}

async function ensureSchema() {
  const sql = await readFile(join(ROOT, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    const status = error.status ?? 500;
    console.error(`${request.method} ${request.url} failed:`, error.message);
    if (!response.headersSent) {
      sendJson(response, status, { error: status === 500 ? 'internal error' : error.message });
    } else {
      response.destroy();
    }
  });
});

try {
  await ensureSchema();
  await pool.query('delete from sessions where expires_at < now()');
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`media API on http://127.0.0.1:${PORT} (db: ${DATABASE_URL})`);
  });
} catch (error) {
  console.error(`media API could not start: ${error.message}`);
  console.error('Start the database first: npm run db:start');
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
