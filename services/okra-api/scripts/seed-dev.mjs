import { createDbClient } from './db-client.mjs';

async function seed() {
  const client = await createDbClient();
  await client.connect();

  try {
    await client.query(`
      insert into submissions (
        contributor_name,
        contributor_email,
        story_text,
        raw_location_text,
        privacy_mode,
        display_lat,
        display_lng,
        status
      ) values (
        'Sample Grower',
        'sample@example.com',
        'First okra leaves are up! 🌱',
        'Austin, Texas',
        'city',
        30.2672,
        -97.7431,
        'pending_review'
      )
      on conflict do nothing
    `);

    console.log('[seed] inserted sample submission');
  } finally {
    await client.end();
  }
}

seed().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
