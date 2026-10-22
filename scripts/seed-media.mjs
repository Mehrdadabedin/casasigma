import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://casasigma@127.0.0.1:5434/casasigma';

const assets = [
  ['brand-logo', 'public/brand/casasigma-wordmark.png', 'image/png'],
  ['brand-lockup', 'public/brand/casasigma-lockup.png', 'image/png'],
  ['brand-icon', 'public/brand/casasigma-icon.png', 'image/png'],
];

const pool = new Pool({ connectionString: DATABASE_URL });

try {
  for (const [slug, file, mime] of assets) {
    const bytes = await readFile(join(ROOT, file));
    const { rows } = await pool.query(
      `insert into media (slug, mime, bytes)
       values ($1, $2, $3)
       on conflict (slug) do update
         set mime = excluded.mime, bytes = excluded.bytes, updated_at = now()
       returning slug, octet_length(bytes) as byte_size`,
      [slug, mime, bytes],
    );
    console.log(`seeded ${rows[0].slug} (${rows[0].byte_size} bytes)`);
  }
} catch (error) {
  console.error(`seeding failed: ${error.message}`);
  console.error('Start the database first: npm run db:start');
  process.exitCode = 1;
} finally {
  await pool.end();
}
