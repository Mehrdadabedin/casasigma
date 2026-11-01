// DATABASE_SCHEMA lets CasaSigma share another app's database (the hosted
// ICMBOT Postgres): every table goes in its own schema, and the API refuses to
// start when that schema is missing rather than writing somewhere else.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { databaseConfig, redactedUrl } from '../../server/db.mjs';
import { TEST_DATABASE_URL, startServer } from './helpers.mjs';

const SCHEMA = 'cs_schema_test';

test('without DATABASE_SCHEMA the connection is unchanged', () => {
  const config = databaseConfig({ DATABASE_URL: 'postgres://a@h/db' });
  assert.deepEqual(config, { connectionString: 'postgres://a@h/db', schema: null });
});

test('DATABASE_SCHEMA sets the search_path', () => {
  const config = databaseConfig({ DATABASE_URL: 'postgres://a@h/db', DATABASE_SCHEMA: 'casasigma' });
  assert.equal(config.schema, 'casasigma');
  assert.equal(config.options, '-c search_path=casasigma');
});

test('a malformed DATABASE_SCHEMA is refused', () => {
  for (const name of ['CasaSigma', 'casa sigma', 'casasigma,public', '1casa', 'x;drop']) {
    assert.throws(() => databaseConfig({ DATABASE_SCHEMA: name }), /DATABASE_SCHEMA/);
  }
});

test('logs never show the database password', () => {
  assert.equal(redactedUrl('postgres://app:s3cret@host:5432/db'), 'postgres://app:***@host:5432/db');
  assert.equal(redactedUrl('postgres://app@host/db'), 'postgres://app@host/db');
});

let db;

before(async () => {
  db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  await db.query(`drop schema if exists ${SCHEMA} cascade`);
});

after(async () => {
  await db.query(`drop schema if exists ${SCHEMA} cascade`);
  await db.end();
});

test('the API refuses to start when the schema does not exist', async () => {
  await assert.rejects(startServer({ DATABASE_SCHEMA: SCHEMA }), /schema "cs_schema_test" does not exist/);
});

test('with the schema in place every table is created inside it', async () => {
  await db.query(`create schema ${SCHEMA}`);
  const server = await startServer({ DATABASE_SCHEMA: SCHEMA });
  try {
    const health = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const { rows } = await db.query(
      'select table_name from information_schema.tables where table_schema = $1',
      [SCHEMA],
    );
    const tables = rows.map((row) => row.table_name);
    for (const table of ['media', 'users', 'sessions', 'listings', 'viewing_requests']) {
      assert.ok(tables.includes(table), `${table} is in ${SCHEMA}`);
    }
  } finally {
    await server.stop();
  }
});
