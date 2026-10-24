// MKT3.1: a listing has five photo slots (1-5, slot 1 is the cover). Slot 6 is
// refused, and only the owning seller can write to a listing's slots.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const listingIds = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);

async function signedIn(role) {
  const call = client(server.baseUrl);
  const signup = await call('/api/auth/signup', { method: 'POST', body: accounts.next(role) });
  assert.equal(signup.status, 201, signup.text);
  return call;
}

const upload = (call, id, slot) =>
  call(`/api/listings/${id}/photos?slot=${slot}`, {
    method: 'POST',
    body: JPEG,
    headers: { 'content-type': 'image/jpeg' },
  });

let owner;
let other;
let buyer;
let listing;

before(async () => {
  server = await startServer();
  owner = await signedIn('seller');
  other = await signedIn('seller');
  buyer = await signedIn('buyer');
  const created = await owner('/api/listings', {
    method: 'POST',
    body: { title: 'Five photo villa', kind: 'Villa', city: 'Mijas', price: 450000, description: 'Test' },
  });
  assert.equal(created.status, 201, created.text);
  listing = created.json.listing;
  listingIds.push(listing.id);
});

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      'delete from media where slug in (select media_slug from listing_photos where listing_id = any($1::uuid[]))',
      [listingIds],
    );
    await db.query('delete from listings where id = any($1::uuid[])', [listingIds]);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await server?.stop();
});

test('slots 1 to 5 are accepted and come back in order', async () => {
  for (const slot of [1, 2, 3, 4, 5]) {
    const res = await upload(owner, listing.id, slot);
    assert.equal(res.status, 200, `slot ${slot}: ${res.text}`);
  }
  const mine = await owner('/api/listings?mine=1');
  const found = mine.json.listings.find((item) => item.id === listing.id);
  assert.deepEqual(found.photos.map((photo) => photo.slot), [1, 2, 3, 4, 5]);
});

test('slot 6 and slot 0 are refused with 400 and field slot', async () => {
  for (const slot of [6, 0]) {
    const res = await upload(owner, listing.id, slot);
    assert.equal(res.status, 400, `slot ${slot}`);
    assert.equal(res.json.field, 'slot');
  }
  const remove = await owner(`/api/listings/${listing.id}/photos/6`, { method: 'DELETE' });
  assert.equal(remove.status, 400);
});

test('slot 5 can be removed', async () => {
  const remove = await owner(`/api/listings/${listing.id}/photos/5`, { method: 'DELETE' });
  assert.equal(remove.status, 200, remove.text);
});

test('another seller gets 404 and a buyer gets 403', async () => {
  assert.equal((await upload(other, listing.id, 5)).status, 404);
  assert.equal((await upload(buyer, listing.id, 5)).status, 403);
  const remove = await other(`/api/listings/${listing.id}/photos/1`, { method: 'DELETE' });
  assert.equal(remove.status, 404);
});

test('the database itself refuses position 6', async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('insert into media (slug, mime, bytes) values ($1, $2, $3)', ['listing-slot6test', 'image/jpeg', Buffer.from(JPEG)]);
    await assert.rejects(
      db.query('insert into listing_photos (listing_id, media_slug, position) values ($1, $2, 6)', [listing.id, 'listing-slot6test']),
      /check constraint/,
    );
  } finally {
    await db.query("delete from media where slug = 'listing-slot6test'");
    await db.end();
  }
});
