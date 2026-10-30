// MKT3.3: a seller holds at most 20 photos over all their listings, counted on
// the server for the listing's seller. A 409 stores nothing, and replacing,
// deleting a photo or deleting a listing keeps the count right.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);
const MAX = 20;

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

async function newListing(call, title = 'Photo limit villa') {
  const created = await call('/api/listings', {
    method: 'POST',
    body: { title, kind: 'Villa', city: 'Mijas', price: 450000, description: 'Test' },
  });
  assert.equal(created.status, 201, created.text);
  return created.json.listing;
}

async function fill(call, id, slots) {
  for (const slot of slots) {
    const res = await upload(call, id, slot);
    assert.equal(res.status, 200, `slot ${slot}: ${res.text}`);
  }
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function sql(text, params = []) {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}

const mediaCount = async () => (await sql("select count(*)::int as n from media where slug like 'listing-%'"))[0].n;
const used = async (call) => (await call('/api/listings?mine=1')).json.photoUsage;

before(async () => {
  server = await startServer();
});

after(async () => {
  await sql(
    `delete from media where slug in (select media_slug from listing_photos lp
       join listings l on l.id = lp.listing_id join users u on u.id = l.seller_id
      where lower(u.email) like $1)`,
    [`%@${accounts.domain}`],
  );
  await sql('delete from listings where seller_id in (select id from users where lower(email) like $1)', [
    `%@${accounts.domain}`,
  ]);
  await sql('delete from listings where seller_id is null and title = $1', ['No seller villa']);
  await accounts.cleanup();
  await server?.stop();
});

test('slot 20 is accepted, slots 21 and 0 are refused with 400', async () => {
  const seller = await signedIn('seller');
  const listing = await newListing(seller);
  assert.equal((await upload(seller, listing.id, 20)).status, 200);
  for (const slot of [21, 0]) {
    const res = await upload(seller, listing.id, slot);
    assert.equal(res.status, 400, `slot ${slot}`);
    assert.equal(res.json.field, 'slot');
  }
  assert.equal((await seller(`/api/listings/${listing.id}/photos/21`, { method: 'DELETE' })).status, 400);
});

test('the 21st photo is refused with 409 and stores nothing, over two listings', async () => {
  const seller = await signedIn('seller');
  const first = await newListing(seller, 'First');
  const second = await newListing(seller, 'Second');
  await fill(seller, first.id, range(1, 12));
  await fill(seller, second.id, range(1, 8));
  assert.deepEqual(await used(seller), { used: MAX, max: MAX });

  const before = await mediaCount();
  const refused = await upload(seller, second.id, 9);
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.json.field, 'photos');
  assert.match(refused.json.error, /20/);
  assert.equal(await mediaCount(), before, 'no media row was added');
  const rows = await sql('select count(*)::int as n from listing_photos where listing_id = $1', [second.id]);
  assert.equal(rows[0].n, 8);
});

test('at 20: replacing works, deleting frees a place, deleting a listing frees its photos', async () => {
  const seller = await signedIn('seller');
  const first = await newListing(seller, 'First');
  const second = await newListing(seller, 'Second');
  await fill(seller, first.id, range(1, 12));
  await fill(seller, second.id, range(1, 8));

  const before = await mediaCount();
  const replaced = await upload(seller, first.id, 3);
  assert.equal(replaced.status, 200, replaced.text);
  assert.deepEqual(replaced.json.photoUsage, { used: MAX, max: MAX });
  assert.equal(await mediaCount(), before, 'the old file is gone');

  const removed = await seller(`/api/listings/${first.id}/photos/12`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.photoUsage, { used: 19, max: MAX });
  assert.equal((await upload(seller, second.id, 9)).status, 200);
  assert.equal((await upload(seller, second.id, 10)).status, 409);

  const gone = await seller(`/api/listings/${second.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.json.photoUsage, { used: 11, max: MAX });
  assert.deepEqual(await used(seller), { used: 11, max: MAX });
  assert.equal((await upload(seller, first.id, 12)).status, 200);
});

test('uploads at the same time cannot pass 20', async () => {
  const seller = await signedIn('seller');
  const first = await newListing(seller, 'First');
  const second = await newListing(seller, 'Second');
  await fill(seller, first.id, range(1, 17));
  const results = await Promise.all(range(1, 8).map((slot) => upload(seller, second.id, slot)));
  const statuses = results.map((res) => res.status);
  assert.equal(statuses.filter((s) => s === 200).length, 3, statuses.join());
  assert.equal(statuses.filter((s) => s === 409).length, 5, statuses.join());
  assert.deepEqual(await used(seller), { used: MAX, max: MAX });
});

test('the count belongs to the listing seller, never to someone else', async () => {
  const seller = await signedIn('seller');
  const listing = await newListing(seller);
  await fill(seller, listing.id, range(1, 5));

  // An admin has no way in through the seller routes: the listing is not theirs.
  const admin = await signedIn('seller');
  await sql("update users set role = 'admin' where lower(email) = $1", [
    (await admin('/api/auth/me')).json.user.email.toLowerCase(),
  ]);
  assert.equal((await upload(admin, listing.id, 6)).status, 404);
  assert.deepEqual(await used(seller), { used: 5, max: MAX });
  assert.deepEqual(await used(admin), { used: 0, max: MAX });

  // A listing with no seller belongs to nobody, so nobody may write to it.
  const orphan = await sql(
    `insert into listings (seller_id, title, kind, city, price, description)
     values (null, 'No seller villa', 'Villa', 'Mijas', 1, '') returning id`,
  );
  assert.equal((await upload(seller, orphan[0].id, 1)).status, 404);
});

test('another seller still gets 404 and a buyer still gets 403', async () => {
  const seller = await signedIn('seller');
  const other = await signedIn('seller');
  const buyer = await signedIn('buyer');
  const listing = await newListing(seller);
  assert.equal((await upload(other, listing.id, 1)).status, 404);
  assert.equal((await upload(buyer, listing.id, 1)).status, 403);
});

test('an account already above 20 keeps its photos and cannot add more', async () => {
  const seller = await signedIn('seller');
  const listing = await newListing(seller);
  await fill(seller, listing.id, range(1, 20));
  const second = await newListing(seller, 'Second');
  await sql('insert into media (slug, mime, bytes) values ($1, $2, $3)', ['listing-over20', 'image/jpeg', Buffer.from(JPEG)]);
  await sql('insert into listing_photos (listing_id, media_slug, position) values ($1, $2, 1)', [second.id, 'listing-over20']);
  assert.deepEqual(await used(seller), { used: 21, max: MAX });
  assert.equal((await upload(seller, second.id, 2)).status, 409);
  assert.equal((await upload(seller, second.id, 1)).status, 200, 'replacing still works');
});
