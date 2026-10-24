// MKT4.4: spam guard for viewing requests. A filled honeypot field is dropped
// without a trace, and guests are limited per email address and per IP.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

const accounts = testAccounts();
const tag = `spam-${Date.now().toString(36)}`;
const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

const viewing = (extra = {}) => ({
  listingId: 'house:harbor-loft',
  listingTitle: 'Harbor loft',
  name: 'Visitor',
  email: `${tag}-main@visitors.test`,
  description: 'Hello',
  date: day,
  time: '11:00',
  ...extra,
});

// One server for the file; each test comes from its own address (the limit is
// per address) and uses its own email addresses.
let server;
before(async () => {
  server = await startServer();
});
let nextIp = 10;
const newGuest = () => {
  const call = client(server.baseUrl);
  const ip = `198.51.100.${nextIp++}`;
  return (path, init = {}) => call(path, { ...init, headers: { ...init.headers, 'x-forwarded-for': ip } });
};

const stored = async (email) => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    return Number((await db.query('select count(*) from viewing_requests where email = $1', [email])).rows[0].count);
  } finally {
    await db.end();
  }
};

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('delete from viewing_requests where email like $1', ['%@visitors.test']);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await server?.stop();
});

test('a request with the hidden field filled is answered 201 but not stored', async () => {
  const guest = newGuest();
  const email = `${tag}-bot@visitors.test`;
  const res = await guest('/api/viewings', {
    method: 'POST',
    body: viewing({ email, website: 'http://spam.example' }),
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(await stored(email), 0);
  // An empty hidden field is a normal request.
  const ok = await guest('/api/viewings', { method: 'POST', body: viewing({ email: `${tag}-human@visitors.test`, website: '' }) });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(await stored(`${tag}-human@visitors.test`), 1);
});

test('the sixth request for one email in an hour gets 429 and is not stored', async () => {
  const guest = newGuest();
  const email = `${tag}-same@visitors.test`;
  for (let i = 1; i <= 5; i += 1) {
    const res = await guest('/api/viewings', { method: 'POST', body: viewing({ email }) });
    assert.equal(res.status, 201, `request ${i}: ${res.text}`);
  }
  const blocked = await guest('/api/viewings', { method: 'POST', body: viewing({ email }) });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(await stored(email), 5);

  const other = await guest('/api/viewings', { method: 'POST', body: viewing({ email: `${tag}-else@visitors.test` }) });
  assert.equal(other.status, 201, 'another email is not blocked');
});

test('one IP is limited across emails, and another IP is not', async () => {
  const guest = client(server.baseUrl);
  const from = (ip) => ({ 'x-forwarded-for': ip });
  let allowed = 0;
  let status = 201;
  for (let i = 0; i < 40 && status === 201; i += 1) {
    const res = await guest('/api/viewings', {
      method: 'POST',
      body: viewing({ email: `${tag}-ip${i}@visitors.test` }),
      headers: from('203.0.113.7'),
    });
    status = res.status;
    if (status === 201) allowed += 1;
  }
  assert.equal(status, 429);
  assert.ok(allowed >= 10 && allowed <= 30, `allowed ${allowed}`);

  const elsewhere = await guest('/api/viewings', {
    method: 'POST',
    body: viewing({ email: `${tag}-elsewhere@visitors.test` }),
    headers: from('203.0.113.8'),
  });
  assert.equal(elsewhere.status, 201);
});

test('invalid requests do not use up the limit', async () => {
  const guest = newGuest();
  const email = `${tag}-invalid@visitors.test`;
  for (let i = 0; i < 12; i += 1) {
    const res = await guest('/api/viewings', { method: 'POST', body: viewing({ email, time: '99:99' }) });
    assert.equal(res.status, 400);
  }
  const ok = await guest('/api/viewings', { method: 'POST', body: viewing({ email }) });
  assert.equal(ok.status, 201, ok.text);
});

test('the guest limit does not block a signed-in buyer', async () => {
  const ip = '198.51.100.250';
  const guest = client(server.baseUrl);
  const email = `${tag}-limited@visitors.test`;
  const same = { 'x-forwarded-for': ip };
  for (let i = 0; i < 5; i += 1) await guest('/api/viewings', { method: 'POST', body: viewing({ email }), headers: same });
  const blocked = await guest('/api/viewings', { method: 'POST', body: viewing({ email }), headers: same });
  assert.equal(blocked.status, 429);

  const buyer = client(server.baseUrl);
  assert.equal((await buyer('/api/auth/signup', { method: 'POST', body: accounts.next('buyer') })).status, 201);
  const res = await buyer('/api/viewings', { method: 'POST', body: viewing({ email }), headers: same });
  assert.equal(res.status, 201, res.text);
});
