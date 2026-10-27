// Postgres connection settings shared by the API and the seed scripts.
//
// DATABASE_SCHEMA keeps every CasaSigma table in one schema, so CasaSigma can
// share a database with another app (the hosted ICMBOT Postgres) without
// touching that app's tables in `public`. db/shared-database-setup.sql creates
// the schema and a login limited to it. Unset, tables go where the
// connection's search_path puts them, as before.

export const DEFAULT_DATABASE_URL = 'postgres://casasigma@127.0.0.1:5434/casasigma';

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Pool settings from the environment; throws on a malformed DATABASE_SCHEMA. */
export function databaseConfig(env = process.env) {
  const connectionString = env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const schema = env.DATABASE_SCHEMA || null;
  if (schema && !SCHEMA_NAME.test(schema)) {
    throw new Error(
      `DATABASE_SCHEMA must be a lowercase Postgres name (letters, digits, _), got "${schema}"`,
    );
  }
  return {
    connectionString,
    schema,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  };
}

/**
 * Refuse to go on when DATABASE_SCHEMA is set but missing or unusable:
 * Postgres would otherwise fail later with a vaguer "no schema has been
 * selected to create in".
 */
export async function assertSchema(pool, schema) {
  if (!schema) return;
  const { rows } = await pool.query('select current_schema() as name');
  if (rows[0].name !== schema) {
    throw new Error(
      `schema "${schema}" does not exist or this login cannot use it; run db/shared-database-setup.sql as the database owner`,
    );
  }
}

/** The connection URL without its password, for logs. */
export function redactedUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}
