// MKT1.3: listing details are for signed-in accounts. A guest's listing list
// carries no price, description, seller or photo; a buyer's carries all of
// them. Listing photos and the listing detail answer 401 to a guest.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const listingIds = [];
// A JPEG header is enough: the API checks the declared type, not the picture.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);

async function signedIn(role) {
  const call = client(server.baseUrl);
  const signup = await call('/api/auth/signup', { method: 'POST', body: accounts.next(role) });
  assert.equal(signup.status, 201, signup.text);
  return call;
}

let listing;
let photoSlug;

before(async () => {
  server = await startServer();
  const seller = await signedIn('seller');
  const created = await seller('/api/listings', {
    method: 'POST',
    body: {
      title: 'Locked test villa',
      kind: 'Villa',
      city: 'Mijas',
      price: 987654,
      description: 'Calle Secreta 12, behind the church',
    },
  });
  assert.equal(created.status, 201, created.text);
  listing = created.json.listing;
  listingIds.push(listing.id);
  const upload = await seller(`/api/listings/${listing.id}/photos?slot=1`, {
    method: 'POST',
    body: JPEG,
    headers: { 'content-type': 'image/jpeg' },
  });
  assert.equal(upload.status, 200, upload.text);
  photoSlug = upload.json.listing.photos[0].slug;
});

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('delete from media where slug = $1', [photoSlug]);
    await db.query('delete from listings where id = any($1::uuid[])', [listingIds]);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await server?.stop();
});

const find = (response) => response.json.listings.find((row) => row.id === listing.id);

test('a guest gets the listing without price, description, seller or photos', async () => {
  const response = await client(server.baseUrl)('/api/listings');
  assert.equal(response.status, 200);
  const row = find(response);
  assert.ok(row, 'the listing is missing from the guest list');
  assert.deepEqual(Object.keys(row).sort(), ['city', 'createdAt', 'id', 'kind', 'locked', 'photos', 'title']);
  assert.deepEqual(row.photos, []);
  for (const secret of ['987654', 'Calle Secreta', photoSlug]) {
    assert.ok(!response.text.includes(secret), `the guest list leaks ${secret}`);
  }
});

test('a signed-in buyer gets the price, description, seller and photos', async () => {
  const buyer = await signedIn('buyer');
  const row = find(await buyer('/api/listings'));
  assert.equal(row.price, 987654);
  assert.equal(row.description, 'Calle Secreta 12, behind the church');
  assert.ok(row.sellerName);
  assert.equal(row.photos[0].slug, photoSlug);
  assert.equal(row.locked, undefined);
  assert.equal((await buyer(`/api/media/${photoSlug}`)).status, 200);
});

test('a guest gets 401 for the listing detail, its photo and ?mine=1', async () => {
  const guest = client(server.baseUrl);
  assert.equal((await guest(`/api/listings/${listing.id}`)).status, 401);
  assert.equal((await guest(`/api/media/${photoSlug}`)).status, 401);
  assert.equal((await guest('/api/listings?mine=1')).status, 401);
});
