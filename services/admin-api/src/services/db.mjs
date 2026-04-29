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

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn({
      query: (text, params = []) => client.query(text, params)
    });
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
