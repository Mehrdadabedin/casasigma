// In production the API process also serves the built web app (dist/), so the
// page and /api share one origin on a single hosted service (Render). These
// tests use a small fixture build instead of the real dist/.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveWebPath, webRoot } from '../../server/web.mjs';
import { startServer } from './helpers.mjs';

const fixture = mkdtempSync(join(tmpdir(), 'casasigma-web-'));
const dist = join(fixture, 'dist');
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>CasaSigma</title>');
writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
writeFileSync(join(dist, '.env'), 'SECRET=in-dist');
writeFileSync(join(fixture, 'secret.txt'), 'SECRET=outside-dist');

test('the web app is served only in production or with WEB_DIST', () => {
  assert.equal(webRoot('/app', {}), null);
  assert.equal(webRoot('/app', { NODE_ENV: 'production' }), resolve('/app/dist'));
  assert.equal(webRoot('/app', { WEB_DIST: '/srv/web' }), resolve('/srv/web'));
});

test('URL paths map to files inside the build only', () => {
  assert.equal(resolveWebPath(dist, '/'), join(dist, 'index.html'));
  assert.equal(resolveWebPath(dist, '/assets/index-abc123.js'), join(dist, 'assets', 'index-abc123.js'));
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt',
    '/..%5csecret.txt', '/.env', '/assets/%2eenv', '/index.html%00.js', '/%E0%A4%A']) {
    assert.equal(resolveWebPath(dist, path), null, path);
  }
});

/** A request sent with the path exactly as written; fetch would normalise `..`. */
function raw(baseUrl, path, method = 'GET') {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ hostname, port, path, method }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolvePromise({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForLog(server, text) {
  for (let i = 0; i < 40 && !server.output().includes(text); i += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return server.output();
}

let prod;
let dev;

before(async () => {
  prod = await startServer({ NODE_ENV: 'production', WEB_DIST: dist, API_HOST: '0.0.0.0' });
  dev = await startServer();
});

after(async () => {
  await prod?.stop();
  await dev?.stop();
  rmSync(fixture, { recursive: true, force: true });
});

test('production serves index.html at / and never caches it', async () => {
  const response = await raw(prod.baseUrl, '/');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.headers['cache-control'], 'no-cache');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(response.body, /<title>CasaSigma<\/title>/);
});

test('hashed assets are served with a long cache', async () => {
  const response = await raw(prod.baseUrl, '/assets/index-abc123.js');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/javascript/);
  assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('HEAD answers without a body, and writes are refused', async () => {
  const head = await raw(prod.baseUrl, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await raw(prod.baseUrl, '/', 'POST')).status, 405);
});

test('unknown paths are 404: routes are hash-based, so there is no fallback', async () => {
  assert.equal((await raw(prod.baseUrl, '/homes/123')).status, 404);
});

test('nothing outside the build, and no dotfile inside it, is served', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt', '/.env']) {
    const response = await raw(prod.baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /SECRET/, path);
  }
});

test('/api keeps answering next to the web app', async () => {
  const health = await raw(prod.baseUrl, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  const missing = await raw(prod.baseUrl, '/api/no-such-route');
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).error, 'no route');
});

test('in development the page is left to Vite', async () => {
  const response = await raw(dev.baseUrl, '/');
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error, 'no route');
});

test('the API binds to loopback unless API_HOST says otherwise', async () => {
  assert.match(await waitForLog(dev, 'media API on'), /media API on http:\/\/127\.0\.0\.1:\d+ /);
  assert.match(await waitForLog(prod, 'media API on'), /media API on http:\/\/0\.0\.0\.0:\d+ .*web: /);
});
