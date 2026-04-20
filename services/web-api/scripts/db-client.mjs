import pg from 'pg';

const { Client } = pg;

function normalizeDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const sslmode = parsed.searchParams.get('sslmode');
    const hasLibpqCompat = parsed.searchParams.has('uselibpqcompat');

    if ((sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-ca') && !hasLibpqCompat) {
      parsed.searchParams.set('uselibpqcompat', 'true');
      return parsed.toString();
    }

    return databaseUrl;
  } catch {
    return databaseUrl;
  }
}

export async function createDbClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return new Client({ connectionString: normalizeDatabaseUrl(databaseUrl) });
}
