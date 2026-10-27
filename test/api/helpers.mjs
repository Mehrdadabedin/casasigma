// Shared helpers for the API tests: boot the real server as a child process
// against the test database, make requests with a cookie jar, and create
// throwaway accounts with random passwords.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server', 'index.mjs');
const DEV_DATABASE_URL = 'postgres://casasigma@127.0.0.1:5434/casasigma';
const START_TIMEOUT_MS = 15_000;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://casasigma@127.0.0.1:5434/casasigma_test';

/**
 * Refuse to run against anything that looks like the dev or a real database:
 * the tests create and delete accounts.
 */
function assertTestDatabase(url) {
  let name;
  try {
    name = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid postgres:// URL');
  }
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run: the test database name must contain "test" (got "${name}")`);
  }
  if (url === process.env.DATABASE_URL || url === DEV_DATABASE_URL) {
    throw new Error('Refusing to run: TEST_DATABASE_URL must differ from DATABASE_URL');
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Start server/index.mjs on a free port and wait until /api/health answers.
 * Each server gets its own temporary mail outbox and never sees real mail
 * settings; `env` overrides (for example `NODE_ENV: 'production'`) go on top.
 */
export async function startServer(env = {}) {
  assertTestDatabase(TEST_DATABASE_URL);
  const port = await freePort();
  const outbox = mkdtempSync(join(tmpdir(), 'casasigma-outbox-'));
  const childEnv = {
    ...process.env,
    API_PORT: String(port),
    DATABASE_URL: TEST_DATABASE_URL,
    MAIL_OUTBOX_DIR: outbox,
    ...env,
  };
  delete childEnv.RESEND_API_KEY;
  delete childEnv.MAIL_FROM;
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once('exit', resolve));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      // Any HTTP answer means the server is listening; the tests judge the status.
      await fetch(`${baseUrl}/api/health`);
      return {
        baseUrl,
        outbox,
        /** Files in the outbox, oldest first. */
        mails: () => readdirSync(outbox).sort(),
        mail: (name) => readFileSync(join(outbox, name), 'utf8'),
        /** Everything the server has printed so far. */
        output: () => output,
        async stop() {
          if (child.exitCode === null) child.kill('SIGTERM');
          await exited;
          rmSync(outbox, { recursive: true, force: true });
        },
      };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  child.kill('SIGKILL');
  await exited;
  throw new Error(`API did not start on port ${port}:\n${output}`);
}

/** A tiny fetch wrapper that keeps the cs_session cookie between calls. */
export function client(baseUrl) {
  let cookie = '';
  return async function request(path, { method = 'GET', body, headers = {} } = {}) {
    // Bytes (a photo upload) go as they are; anything else is sent as JSON.
    const raw = body instanceof Uint8Array;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined || raw ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined || raw ? body : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON; callers can still check the status.
    }
    return { status: response.status, headers: response.headers, json, text };
  };
}

/** Every account a test file creates shares one random email domain. */
export function testAccounts() {
  const domain = `run-${randomBytes(6).toString('hex')}.test`;
  let count = 0;
  return {
    domain,
    next(role = 'buyer') {
      count += 1;
      return {
        email: `user${count}@${domain}`,
        name: `Test User ${count}`,
        role,
        password: randomBytes(18).toString('base64url'),
      };
    },
    /** Delete this file's accounts; sessions cascade. */
    async cleanup() {
      const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await db.connect();
      try {
        await db.query('delete from users where lower(email) like $1', [`%@${domain}`]);
      } finally {
        await db.end();
      }
    },
  };
}
