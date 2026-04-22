import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

let cachedDocClient = null;

function getDocClient() {
  if (!cachedDocClient) {
    cachedDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return cachedDocClient;
}

async function listUserSubmissions(client, cognitoSub) {
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;

  const result = await client.query(
    `
      select s.id::text as id, s.status, s.story_text, s.raw_location_text,
             s.privacy_mode, s.country, s.created_at
        from submissions s
       where s.contributor_cognito_sub = $1
       order by s.created_at desc
       limit 200
    `,
    [cognitoSub]
  );

  const ids = result.rows.map((row) => row.id);
  const photoMap = {};
  if (ids.length > 0 && cdnDomain) {
    const photoRes = await client.query(
      `
        select submission_id::text as submission_id, thumbnail_s3_key
          from submission_photos
         where submission_id = any($1::uuid[])
           and status = 'ready'
         order by submission_id, created_at asc
      `,
      [ids]
    );
    for (const photo of photoRes.rows) {
      if (!photoMap[photo.submission_id]) {
        photoMap[photo.submission_id] = [];
      }
      photoMap[photo.submission_id].push(`https://${cdnDomain}/${photo.thumbnail_s3_key}`);
    }
  }

  return result.rows.map((row) => ({
    id: row.id,
    type: 'okra_submission',
    status: row.status,
    storyText: row.story_text,
    rawLocationText: row.raw_location_text,
    privacyMode: row.privacy_mode,
    country: row.country,
    createdAt: row.created_at,
    photoUrls: photoMap[row.id] ?? []
  }));
}

async function listUserSeedRequests(cognitoSub) {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    return [];
  }

  const items = [];
  let lastKey;

  do {
    const result = await getDocClient().send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'contributorCognitoSub = :sub and begins_with(requestId, :prefix)',
      ExpressionAttributeValues: {
        ':sub': cognitoSub,
        ':prefix': ''
      },
      ExclusiveStartKey: lastKey,
      Limit: 200
    }));

    for (const item of result.Items ?? []) {
      // Skip internal bookkeeping rows (rate-limit entries use `ratelimit#` prefix).
      if (typeof item.requestId === 'string' && item.requestId.startsWith('ratelimit#')) {
        continue;
      }
      items.push({
        id: item.requestId,
        type: 'seed_request',
        name: item.name ?? null,
        fulfillmentMethod: item.fulfillmentMethod ?? null,
        shippingCity: item.shippingAddress?.city ?? null,
        shippingRegion: item.shippingAddress?.region ?? null,
        shippingCountry: item.shippingAddress?.country ?? null,
        message: item.message ?? null,
        createdAt: item.createdAt
      });
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey && items.length < 200);

  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return items;
}

export async function getUserActivity(client, cognitoSub) {
  const [submissions, seedRequests] = await Promise.all([
    listUserSubmissions(client, cognitoSub),
    listUserSeedRequests(cognitoSub)
  ]);

  return {
    submissions,
    seedRequests
  };
}
