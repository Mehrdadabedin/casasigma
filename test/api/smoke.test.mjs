import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { client, startServer, testAccounts } from './helpers.mjs';

let server;
const accounts = testAccounts();

before(async () => {
  server = await startServer();
});

after(async () => {
  await accounts.cleanup();
  await server?.stop();
});

test('GET /api/health returns 200', async () => {
  const response = await client(server.baseUrl)('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.json?.ok, true);
});

test('signup, login and /api/auth/me return the same user', async () => {
  const account = accounts.next('buyer');

  const signup = await client(server.baseUrl)('/api/auth/signup', {
    method: 'POST',
    body: account,
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.email, account.email);

  // A fresh client, so /me proves the login cookie and not the signup one.
  const request = client(server.baseUrl);
  assert.equal((await request('/api/auth/me')).status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie') ?? '', /cs_session=.+HttpOnly/);

  const me = await request('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.id, signup.json.user.id);
  assert.equal(me.json.user.email, account.email);
  assert.equal(me.json.user.role, 'buyer');
});
