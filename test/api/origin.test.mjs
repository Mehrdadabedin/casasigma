// Links in emails (password reset, seller dashboard) never follow Host or
// X-Forwarded-Host: a caller sets those freely and could point a real reset
// token at their own site. Unit tests for server/origin.mjs, plus the attack
// against a running server.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { appOrigin, configuredOrigin, DEV_APP_ORIGIN } from '../../server/origin.mjs';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

const req = (headers) => ({ headers });
const EVIL = { host: 'evil.example', 'x-forwarded-host': 'evil.example' };

test('production uses APP_ORIGIN and nothing from the request', () => {
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://casasigma.example/' };
  assert.equal(appOrigin(req({ ...EVIL, origin: 'https://evil.example' }), env), 'https://casasigma.example');
});

test('production without APP_ORIGIN gives no link at all', () => {
  assert.equal(appOrigin(req({ ...EVIL, origin: 'http://localhost:5173' }), { NODE_ENV: 'production' }), null);
});

test('development uses the page Origin only when it is this machine', () => {
  assert.equal(appOrigin(req({ origin: 'http://localhost:5180' }), {}), 'http://localhost:5180');
  assert.equal(appOrigin(req({ origin: 'http://127.0.0.1:5173' }), {}), 'http://127.0.0.1:5173');
  assert.equal(appOrigin(req({ ...EVIL, origin: 'https://evil.example' }), {}), DEV_APP_ORIGIN);
  assert.equal(appOrigin(req(EVIL), {}), DEV_APP_ORIGIN);
});

test('APP_ORIGIN must be an http(s) URL', () => {
  assert.equal(configuredOrigin({ APP_ORIGIN: 'javascript:alert(1)' }), null);
  assert.equal(configuredOrigin({ APP_ORIGIN: 'not a url' }), null);
  assert.equal(configuredOrigin({ APP_ORIGIN: 'https://casasigma.example/path' }), 'https://casasigma.example');
});

let dev;
let prod;
const accounts = testAccounts();

before(async () => {
  dev = await startServer();
  prod = await startServer({ APP_ORIGIN: 'https://casasigma.example' });
});

const listingIds = [];

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('delete from viewing_requests where email = $1', ['forged.origin@example.com']);
    await db.query('delete from listings where id = any($1::uuid[])', [listingIds]);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await dev?.stop();
  await prod?.stop();
});

async function resetLinkAfterAttack(server) {
  const victim = accounts.next('buyer');
  assert.equal((await client(server.baseUrl)('/api/auth/signup', { method: 'POST', body: victim })).status, 201);
  const attack = await client(server.baseUrl)('/api/auth/forgot', {
    method: 'POST',
    body: { email: victim.email },
    headers: { 'x-forwarded-host': 'evil.example' },
  });
  assert.equal(attack.status, 202);
  for (let i = 0; i < 20 && !server.mails().some((name) => name.endsWith('password-reset.txt')); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const file = server.mails().filter((name) => name.endsWith('password-reset.txt')).pop();
  return server.mail(file).match(/https?:\/\/\S+\/#\/reset\?token=/)?.[0];
}

test('a reset requested with a forged X-Forwarded-Host links to localhost, not the forged host', async () => {
  assert.equal(await resetLinkAfterAttack(dev), `${DEV_APP_ORIGIN}/#/reset?token=`);
});

test('with APP_ORIGIN set, the reset link uses it whatever the headers say', async () => {
  assert.equal(await resetLinkAfterAttack(prod), 'https://casasigma.example/#/reset?token=');
});

test('a booking sent with a forged Origin and X-Forwarded-Host gives the seller a localhost link', async () => {
  const seller = client(dev.baseUrl);
  assert.equal((await seller('/api/auth/signup', { method: 'POST', body: accounts.next('seller') })).status, 201);
  const created = await seller('/api/listings', {
    method: 'POST',
    body: { title: 'Origin test house', kind: 'House', city: 'Nerja', price: 250000, description: '' },
  });
  assert.equal(created.status, 201, created.text);
  listingIds.push(created.json.listing.id);
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  // Origin and X-Forwarded-Host agree, so the cross-site check lets it through.
  const booked = await client(dev.baseUrl)('/api/viewings', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
    body: { listingId: `listing:${created.json.listing.id}`, listingTitle: 'Origin test house',
      name: 'Forged Origin', email: 'forged.origin@example.com', description: '', date: day, time: '10:00' },
  });
  assert.equal(booked.status, 201, booked.text);
  for (let i = 0; i < 20 && !dev.mails().some((name) => name.endsWith('viewing-seller.txt')); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const text = dev.mail(dev.mails().filter((name) => name.endsWith('viewing-seller.txt')).pop());
  assert.ok(text.includes(`${DEV_APP_ORIGIN}/#/sell`), text);
  assert.ok(!text.includes('evil.example'), 'the seller mail carries the forged host');
});
