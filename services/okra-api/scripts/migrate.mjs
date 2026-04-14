import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient } from './db-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../db/migrations');

const migrationTable = process.env.MIGRATIONS_TABLE ?? 'okra_schema_migrations';

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists ${migrationTable} (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function applyMigrations() {
  const client = await createDbClient();
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const { rows } = await client.query(`select id as migration_id from ${migrationTable}`);
    const applied = new Set(rows.map((row) => row.migration_id));

    const files = await listMigrationFiles();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip ${file}`);
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, 'utf-8');

      console.log(`[migrate] apply ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(`insert into ${migrationTable}(id) values ($1)`, [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    console.log('[migrate] done');
  } finally {
    await client.end();
  }
}

applyMigrations().catch((error) => {
  console.error('[migrate] failed', error);
  process.exit(1);
});
