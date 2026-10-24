// MKT4.3: emails for a viewing request and for a password reset. On localhost
// every mail is written to an outbox folder; in production without Resend
// nothing is sent; a mail problem never fails the request.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { TEST_DATABASE_URL, client, startServer, testAccounts } from './helpers.mjs';

const accounts = testAccounts();
const tag = `mail-${Date.now().toString(36)}`;
const servers = [];
const listingIds = [];
const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

const viewing = (listingId, extra = {}) => ({
  listingId,
  listingTitle: 'Stored title',
  name: 'Vera Visitor',
  email: `${tag}@visitors.test`,
  description: 'Hello <script>alert(1)</script> there',
  date: day,
  time: '11:00',
  ...extra,
});

async function boot(env) {
  const server = await startServer(env);
  servers.push(server);
  return server;
}

/** Mail is sent after the answer, so wait briefly for the files. */
async function waitForMails(server, count) {
  for (let i = 0; i < 40; i += 1) {
    if (server.mails().length >= count) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return server.mails();
}

async function sellerWithListing(server, title) {
  const seller = client(server.baseUrl);
  const account = accounts.next('seller');
  const signup = await seller('/api/auth/signup', { method: 'POST', body: account });
  assert.equal(signup.status, 201, signup.text);
  const created = await seller('/api/listings', {
    method: 'POST',
    body: { title, kind: 'Villa', city: 'Mijas', price: 300000, description: '' },
  });
  listingIds.push(created.json.listing.id);
  return { id: created.json.listing.id, email: account.email };
}

after(async () => {
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('delete from viewing_requests where email like $1', ['%@visitors.test']);
    await db.query('delete from listings where id = any($1::uuid[])', [listingIds]);
  } finally {
    await db.end();
  }
  await accounts.cleanup();
  await Promise.all(servers.map((server) => server.stop()));
});

test('a guest request on a seller listing writes a mail to the seller and one to the visitor', async () => {
  const server = await boot();
  const listing = await sellerWithListing(server, 'Villa Mailtest');
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing(`listing:${listing.id}`) });
  assert.equal(res.status, 201, res.text);

  const files = await waitForMails(server, 4);
  const html = files.filter((name) => name.endsWith('.html'));
  assert.equal(html.length, 2, files.join(', '));
  assert.equal(files.filter((name) => name.endsWith('.txt')).length, 2);

  const sellerFile = html.find((name) => name.includes('viewing-seller'));
  const visitorFile = html.find((name) => name.includes('viewing-visitor'));
  assert.ok(sellerFile && visitorFile, files.join(', '));

  const toSeller = server.mail(sellerFile);
  assert.ok(toSeller.includes('Villa Mailtest'));
  assert.ok(toSeller.includes('Vera Visitor'));
  assert.ok(toSeller.includes(listing.email), 'the outbox file names the recipient');
  assert.ok(!toSeller.includes('<script>'), 'user text is escaped');
  assert.ok(toSeller.includes('&lt;script&gt;'));

  const toVisitor = server.mail(visitorFile);
  assert.ok(toVisitor.includes('Villa Mailtest'));
  assert.ok(toVisitor.includes(`${tag}@visitors.test`));
  assert.ok(!toVisitor.includes('<script>'));
});

test('a demo listing request writes only the visitor confirmation', async () => {
  const server = await boot();
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing('house:harbor-loft', { listingTitle: 'Old-town loft' }) });
  assert.equal(res.status, 201, res.text);
  const files = await waitForMails(server, 2);
  assert.deepEqual(files.map((name) => name.replace(/^.*?-(viewing-\w+)\..*$/, '$1')).sort(), ['viewing-visitor', 'viewing-visitor']);
});

test('a honeypot request sends no mail', async () => {
  const server = await boot();
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing('house:harbor-loft', { website: 'http://spam.example' }) });
  assert.equal(res.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(server.mails(), []);
});

test('in production without Resend nothing is written and the request still answers 201', async () => {
  const server = await boot({ NODE_ENV: 'production' });
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing('house:harbor-loft') });
  assert.equal(res.status, 201, res.text);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(server.mails(), []);
});

test('a mail problem does not fail the request', async () => {
  const blocker = join((await boot()).outbox, 'not-a-folder');
  writeFileSync(blocker, 'x');
  const server = await boot({ MAIL_OUTBOX_DIR: join(blocker, 'inside') });
  const guest = client(server.baseUrl);
  const res = await guest('/api/viewings', { method: 'POST', body: viewing('house:harbor-loft') });
  assert.equal(res.status, 201, res.text);
});

test('a password reset writes its mail to the outbox, with the name escaped', async () => {
  const server = await boot();
  const person = client(server.baseUrl);
  const account = { ...accounts.next('buyer'), name: 'Eve <b>Bold</b>' };
  const signup = await person('/api/auth/signup', { method: 'POST', body: account });
  assert.equal(signup.status, 201, signup.text);

  const res = await client(server.baseUrl)('/api/auth/forgot', { method: 'POST', body: { email: account.email } });
  assert.equal(res.status, 202, res.text);
  const files = await waitForMails(server, 2);
  const file = files.find((name) => name.includes('password-reset') && name.endsWith('.html'));
  assert.ok(file, files.join(', '));
  const body = server.mail(file);
  assert.ok(body.includes('#/reset?token='));
  assert.ok(!body.includes('<b>Bold</b>'));
  assert.ok(body.includes('&lt;b&gt;Bold&lt;/b&gt;'));
});
