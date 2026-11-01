// Photos are stored in Postgres, so the API caps each upload: 1 MB for a
// listing photo, 512 KB for a profile portrait. The browser compresses to fit
// first (src/lib/image.ts); these tests check the API refuses anything bigger,
// whether or not the request declares its length.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

const LISTING_MAX = 1024 * 1024;
const PROFILE_MAX = 512 * 1024;

/** A JPEG-looking body of exactly `size` bytes. */
const jpeg = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

let server;
const accounts = testAccounts();
const listingIds = [];
let seller;
let sellerCookie;
let listing;

async function signedIn(role) {
  const call = client(server.baseUrl);
  const signup = await call('/api/auth/signup', { method: 'POST', body: accounts.next(role) });
  assert.equal(signup.status, 201, signup.text);
  return { call, cookie: signup.headers.get('set-cookie').split(';')[0] };
}

const uploadListingPhoto = (body) =>
  seller(`/api/listings/${listing.id}/photos?slot=1`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'image/jpeg' },
  });

before(async () => {
  server = await startServer();
  ({ call: seller, cookie: sellerCookie } = await signedIn('seller'));
  const created = await seller('/api/listings', {
    method: 'POST',
    body: { title: 'Photo limit villa', kind: 'Villa', city: 'Mijas', price: 300000, description: 'Test' },
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
    await db.query(
      `delete from media where slug in (
         select p.photo_slug from profiles p join users u on u.id = p.user_id
          where lower(u.email) like $1)`,
      [`%@${accounts.domain}`],
    );
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await server?.stop();
});

test('a listing photo of exactly 1 MB is stored', async () => {
  const response = await uploadListingPhoto(jpeg(LISTING_MAX));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.listing.photos.length, 1);
});

test('a listing photo one byte over 1 MB is refused with 413', async () => {
  const response = await uploadListingPhoto(jpeg(LISTING_MAX + 1));
  assert.equal(response.status, 413, response.text);
  assert.match(response.json.error, /too large \(at most 1024 KB\)/);
});

test('PUT /api/media for a listing photo has the same 1 MB limit', async () => {
  const response = await seller('/api/media/listing-limit-test', {
    method: 'PUT',
    body: jpeg(LISTING_MAX + 1),
    headers: { 'content-type': 'image/jpeg' },
  });
  assert.equal(response.status, 413, response.text);
});

test('a portrait is limited to 512 KB', async () => {
  const { call } = await signedIn('buyer');
  const upload = (body) =>
    call('/api/profile/photo', { method: 'POST', body, headers: { 'content-type': 'image/jpeg' } });
  assert.equal((await upload(jpeg(PROFILE_MAX + 1))).status, 413);
  const stored = await upload(jpeg(PROFILE_MAX));
  assert.equal(stored.status, 200, stored.text);
  assert.equal(stored.json.profile.photoStatus, 'pending');
});

test('a chunked upload with no declared length is cut off at the limit too', async () => {
  const { hostname, port } = new URL(server.baseUrl);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname,
        port,
        method: 'POST',
        path: `/api/listings/${listing.id}/photos?slot=2`,
        headers: { 'content-type': 'image/jpeg', cookie: sellerCookie, 'transfer-encoding': 'chunked' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on('error', reject);
    const chunk = jpeg(256 * 1024);
    for (let i = 0; i < 5; i += 1) req.write(chunk);
    req.end();
  });
  assert.equal(status, 413);
  const reloaded = await seller(`/api/listings/${listing.id}`);
  assert.equal(reloaded.json.listing.photos.some((photo) => photo.slot === 2), false);
});
