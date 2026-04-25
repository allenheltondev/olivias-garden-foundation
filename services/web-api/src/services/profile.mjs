import {
  CognitoIdentityProviderClient,
  DeleteUserCommand,
  AdminDeleteUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { createDbClient } from '../../scripts/db-client.mjs';
import { extractBearerToken, resolveOptionalAuthContext } from './auth.mjs';

let cognitoClient;

function getCognitoClient() {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient();
  }
  return cognitoClient;
}

export const profileUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { type: ['string', 'null'], maxLength: 120 },
    lastName: { type: ['string', 'null'], maxLength: 120 },
    displayName: { type: ['string', 'null'], maxLength: 120 },
    bio: { type: ['string', 'null'], maxLength: 2000 },
    city: { type: ['string', 'null'], maxLength: 120 },
    region: { type: ['string', 'null'], maxLength: 120 },
    country: { type: ['string', 'null'], maxLength: 120 },
    timezone: { type: ['string', 'null'], maxLength: 120 },
    websiteUrl: { type: ['string', 'null'], maxLength: 2000 }
  }
};

function normalizeOptionalString(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Invalid profile field value');
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (maxLength && trimmed.length > maxLength) {
    throw new Error(`Profile field exceeds max length of ${maxLength}`);
  }

  return trimmed;
}

function validateUrl(value, fieldName) {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`${fieldName} must be an http(s) URL`);
    }
    return parsed.toString();
  } catch {
    throw new Error(`${fieldName} must be a valid absolute URL`);
  }
}

function buildCdnUrl(s3Key) {
  if (!s3Key) return null;
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) return null;
  return `https://${cdnDomain}/${s3Key}`;
}

function mapProfileRow(row, authContext) {
  if (!row) {
    return {
      userId: authContext?.userId ?? null,
      email: authContext?.email ?? null,
      firstName: null,
      lastName: null,
      displayName: authContext?.name ?? null,
      bio: null,
      city: null,
      region: null,
      country: null,
      timezone: null,
      avatarUrl: null,
      avatarThumbnailUrl: null,
      avatarStatus: 'none',
      avatarProcessingError: null,
      websiteUrl: null,
      tier: null,
      gardenClubStatus: 'none',
      donationTotalCents: 0,
      donationCount: 0,
      lastDonatedAt: null,
      createdAt: null,
      updatedAt: null,
      profileUpdatedAt: null
    };
  }

  return {
    userId: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    bio: row.bio,
    city: row.city,
    region: row.region,
    country: row.country,
    timezone: row.timezone,
    avatarUrl: buildCdnUrl(row.avatar_s3_key),
    avatarThumbnailUrl: buildCdnUrl(row.avatar_thumbnail_s3_key),
    avatarStatus: row.avatar_status ?? 'none',
    avatarProcessingError: row.avatar_processing_error ?? null,
    websiteUrl: row.website_url,
    tier: row.tier,
    gardenClubStatus: row.garden_club_status ?? 'none',
    donationTotalCents: Number(row.donation_total_cents ?? 0),
    donationCount: Number(row.donation_count ?? 0),
    lastDonatedAt: row.last_donated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profileUpdatedAt: row.profile_updated_at
  };
}

const PROFILE_SELECT_COLUMNS = `
  id::text as id, email::text as email, display_name, tier,
  first_name, last_name, bio, city, region, country, timezone,
  website_url, garden_club_status,
  avatar_s3_key, avatar_thumbnail_s3_key, avatar_status, avatar_processing_error,
  donation_total_cents, donation_count, last_donated_at,
  created_at, updated_at, profile_updated_at
`;

async function ensureUserRow(client, authContext) {
  await client.query(
    `
      insert into users (id, email, display_name)
      values ($1::uuid, $2, $3)
      on conflict (id) do update
        set email = coalesce(excluded.email, users.email),
            display_name = coalesce(users.display_name, excluded.display_name),
            updated_at = now()
    `,
    [authContext.userId, authContext.email ?? null, authContext.name ?? null]
  );
}

export async function getProfile(event) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const client = await createDbClient();
  await client.connect();

  try {
    await ensureUserRow(client, authContext);

    const result = await client.query(
      `select ${PROFILE_SELECT_COLUMNS} from users where id = $1::uuid and deleted_at is null`,
      [authContext.userId]
    );

    return mapProfileRow(result.rows[0], authContext);
  } finally {
    await client.end();
  }
}

export async function updateProfile(event, payload) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const firstName = normalizeOptionalString(payload.firstName, 120);
  const lastName = normalizeOptionalString(payload.lastName, 120);
  const displayName = normalizeOptionalString(payload.displayName, 120);
  const bio = normalizeOptionalString(payload.bio, 2000);
  const city = normalizeOptionalString(payload.city, 120);
  const region = normalizeOptionalString(payload.region, 120);
  const country = normalizeOptionalString(payload.country, 120);
  const timezone = normalizeOptionalString(payload.timezone, 120);
  const websiteUrl = validateUrl(normalizeOptionalString(payload.websiteUrl, 2000), 'websiteUrl');

  const client = await createDbClient();
  await client.connect();

  try {
    await ensureUserRow(client, authContext);

    const result = await client.query(
      `
        update users
           set first_name = $2,
               last_name = $3,
               display_name = coalesce($4, display_name),
               bio = $5,
               city = $6,
               region = $7,
               country = $8,
               timezone = $9,
               website_url = $10,
               profile_updated_at = now(),
               updated_at = now()
         where id = $1::uuid
           and deleted_at is null
         returning ${PROFILE_SELECT_COLUMNS}
      `,
      [
        authContext.userId,
        firstName,
        lastName,
        displayName,
        bio,
        city,
        region,
        country,
        timezone,
        websiteUrl
      ]
    );

    return mapProfileRow(result.rows[0], authContext);
  } finally {
    await client.end();
  }
}

async function deleteCognitoUser(event, authContext) {
  const token = extractBearerToken(event);
  const client = getCognitoClient();

  if (token) {
    try {
      await client.send(new DeleteUserCommand({ AccessToken: token }));
      return;
    } catch (error) {
      // NotAuthorizedException is expected when the caller presented an ID token
      // instead of an access token; fall through to admin delete in that case.
      const code = error?.name ?? '';
      if (code !== 'NotAuthorizedException') {
        throw error;
      }
    }
  }

  const userPoolId = process.env.OGF_USER_POOL_ID ?? process.env.SHARED_USER_POOL_ID;
  if (!userPoolId || !authContext?.userId) {
    return;
  }

  try {
    await client.send(new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: authContext.userId
    }));
  } catch (error) {
    // If the Cognito user is already gone we still want the DB redaction to stand.
    const code = error?.name ?? '';
    if (code !== 'UserNotFoundException' && code !== 'ResourceNotFoundException') {
      throw error;
    }
  }
}

export async function deleteProfile(event) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const client = await createDbClient();
  await client.connect();

  try {
    await client.query('begin');
    // Scrub PII from the users row and mark it soft-deleted. The actual row is
    // kept so that historical donation/audit references remain referentially sound.
    await client.query(
      `
        update users
           set email = null,
               display_name = null,
               first_name = null,
               last_name = null,
               bio = null,
               city = null,
               region = null,
               country = null,
               timezone = null,
               website_url = null,
               avatar_id = null,
               avatar_status = 'none',
               avatar_original_s3_bucket = null,
               avatar_original_s3_key = null,
               avatar_s3_bucket = null,
               avatar_s3_key = null,
               avatar_thumbnail_s3_bucket = null,
               avatar_thumbnail_s3_key = null,
               avatar_mime_type = null,
               avatar_width = null,
               avatar_height = null,
               avatar_byte_size = null,
               avatar_processing_error = null,
               avatar_updated_at = null,
               stripe_donor_customer_id = null,
               stripe_garden_club_subscription_id = null,
               deleted_at = coalesce(deleted_at, now()),
               updated_at = now(),
               profile_updated_at = now()
         where id = $1::uuid
      `,
      [authContext.userId]
    );

    // Donation history is retained for tax/record purposes, but donor identifying
    // fields are scrubbed alongside the account deletion.
    await client.query(
      `
        update donation_events
           set donor_name = null,
               donor_email = null,
               dedication_name = null,
               user_id = null
         where user_id = $1::uuid
      `,
      [authContext.userId]
    );

    await client.query('commit');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // ignore rollback failure; surface the original error below
    }
    throw error;
  } finally {
    await client.end();
  }

  await deleteCognitoUser(event, authContext);

  return { status: 'deleted' };
}

export async function getProfileActivity(event) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const client = await createDbClient();
  await client.connect();

  try {
    const result = await client.query(
      `
        select id::text as id, donation_mode, amount_cents, currency,
               dedication_name, t_shirt_preference, created_at
          from donation_events
         where user_id = $1::uuid
         order by created_at desc
         limit 200
      `,
      [authContext.userId]
    );

    return {
      donations: result.rows.map((row) => ({
        id: row.id,
        type: 'donation',
        donationMode: row.donation_mode,
        amountCents: Number(row.amount_cents ?? 0),
        currency: row.currency ?? 'usd',
        dedicationName: row.dedication_name,
        tShirtPreference: row.t_shirt_preference,
        createdAt: row.created_at
      }))
    };
  } finally {
    await client.end();
  }
}
