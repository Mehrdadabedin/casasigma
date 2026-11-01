// Creates the local demo accounts and the starter admin login.
//
// No password is stored in this repository. The demo password comes from
// DEMO_PASSWORD and the admin starter password from ADMIN_STARTER_PASSWORD;
// when one is not set, a random password is generated and printed once.
//
// The admin signs in the first time as `admin2` with the starter password and
// is then sent to /#/admin/credentials to choose its own username and password.
//
// Safe to run repeatedly; existing buyers, sellers and a finished admin setup
// are left alone. `--reset-admin-password` puts the admin back on the starter
// credentials and signs it out everywhere.
import { readFile } from 'node:fs/promises';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { assertSchema, databaseConfig } from '../server/db.mjs';

const { Pool } = pg;
const scrypt = promisify(scryptCallback);

const { schema: DATABASE_SCHEMA, ...DATABASE } = databaseConfig();
const randomPassword = () => randomBytes(12).toString('base64url');
const password =
  process.env.DEMO_PASSWORD || (process.env.NODE_ENV === 'production' ? null : randomPassword());
const resetAdmin = process.argv.includes('--reset-admin-password');

const ADMIN_ACCOUNT = {
  email: 'demo.admin@casasigma.test',
  username: 'admin2',
  name: 'Admin',
  starterPassword: process.env.ADMIN_STARTER_PASSWORD || randomPassword(),
};

if (!password) {
  console.error('Set DEMO_PASSWORD before seeding demo accounts in production.');
  process.exit(1);
}

const pool = new Pool({ ...DATABASE, max: 1 });

async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

const accounts = [
  { email: 'demo.buyer@casasigma.test', name: 'Ana Torres', role: 'buyer' },
  { email: 'demo.seller@casasigma.test', name: 'Miguel Serrano', role: 'seller' },
];

function printStarter() {
  console.log('');
  console.log(`Admin first sign-in: username "${ADMIN_ACCOUNT.username}", password below`);
  console.log(`  ${ADMIN_ACCOUNT.starterPassword}`);
  console.log('Signing in opens /#/admin/credentials, where you choose your own username and password.');
  console.log('');
}

try {
  await assertSchema(pool, DATABASE_SCHEMA);
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);

  let created = 0;
  for (const account of accounts) {
    const existing = await pool.query('select 1 from users where lower(email) = lower($1)', [
      account.email,
    ]);
    if (existing.rowCount) {
      console.log(`${account.email} already exists — skipped`);
      continue;
    }
    await pool.query(
      `insert into users (email, name, role, password_hash, can_buy, can_sell)
       values ($1, $2, $3, $4, true, $5)`,
      [
        account.email,
        account.name,
        account.role,
        await hashPassword(password),
        account.role !== 'buyer',
      ],
    );
    console.log(`${account.email} created (${account.role})`);
    created += 1;
  }

  // A starter password printed now is only true when the admin had no password
  // before this run; an unfinished admin keeps the one printed earlier.
  const before = await pool.query(
    'select password_hash is not null as has_password from users where lower(email) = lower($1)',
    [ADMIN_ACCOUNT.email],
  );
  const starterIsNew = !before.rows[0]?.has_password;

  // The admin keeps a username instead of an email sign-in. On conflict the
  // identity is refreshed, an unfinished admin gets the starter password, and a
  // password the admin already chose is never overwritten.
  const { rows } = await pool.query(
    `insert into users (email, name, role, username, password_hash, can_buy, can_sell, must_set_password)
     values ($1, $2, 'admin', $3, $4, true, true, true)
     on conflict (lower(email)) do update
       set role = 'admin',
           username = excluded.username,
           name = excluded.name,
           can_sell = true,
           password_hash = coalesce(users.password_hash, excluded.password_hash),
           must_set_password = users.must_set_password or users.password_hash is null,
           updated_at = now()
     returning id, username, must_set_password`,
    [
      ADMIN_ACCOUNT.email,
      ADMIN_ACCOUNT.name,
      ADMIN_ACCOUNT.username,
      await hashPassword(ADMIN_ACCOUNT.starterPassword),
    ],
  );
  const admin = rows[0];

  if (resetAdmin) {
    await pool.query(
      `update users
          set password_hash = $1, username = $2, must_set_password = true, updated_at = now()
        where id = $3`,
      [await hashPassword(ADMIN_ACCOUNT.starterPassword), ADMIN_ACCOUNT.username, admin.id],
    );
    await pool.query('delete from sessions where user_id = $1', [admin.id]);
    printStarter();
    console.log('Admin reset to the starter credentials — every admin session was signed out.');
  } else if (starterIsNew) {
    printStarter();
  } else if (admin.must_set_password) {
    console.log('');
    console.log(
      'Admin first sign-in is still pending with the starter password printed earlier. ' +
        'Run with --reset-admin-password to get a new one.',
    );
  } else {
    console.log('');
    console.log(
      `Admin credentials already set — sign in as "${admin.username}". ` +
        'Run with --reset-admin-password to fall back to the starter login.',
    );
  }

  if (created) {
    console.log(
      `Demo sign-in: demo.buyer@casasigma.test or demo.seller@casasigma.test, password ${password}`,
    );
  }
} catch (error) {
  console.error(`Could not seed demo accounts: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
