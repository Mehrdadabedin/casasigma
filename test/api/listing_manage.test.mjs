// MKT3.2: a seller edits and deletes only their own listings.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);
const input = { title: 'Dashboard villa', kind: 'Villa', city: 'Mijas', price: 450000, description: 'Test' };

let owner;
let other;
let buyer;
let listing;

async function signedIn(role) {
  const call = client(server.baseUrl);
  const signup = await call('/api/auth/signup', { method: 'POST', body: accounts.next(role) });
  assert.equal(signup.status, 201, signup.text);
  return call;
}

const dbCount = async (sql, params) => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    return Number((await db.query(sql, params)).rows[0].count);
  } finally {
    await db.end();
  }
};

before(async () => {
  server = await startServer();
  owner = await signedIn('seller');
  other = await signedIn('seller');
  buyer = await signedIn('buyer');
  const created = await owner('/api/listings', { method: 'POST', body: input });
  assert.equal(created.status, 201, created.text);
  listing = created.json.listing;
});

after(async () => {
  await accounts.cleanup();
  await server?.stop();
});

test('the owner can edit title, price and description', async () => {
  const res = await owner(`/api/listings/${listing.id}`, {
    method: 'PATCH',
    body: { ...input, title: 'Renamed villa', price: 500000, description: 'New text' },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.listing.title, 'Renamed villa');
  assert.equal(res.json.listing.price, 500000);
  const mine = await owner('/api/listings?mine=1');
  assert.equal(mine.json.listings.find((item) => item.id === listing.id).description, 'New text');
});

test('an edit is validated like a new listing', async () => {
  const res = await owner(`/api/listings/${listing.id}`, {
    method: 'PATCH',
    body: { ...input, price: -5 },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.field, 'price');
});

test('another seller gets 404 and a buyer gets 403 on edit and delete', async () => {
  const body = { ...input, title: 'Hijacked' };
  assert.equal((await other(`/api/listings/${listing.id}`, { method: 'PATCH', body })).status, 404);
  assert.equal((await other(`/api/listings/${listing.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await buyer(`/api/listings/${listing.id}`, { method: 'PATCH', body })).status, 403);
  assert.equal((await buyer(`/api/listings/${listing.id}`, { method: 'DELETE' })).status, 403);
  const guest = client(server.baseUrl);
  assert.equal((await guest(`/api/listings/${listing.id}`, { method: 'DELETE' })).status, 401);
  const mine = await owner('/api/listings?mine=1');
  assert.equal(mine.json.listings.find((item) => item.id === listing.id).title, 'Renamed villa');
});

test('delete removes the listing and its photo files', async () => {
  const up = await owner(`/api/listings/${listing.id}/photos?slot=1`, {
    method: 'POST',
    body: JPEG,
    headers: { 'content-type': 'image/jpeg' },
  });
  assert.equal(up.status, 200, up.text);
  const slug = up.json.listing.photos[0].slug;
  assert.equal(await dbCount('select count(*) from media where slug = $1', [slug]), 1);

  const res = await owner(`/api/listings/${listing.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200, res.text);
  assert.equal(await dbCount('select count(*) from listings where id = $1', [listing.id]), 0);
  assert.equal(await dbCount('select count(*) from media where slug = $1', [slug]), 0);
  assert.equal((await owner(`/api/listings/${listing.id}`, { method: 'DELETE' })).status, 404);
});
