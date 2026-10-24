// MKT4.1: anyone can send a viewing request without signing in. A guest's
// request is stored without an owner, and nobody can read or cancel it
// through the account endpoints.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const emailTag = `guest-${Date.now().toString(36)}`;

const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const viewing = (extra = {}) => ({
  listingId: 'house:casa-do-fogo',
  listingTitle: 'Casa do Fogo',
  name: 'Guest Visitor',
  email: `${emailTag}@guests.test`,
  description: 'Saturday if possible',
  date: day,
  time: '11:00',
  ...extra,
});

const db = async (sql, params) => {
  const conn = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await conn.connect();
  try {
    return (await conn.query(sql, params)).rows;
  } finally {
    await conn.end();
  }
};

before(async () => {
  server = await startServer();
});

after(async () => {
  await db('delete from viewing_requests where email like $1', ['%@guests.test']);
  await accounts.cleanup();
  await server?.stop();
});

test('a guest can send a viewing request: 201, stored with no owner', async () => {
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing() });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.request.status, 'Requested');
  assert.equal(res.json.request.listingId, 'house:casa-do-fogo');
  const [row] = await db('select user_id from viewing_requests where id = $1', [res.json.request.id]);
  assert.equal(row.user_id, null);
});

test('a guest cannot list or cancel requests', async () => {
  const guest = client(server.baseUrl);
  const made = await guest('/api/viewings', { method: 'POST', body: viewing() });
  assert.equal((await guest('/api/viewings')).status, 401);
  const cancel = await guest(`/api/viewings/${made.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'Cancelled' },
  });
  assert.equal(cancel.status, 401);
  const [row] = await db('select status from viewing_requests where id = $1', [made.json.request.id]);
  assert.equal(row.status, 'Requested');
});

test('a signed-in buyer sees only their own requests and cannot cancel a guest request', async () => {
  const guest = client(server.baseUrl);
  const guestRequest = (await guest('/api/viewings', { method: 'POST', body: viewing() })).json.request;

  const buyer = client(server.baseUrl);
  assert.equal((await buyer('/api/auth/signup', { method: 'POST', body: accounts.next('buyer') })).status, 201);
  const own = (await buyer('/api/viewings', { method: 'POST', body: viewing({ listingId: 'house:other', listingTitle: 'Other' }) })).json.request;

  const mine = (await buyer('/api/viewings')).json.requests.map((row) => row.id);
  assert.deepEqual(mine, [own.id]);
  assert.ok(!mine.includes(guestRequest.id));

  const cancel = await buyer(`/api/viewings/${guestRequest.id}`, { method: 'PATCH', body: { status: 'Cancelled' } });
  assert.equal(cancel.status, 404);
});

test('a guest request is checked like any other: bad email, name, date and time give 400', async () => {
  const guest = client(server.baseUrl);
  for (const [extra, field] of [
    [{ email: 'not-an-email' }, 'email'],
    [{ name: 'x' }, 'name'],
    [{ date: 'tomorrow' }, 'date'],
    [{ time: '25:00' }, 'time'],
    [{ listingId: '' }, 'listing'],
  ]) {
    const res = await guest('/api/viewings', { method: 'POST', body: viewing(extra) });
    assert.equal(res.status, 400, field);
    assert.equal(res.json.field, field);
  }
});

test('a request from another origin is refused', async () => {
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', {
    method: 'POST',
    body: viewing(),
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
});
