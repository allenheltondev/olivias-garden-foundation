export const VALID_PRIVACY_MODES = new Set(['exact', 'nearby', 'neighborhood', 'city']);

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const submissionSchema = {
  type: 'object',
  required: ['rawLocationText', 'displayLat', 'displayLng', 'photoIds'],
  properties: {
    contributorName: { type: 'string' },
    contributorEmail: { type: 'string' },
    storyText: { type: 'string' },
    rawLocationText: { type: 'string' },
    privacyMode: {
      type: 'string',
      enum: ['exact', 'nearby', 'neighborhood', 'city']
    },
    displayLat: { type: 'number', minimum: -90, maximum: 90 },
    displayLng: { type: 'number', minimum: -180, maximum: 180 },
    photoIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: UUID_PATTERN }
    }
  },
  additionalProperties: false
};

function firstDefinedValue(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

export function enrichSubmissionPayload(payload, contributor) {
  if (!contributor) {
    return payload;
  }

  return {
    ...payload,
    contributorName: firstDefinedValue(payload.contributorName, contributor.name, contributor.email),
    contributorEmail: firstDefinedValue(payload.contributorEmail, contributor.email),
    contributorCognitoSub: firstDefinedValue(payload.contributorCognitoSub, contributor.sub)
  };
}

export async function insertPendingSubmissionWithPhotos(client, payload) {
  await client.query('begin');

  try {
    const submissionResult = await client.query(
      `
        insert into submissions (
          contributor_name,
          contributor_email,
          contributor_cognito_sub,
          story_text,
          raw_location_text,
          privacy_mode,
          display_lat,
          display_lng,
          status
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review')
        returning id, status, created_at
      `,
      [
        payload.contributorName ?? null,
        payload.contributorEmail ?? null,
        payload.contributorCognitoSub ?? null,
        payload.storyText ?? null,
        payload.rawLocationText,
        payload.privacyMode ?? 'city',
        payload.displayLat,
        payload.displayLng
      ]
    );

    const created = submissionResult.rows[0];

    const claimResult = await client.query(
      `
        update submission_photos
        set submission_id = $1,
            claimed_at = now(),
            expires_at = null
        where id = any($2::uuid[])
          and submission_id is null
          and (expires_at is null or expires_at > now())
      `,
      [created.id, payload.photoIds]
    );

    if (claimResult.rowCount !== payload.photoIds.length) {
      throw Object.assign(new Error('One or more photoIds are invalid, expired, or already claimed'), {
        code: 'INVALID_PHOTO_IDS'
      });
    }

    await client.query('commit');
    return {
      ...created,
      claimedPhotoIds: payload.photoIds
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
