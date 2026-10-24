// MKT4.2: a viewing request for a seller's listing reaches that seller, and only
// that seller. The server decides the recipient from the listing; the browser
// cannot name one.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const tag = `own-${Date.now().toString(36)}`;
const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

const viewing = (listingId, extra = {}) => ({
  listingId,
  listingTitle: 'Some listing',
  name: 'Visitor',
  email: `${tag}@visitors.test`,
  description: 'Hello',
  date: day,
  time: '11:00',
  ...extra,
});

async function signedIn(role) {
  const call = client(server.baseUrl);
  const res = await call('/api/auth/signup', { method: 'POST', body: accounts.next(role) });
  assert.equal(res.status, 201, res.text);
  return { call, id: res.json.user.id };
}

const newListing = async (seller, title) => {
  const res = await seller.call('/api/listings', {
    method: 'POST',
    body: { title, kind: 'Villa', city: 'Mijas', price: 300000, description: '' },
  });
  assert.equal(res.status, 201, res.text);
  return res.json.listing.id;
};

let sellerA;
let sellerB;
let buyer;
let guest;
let listingA;
let listingB;
let reqA;
let reqB;
let reqDemo;

before(async () => {
  server = await startServer();
  sellerA = await signedIn('seller');
  sellerB = await signedIn('seller');
  buyer = await signedIn('buyer');
  guest = client(server.baseUrl);
  listingA = await newListing(sellerA, 'Listing of A');
  listingB = await newListing(sellerB, 'Listing of B');
  reqA = (await guest('/api/viewings', { method: 'POST', body: viewing(`listing:${listingA}`) })).json.request;
  reqB = (await buyer.call('/api/viewings', { method: 'POST', body: viewing(`listing:${listingB}`) })).json.request;
  reqDemo = (await guest('/api/viewings', { method: 'POST', body: viewing('house:harbor-loft') })).json.request;
});

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('delete from viewing_requests where email like $1', ['%@visitors.test']);
    await db.query('delete from listings where id = any($1::uuid[])', [[listingA, listingB]]);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await server?.stop();
});

test('a seller sees only the requests for their own listings', async () => {
  const a = await sellerA.call('/api/seller/viewings');
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.json.requests.map((row) => row.id), [reqA.id]);
  assert.equal(a.json.requests[0].email, `${tag}@visitors.test`);

  const b = await sellerB.call('/api/seller/viewings');
  assert.deepEqual(b.json.requests.map((row) => row.id), [reqB.id]);
});

test('a request for a demo listing reaches no seller', async () => {
  for (const seller of [sellerA, sellerB]) {
    const res = await seller.call('/api/seller/viewings');
    assert.ok(!res.json.requests.some((row) => row.id === reqDemo.id));
  }
});

test('the browser cannot choose the recipient', async () => {
  const sneaky = await guest('/api/viewings', {
    method: 'POST',
    body: { ...viewing(`listing:${listingA}`), sellerId: sellerB.id, seller_id: sellerB.id },
  });
  assert.equal(sneaky.status, 201, sneaky.text);
  const b = await sellerB.call('/api/seller/viewings');
  assert.ok(!b.json.requests.some((row) => row.id === sneaky.json.request.id));
  const a = await sellerA.call('/api/seller/viewings');
  assert.ok(a.json.requests.some((row) => row.id === sneaky.json.request.id));
});

test('a buyer gets 403 and a guest gets 401 on the seller inbox', async () => {
  assert.equal((await buyer.call('/api/seller/viewings')).status, 403);
  assert.equal((await guest('/api/seller/viewings')).status, 401);
  const patch = { method: 'PATCH', body: { status: 'Confirmed' } };
  assert.equal((await buyer.call(`/api/seller/viewings/${reqB.id}`, patch)).status, 403);
  assert.equal((await guest(`/api/seller/viewings/${reqB.id}`, patch)).status, 401);
});

test('a seller confirms and declines their own requests, never another seller\'s', async () => {
  const confirm = await sellerA.call(`/api/seller/viewings/${reqA.id}`, { method: 'PATCH', body: { status: 'Confirmed' } });
  assert.equal(confirm.status, 200, confirm.text);
  assert.equal(confirm.json.request.status, 'Confirmed');

  const decline = await sellerA.call(`/api/seller/viewings/${reqA.id}`, { method: 'PATCH', body: { status: 'Cancelled' } });
  assert.equal(decline.json.request.status, 'Cancelled');

  const foreign = await sellerA.call(`/api/seller/viewings/${reqB.id}`, { method: 'PATCH', body: { status: 'Confirmed' } });
  assert.equal(foreign.status, 404);
  const demo = await sellerA.call(`/api/seller/viewings/${reqDemo.id}`, { method: 'PATCH', body: { status: 'Confirmed' } });
  assert.equal(demo.status, 404);

  const bad = await sellerA.call(`/api/seller/viewings/${reqA.id}`, { method: 'PATCH', body: { status: 'Requested' } });
  assert.equal(bad.status, 400);

  const mine = await buyer.call('/api/viewings');
  assert.equal(mine.json.requests[0].status, 'Requested');
});

test('the buyer still sees only their own request, without seller fields', async () => {
  const mine = await buyer.call('/api/viewings');
  assert.deepEqual(mine.json.requests.map((row) => row.id), [reqB.id]);
  assert.equal(mine.json.requests[0].sellerId, undefined);
});
