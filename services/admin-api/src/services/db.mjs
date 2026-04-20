import pg from 'pg';

let pool;

function getDatabaseConfig() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const sslDisabled = /(?:[?&]|^)sslmode=disable(?:&|$)/i.test(connectionString);

  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: true } })
  };
}

export function getPool() {
  if (!pool) {
    pool = new pg.Pool(getDatabaseConfig());
  }

  return pool;
}

export async function query(text, params = []) {
  try {
    return await getPool().query(text, params);
  } catch (error) {
    throw new Error(`Database query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
