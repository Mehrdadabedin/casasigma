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
import { mailConfigured, sendPasswordResetEmail } from './mail.mjs';

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
/** Photo slots per listing; slot 1 is the cover. Keep in step with db/schema.sql. */
const MAX_PHOTO_SLOTS = 5;
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

// A reset request mails real email, so it is throttled harder than sign-in and
// kept in its own map: a locked-out login must not block a reset, or the other
// way round.
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_REQUESTS = 5;
const RESET_TOKEN_MS = 60 * 60 * 1000;

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const loginFailures = new Map();
const resetRequests = new Map();

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

function isResetThrottled(key) {
  const entry = resetRequests.get(key);
  if (!entry) return false;
  if (Date.now() - entry.startedAt > RESET_WINDOW_MS) {
    resetRequests.delete(key);
    return false;
  }
  return entry.count >= RESET_MAX_REQUESTS;
}

function recordResetRequest(key) {
  const entry = resetRequests.get(key);
  if (!entry || Date.now() - entry.startedAt > RESET_WINDOW_MS) {
    resetRequests.set(key, { count: 1, startedAt: Date.now() });
  } else {
    entry.count += 1;
  }
  if (resetRequests.size > 1000) {
    for (const [candidate, value] of resetRequests) {
      if (Date.now() - value.startedAt > RESET_WINDOW_MS) resetRequests.delete(candidate);
    }
  }
}

/**
 * Where the reset link points. The browser's Origin is the page the person is
 * actually on (Vite dev serves :5173 while the API answers on :8787), so it is
 * preferred; APP_ORIGIN covers server-side callers such as curl.
 */
function appOrigin(request) {
  const configured = String(process.env.APP_ORIGIN ?? '').replace(/\/+$/, '');
  if (configured) return configured;
  const origin = request.headers.origin;
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // fall through to the request host
    }
  }
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '');
  return host ? `http://${host}` : 'http://localhost:5173';
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
 * Send a single-use reset link. Always answers `202` for a well-formed address,
 * whether or not it belongs to an account, so the form cannot be used to find
 * out who has signed up. Suspended accounts are skipped silently.
 */
async function forgotPassword(request, response) {
  if (rejectCrossOrigin(request, response)) return;
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();

  if (!EMAIL.test(email) || email.length > 254) {
    sendJson(response, 400, { error: 'Enter a valid email address.', field: 'email' });
    return;
  }

  const key = `${clientIp(request)}|reset`;
  if (isResetThrottled(key)) {
    response.setHeader('retry-after', '3600');
    sendJson(response, 429, { error: 'Too many reset requests. Try again later.' });
    return;
  }
  recordResetRequest(key);

  const { rows } = await pool.query(
    `select id, email, name
       from users
      where lower(email) = lower($1) and suspended_at is null`,
    [email],
  );
  const user = rows[0];

  if (user) {
    const token = randomBytes(32).toString('base64url');
    // One live link at a time: asking again retires the previous email.
    await pool.query('delete from password_resets where user_id = $1 and used_at is null', [
      user.id,
    ]);
    await pool.query(
      `insert into password_resets (user_id, token_hash, expires_at)
       values ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
      [user.id, tokenHash(token), String(RESET_TOKEN_MS)],
    );

    const resetUrl = `${appOrigin(request)}/#/reset?token=${encodeURIComponent(token)}`;
    if (mailConfigured()) {
      try {
        await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
      } catch (error) {
        // A mail outage must not turn into a different answer for a real
        // address; log it and let the person ask again.
        console.error(`password reset email to ${user.email} failed: ${error.message}`);
      }
    } else {
      console.log(`[mail not configured] password reset for ${user.email}: ${resetUrl}`);
    }
  }

  sendJson(response, 202, { ok: true });
}

/** Redeem a reset link: replace the password and sign every device out. */
async function resetPassword(request, response) {
  if (rejectCrossOrigin(request, response)) return;
  const body = await readJson(request);
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');

  if (password.length < 10 || password.length > 200) {
    sendJson(response, 400, {
      error: 'Use a password of at least 10 characters.',
      field: 'password',
    });
    return;
  }

  const invalid = () =>
    sendJson(response, 400, {
      error: 'This reset link has expired or was already used.',
      field: 'token',
    });

  if (!token || token.length > 200) {
    invalid();
    return;
  }

  const { rows } = await pool.query(
    `select id, user_id
       from password_resets
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) {
    invalid();
    return;
  }

  const passwordHash = await hashPassword(password);
  await pool.query(
    `update users
        set password_hash = $1, must_set_password = false, updated_at = now()
      where id = $2`,
    [passwordHash, row.user_id],
  );
  await pool.query('update password_resets set used_at = now() where id = $1', [row.id]);
  // Anyone holding the old password loses their session too.
  await pool.query('delete from sessions where user_id = $1', [row.user_id]);

  sendJson(response, 200, { ok: true });
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

/** Towns for the city filter, with how many published listings each has. */
async function listCities(response) {
  const { rows } = await pool.query(
    `select c.id, c.name, count(l.id)::int as listings
       from cities c
       left join listings l on lower(l.city) = lower(c.name)
      group by c.id, c.name
      order by c.name asc`,
  );
  sendJson(response, 200, { cities: rows });
}

function publicListing(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    city: row.city,
    price: row.price,
    description: row.description,
    sellerName: row.seller_name ?? null,
    // `{ slot, slug }` per photo so a removed middle slot never makes slot 4
    // look like slot 3. Ordered by slot; empty until the seller uploads one.
    photos: Array.isArray(row.photos) ? row.photos : [],
    createdAt: row.created_at,
  };
}

/**
 * What a signed-out visitor may see of a listing (MKT1.3): enough for a locked
 * card and for choosing it on /book, but no price, description, seller or
 * photos. Listing photos already answer 401 without a session.
 */
function guestListing(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    city: row.city,
    locked: true,
    photos: [],
    createdAt: row.created_at,
  };
}

/**
 * Listing columns plus the ordered photo slugs. `array(...)` keeps slots in
 * position order and still yields an empty array when nothing is uploaded.
 */
const LISTING_SELECT = `l.*, u.name as seller_name,
  coalesce((select json_agg(json_build_object('slot', lp.position, 'slug', lp.media_slug)
                            order by lp.position)
              from listing_photos lp
             where lp.listing_id = l.id), '[]'::json) as photos`;

const LISTING_KINDS = new Set(['Apartment', 'House', 'Loft', 'Villa', 'Restaurant']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function createListing(request, response) {
  const user = await currentUser(request, response);
  if (!user) return;
  if (!user.canSell) {
    sendJson(response, 403, { error: 'selling permission is not enabled for this account' });
    return;
  }

  const body = await readJson(request);
  const title = String(body.title ?? '').trim();
  const kind = String(body.kind ?? '').trim();
  // Town names are stored as typed, minus surrounding space, so "nerja" and
  // "Nerja" are the same city thanks to the lower(name) index.
  const city = String(body.city ?? '').trim().replace(/\s+/g, ' ');
  const price = Number(body.price);
  const description = String(body.description ?? '').trim();

  if (title.length < 4 || title.length > 120) {
    sendJson(response, 400, { error: 'Give the listing a title (4–120 characters).', field: 'title' });
    return;
  }
  if (!LISTING_KINDS.has(kind)) {
    sendJson(response, 400, { error: 'Choose what kind of listing this is.', field: 'kind' });
    return;
  }
  if (city.length < 2 || city.length > 80) {
    sendJson(response, 400, { error: 'Enter the town or city (2–80 characters).', field: 'city' });
    return;
  }
  if (!Number.isInteger(price) || price < 0 || price > 100_000_000) {
    sendJson(response, 400, { error: 'Enter the asking price as a whole number of euros.', field: 'price' });
    return;
  }
  if (description.length > 2000) {
    sendJson(response, 400, { error: 'Keep the description under 2000 characters.', field: 'description' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // The town is registered first: a new city becomes selectable for everyone
    // the moment a seller lists in it.
    await client.query(
      'insert into cities (name) values ($1) on conflict (lower(name)) do nothing',
      [city],
    );
    const { rows } = await client.query(
      `insert into listings (seller_id, title, kind, city, price, description)
       values ($1, $2, $3, $4, $5, $6)
       returning id, title, kind, city, price, description, created_at`,
      [user.id, title, kind, city, price, description],
    );
    await client.query('commit');
    sendJson(response, 201, {
      listing: publicListing({ ...rows[0], seller_name: user.name, photos: [] }),
    });
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function listListings(request, response, url) {
  const mine = url.searchParams.get('mine') === '1';
  const session = await findSession(request);
  if (mine && !session) {
    sendJson(response, 401, { error: 'not signed in' });
    return;
  }

  const { rows } = mine
    ? await pool.query(
        `select ${LISTING_SELECT}
           from listings l left join users u on u.id = l.seller_id
          where l.seller_id = $1
          order by l.created_at desc limit 200`,
        [session.user.id],
      )
    : await pool.query(
        `select ${LISTING_SELECT}
           from listings l left join users u on u.id = l.seller_id
          where u.suspended_at is null or u.id is null
          order by l.created_at desc limit 200`,
      );

  sendJson(response, 200, { listings: rows.map(session ? publicListing : guestListing) });
}

/** One published listing, with its photos, for the public detail page. */
async function getListing(listingId, response) {
  if (!UUID.test(listingId)) {
    sendJson(response, 400, { error: 'invalid listing id' });
    return;
  }
  const { rows } = await pool.query(
    `select ${LISTING_SELECT}
       from listings l left join users u on u.id = l.seller_id
      where l.id = $1 and (u.suspended_at is null or u.id is null)`,
    [listingId],
  );
  if (!rows[0]) {
    sendJson(response, 404, { error: 'no such listing' });
    return;
  }
  sendJson(response, 200, { listing: publicListing(rows[0]) });
}

/** Load a listing and make sure the caller owns it; writes the error itself. */
async function ownedListing(listingId, user, response) {
  if (!UUID.test(listingId)) {
    sendJson(response, 400, { error: 'invalid listing id' });
    return null;
  }
  const { rows } = await pool.query(
    `select ${LISTING_SELECT}
       from listings l left join users u on u.id = l.seller_id
      where l.id = $1`,
    [listingId],
  );
  const row = rows[0];
  if (!row) {
    sendJson(response, 404, { error: 'no such listing' });
    return null;
  }
  if (row.seller_id !== user.id) {
    sendJson(response, 404, { error: 'no such listing' });
    return null;
  }
  return row;
}

async function reloadListing(listingId) {
  const { rows } = await pool.query(
    `select ${LISTING_SELECT}
       from listings l left join users u on u.id = l.seller_id
      where l.id = $1`,
    [listingId],
  );
  return rows[0] ? publicListing(rows[0]) : null;
}

/**
 * Store one of the five listing photos and point its slot at the new file. The
 * old slug in that slot is deleted afterwards, so a replacement leaves no
 * orphaned bytes in `media`.
 */
async function uploadListingPhoto(listingId, request, response, url) {
  const user = await currentUser(request, response);
  if (!user) return;
  if (!user.canSell) {
    sendJson(response, 403, { error: 'selling permission is not enabled for this account' });
    return;
  }

  const slot = Number(url.searchParams.get('slot'));
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PHOTO_SLOTS) {
    sendJson(response, 400, { error: `slot must be a whole number from 1 to ${MAX_PHOTO_SLOTS}`, field: 'slot' });
    return;
  }

  const row = await ownedListing(listingId, user, response);
  if (!row) return;

  const mime = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mime)) {
    sendJson(response, 415, { error: 'unsupported media type', allowed: [...MIME_TYPES] });
    return;
  }
  const bytes = await readBody(request);
  if (bytes.length === 0) {
    sendJson(response, 400, { error: 'empty body' });
    return;
  }

  const slug = `listing-${randomBytes(8).toString('hex')}`;
  const previous = row.photos.find((photo) => photo.slot === slot)?.slug ?? null;

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('insert into media (slug, mime, bytes) values ($1, $2, $3)', [
      slug,
      mime,
      bytes,
    ]);
    await client.query(
      `insert into listing_photos (listing_id, media_slug, position)
       values ($1, $2, $3)
       on conflict (listing_id, position) do update
          set media_slug = excluded.media_slug, created_at = now()`,
      [row.id, slug, slot],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (previous && previous !== slug) {
    await pool.query('delete from media where slug = $1', [previous]);
  }

  sendJson(response, 200, { listing: await reloadListing(row.id) });
}

async function removeListingPhoto(listingId, slot, request, response) {
  const user = await currentUser(request, response);
  if (!user) return;

  const position = Number(slot);
  if (!Number.isInteger(position) || position < 1 || position > MAX_PHOTO_SLOTS) {
    sendJson(response, 400, { error: `slot must be a whole number from 1 to ${MAX_PHOTO_SLOTS}`, field: 'slot' });
    return;
  }

  const row = await ownedListing(listingId, user, response);
  if (!row) return;

  const { rows } = await pool.query(
    `delete from listing_photos where listing_id = $1 and position = $2
      returning media_slug`,
    [row.id, position],
  );
  if (!rows[0]) {
    sendJson(response, 404, { error: 'no photo in that slot' });
    return;
  }
  await pool.query('delete from media where slug = $1', [rows[0].media_slug]);
  sendJson(response, 200, { listing: await reloadListing(row.id) });
}

// `visit_date` is cast to text: pg turns a date into a JS Date at local
// midnight, and toISOString() would shift the day west of UTC.
const VIEWING_COLUMNS =
  'id, user_id, listing_id, listing_title, name, email, description, visit_date::text as visit_date, visit_time, status, created_at';

function publicViewing(row) {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    name: row.name,
    email: row.email,
    description: row.description,
    date: row.visit_date,
    time: row.visit_time,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Contact + calendar request from /book. Guests may send one; it just stays unowned. */
async function createViewing(request, response) {
  const body = await readJson(request);
  const session = await findSession(request);

  const listingId = String(body.listingId ?? '').trim().slice(0, 120);
  const listingTitle = String(body.listingTitle ?? '').trim().slice(0, 160);
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const description = String(body.description ?? '').trim();
  const date = String(body.date ?? '').trim();
  const time = String(body.time ?? '').trim();

  if (!listingId || !listingTitle) {
    sendJson(response, 400, { error: 'Choose the listing you want to see.', field: 'listing' });
    return;
  }
  if (name.length < 2 || name.length > 80) {
    sendJson(response, 400, { error: 'Enter your name (2–80 characters).', field: 'name' });
    return;
  }
  if (!EMAIL.test(email) || email.length > 254) {
    sendJson(response, 400, { error: 'Enter a valid email address.', field: 'email' });
    return;
  }
  if (description.length > 2000) {
    sendJson(response, 400, { error: 'Keep the message under 2000 characters.', field: 'description' });
    return;
  }
  if (!DATE.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    sendJson(response, 400, { error: 'Pick a day for the meeting.', field: 'date' });
    return;
  }
  if (!TIME.test(time)) {
    sendJson(response, 400, { error: 'Pick a time for the meeting.', field: 'time' });
    return;
  }

  const { rows } = await pool.query(
    `insert into viewing_requests
       (user_id, listing_id, listing_title, name, email, description, visit_date, visit_time)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${VIEWING_COLUMNS}`,
    [session?.user.id ?? null, listingId, listingTitle, name, email, description, date, time],
  );
  sendJson(response, 201, { request: publicViewing(rows[0]) });
}

async function listViewings(request, response) {
  const user = await currentUser(request, response);
  if (!user) return;

  const { rows } = await pool.query(
    `select ${VIEWING_COLUMNS} from viewing_requests
      where user_id = $1
      order by visit_date asc, visit_time asc, created_at desc
      limit 200`,
    [user.id],
  );
  sendJson(response, 200, { requests: rows.map(publicViewing) });
}

async function cancelViewing(requestId, request, response) {
  if (!UUID.test(requestId)) {
    sendJson(response, 400, { error: 'invalid request id' });
    return;
  }
  const body = await readJson(request);
  if (body.status !== 'Cancelled') {
    sendJson(response, 400, { error: 'Only cancelling a request is supported.', field: 'status' });
    return;
  }
  const user = await currentUser(request, response);
  if (!user) return;

  const { rows } = await pool.query(
    `update viewing_requests set status = 'Cancelled'
      where id = $1 and user_id = $2
      returning ${VIEWING_COLUMNS}`,
    [requestId, user.id],
  );
  if (!rows[0]) {
    sendJson(response, 404, { error: 'no such viewing request' });
    return;
  }
  sendJson(response, 200, { request: publicViewing(rows[0]) });
}

function publicProfile(row, { owner = false } = {}) {
  const visible = owner || row.photo_status === 'approved';
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    phone: row.phone,
    company: row.company,
    lookingFor: row.looking_for,
    bio: row.bio,
    // The slug reaches the browser for the owner (so they can see their own
    // submission) and for everyone else only once it is approved.
    photoSlug: visible ? row.photo_slug ?? null : null,
    photoStatus: row.photo_status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  };
}

function profileKind(user) {
  return user.role === 'seller' ? 'seller' : user.role === 'buyer' ? 'buyer' : null;
}

async function getProfile(request, response) {
  const user = await currentUser(request, response);
  if (!user) return;
  const { rows } = await pool.query('select * from profiles where user_id = $1', [user.id]);
  sendJson(response, 200, { profile: rows[0] ? publicProfile(rows[0], { owner: true }) : null });
}

async function saveProfile(request, response) {
  const user = await currentUser(request, response);
  if (!user) return;
  const kind = profileKind(user);
  if (!kind) {
    sendJson(response, 400, { error: 'Admin accounts do not have a public profile.' });
    return;
  }

  const body = await readJson(request);
  const displayName = String(body.displayName ?? '').trim();
  const phone = body.phone == null ? null : String(body.phone).trim().slice(0, 40) || null;
  const company = body.company == null ? null : String(body.company).trim().slice(0, 120) || null;
  const lookingFor =
    body.lookingFor == null ? null : String(body.lookingFor).trim().slice(0, 160) || null;
  const bio = body.bio == null ? null : String(body.bio).trim().slice(0, 600) || null;

  if (displayName.length < 2 || displayName.length > 80) {
    sendJson(response, 400, { error: 'Enter a display name (2–80 characters).', field: 'displayName' });
    return;
  }

  const { rows } = await pool.query(
    `insert into profiles (user_id, kind, display_name, phone, company, looking_for, bio)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update
        set kind = excluded.kind,
            display_name = excluded.display_name,
            phone = excluded.phone,
            company = excluded.company,
            looking_for = excluded.looking_for,
            bio = excluded.bio,
            updated_at = now()
      returning *`,
    [user.id, kind, displayName, phone, company, lookingFor, bio],
  );
  sendJson(response, 200, { profile: publicProfile(rows[0], { owner: true }) });
}

/**
 * Store a profile photo in `media` and park it on the admin queue. The slug is
 * random so a re-upload cannot be guessed from the account, and the old row is
 * dropped after the new one is attached.
 */
async function uploadProfilePhoto(request, response) {
  const user = await currentUser(request, response);
  if (!user) return;
  const kind = profileKind(user);
  if (!kind) {
    sendJson(response, 400, { error: 'Admin accounts do not have a public profile.' });
    return;
  }

  const mime = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mime)) {
    sendJson(response, 415, { error: 'unsupported media type', allowed: [...MIME_TYPES] });
    return;
  }

  const bytes = await readBody(request);
  if (bytes.length === 0) {
    sendJson(response, 400, { error: 'empty body' });
    return;
  }

  const { rows: existing } = await pool.query(
    'select photo_slug from profiles where user_id = $1',
    [user.id],
  );
  const previousSlug = existing[0]?.photo_slug ?? null;

  const slug = `profile-${randomBytes(8).toString('hex')}`;
  await pool.query('insert into media (slug, mime, bytes) values ($1, $2, $3)', [
    slug,
    mime,
    bytes,
  ]);

  const { rows } = await pool.query(
    `insert into profiles (user_id, kind, display_name, photo_slug, photo_status, submitted_at)
     values ($1, $2, $3, $4, 'pending', now())
     on conflict (user_id) do update
        set photo_slug = excluded.photo_slug,
            photo_status = 'pending',
            submitted_at = now(),
            reviewed_at = null,
            reviewed_by = null,
            updated_at = now()
      returning *`,
    [user.id, kind, user.name.slice(0, 80), slug],
  );

  // Drop the superseded file once the new one is attached; a rejected photo is
  // replaced the same way, so the queue never shows two portraits per account.
  if (previousSlug && previousSlug !== slug) {
    await pool.query('delete from media where slug = $1', [previousSlug]);
  }

  sendJson(response, 200, { profile: publicProfile(rows[0], { owner: true }) });
}

/** Approved profiles for the public people strip. */
async function listPublicProfiles(response) {
  const { rows } = await pool.query(
    `select p.*
       from profiles p
       join users u on u.id = p.user_id
      where p.photo_status = 'approved' and p.photo_slug is not null
        and u.suspended_at is null
      order by p.reviewed_at desc nulls last
      limit 12`,
  );
  sendJson(response, 200, {
    profiles: rows.map((row) => ({
      kind: row.kind,
      displayName: row.display_name,
      company: row.company,
      bio: row.bio,
      photoSlug: row.photo_slug,
    })),
  });
}

async function listPhotoQueue(response) {
  const { rows } = await pool.query(
    `select p.*, u.email as account_email, u.role as account_role
       from profiles p
       join users u on u.id = p.user_id
      where p.photo_slug is not null
      order by (p.photo_status = 'pending') desc, p.submitted_at desc nulls last
      limit 200`,
  );
  sendJson(response, 200, {
    photos: rows.map((row) => ({
      ...publicProfile(row),
      accountEmail: row.account_email,
      accountRole: row.account_role,
      photoSlug: row.photo_slug,
    })),
  });
}

async function reviewPhoto(profileId, request, response, admin) {
  if (!UUID.test(profileId)) {
    sendJson(response, 400, { error: 'invalid profile id' });
    return;
  }
  const body = await readJson(request);
  const status = String(body.status ?? '');
  if (status !== 'approved' && status !== 'rejected') {
    sendJson(response, 400, { error: 'status must be approved or rejected', field: 'status' });
    return;
  }

  const { rows } = await pool.query(
    `update profiles
        set photo_status = $1, reviewed_at = now(), reviewed_by = $2, updated_at = now()
      where id = $3 and photo_slug is not null
      returning *`,
    [status, admin.id, profileId],
  );
  const row = rows[0];
  if (!row) {
    sendJson(response, 404, { error: 'no such photo' });
    return;
  }
  sendJson(response, 200, {
    photo: { ...publicProfile(row), photoSlug: row.photo_slug },
  });
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

  if (pathname === '/api/auth/forgot' && method === 'POST') {
    await forgotPassword(request, response);
    return;
  }

  if (pathname === '/api/auth/reset' && method === 'POST') {
    await resetPassword(request, response);
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

  if (pathname === '/api/cities' && method === 'GET') {
    await listCities(response);
    return;
  }

  // Seller listings are not public: the marketplace is for signed-in accounts,
  // so guests get 401 here and a sign-in prompt in the UI.
  if (pathname === '/api/listings' && method === 'GET') {
    // Guests get the redacted list (guestListing): locked cards and the /book
    // picker need it. `?mine=1` still answers 401 without a session.
    await listListings(request, response, url);
    return;
  }

  if (pathname === '/api/listings' && method === 'POST') {
    if (rejectCrossOrigin(request, response)) return;
    await createListing(request, response);
    return;
  }

  const listingMatch = pathname.match(/^\/api\/listings\/([^/]+)$/);
  if (listingMatch && method === 'GET') {
    if (!(await currentUser(request, response))) return;
    await getListing(decodeURIComponent(listingMatch[1]), response);
    return;
  }

  const listingPhotosMatch = pathname.match(/^\/api\/listings\/([^/]+)\/photos$/);
  if (listingPhotosMatch && method === 'POST') {
    if (rejectCrossOrigin(request, response)) return;
    await uploadListingPhoto(decodeURIComponent(listingPhotosMatch[1]), request, response, url);
    return;
  }

  const listingPhotoMatch = pathname.match(/^\/api\/listings\/([^/]+)\/photos\/([^/]+)$/);
  if (listingPhotoMatch && method === 'DELETE') {
    if (rejectCrossOrigin(request, response)) return;
    await removeListingPhoto(
      decodeURIComponent(listingPhotoMatch[1]),
      decodeURIComponent(listingPhotoMatch[2]),
      request,
      response,
    );
    return;
  }

  if (pathname === '/api/viewings' && method === 'GET') {
    await listViewings(request, response);
    return;
  }

  if (pathname === '/api/viewings' && method === 'POST') {
    if (rejectCrossOrigin(request, response)) return;
    await createViewing(request, response);
    return;
  }

  const viewingMatch = pathname.match(/^\/api\/viewings\/([^/]+)$/);
  if (viewingMatch && method === 'PATCH') {
    if (rejectCrossOrigin(request, response)) return;
    await cancelViewing(decodeURIComponent(viewingMatch[1]), request, response);
    return;
  }

  if (pathname === '/api/profile' && method === 'GET') {
    await getProfile(request, response);
    return;
  }

  if (pathname === '/api/profile' && method === 'PUT') {
    if (rejectCrossOrigin(request, response)) return;
    await saveProfile(request, response);
    return;
  }

  if (pathname === '/api/profile/photo' && method === 'POST') {
    if (rejectCrossOrigin(request, response)) return;
    await uploadProfilePhoto(request, response);
    return;
  }

  if (pathname === '/api/profiles' && method === 'GET') {
    await listPublicProfiles(response);
    return;
  }

  if (pathname === '/api/admin/photos' && method === 'GET') {
    if (!(await requireAdmin(request, response))) return;
    await listPhotoQueue(response);
    return;
  }

  const photoMatch = pathname.match(/^\/api\/admin\/photos\/([^/]+)$/);
  if (photoMatch && method === 'PATCH') {
    if (rejectCrossOrigin(request, response)) return;
    const admin = await requireAdmin(request, response);
    if (!admin) return;
    await reviewPhoto(decodeURIComponent(photoMatch[1]), request, response, admin);
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
      // Listing photography is part of the gated marketplace; brand marks and
      // approved profile portraits stay public.
      if (slug.startsWith('listing-') && !(await currentUser(request, response))) return;
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
  await pool.query('delete from password_resets where expires_at < now()');
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
