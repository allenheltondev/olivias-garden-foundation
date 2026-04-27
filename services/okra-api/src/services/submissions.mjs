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

export const submissionEditSchema = {
  type: 'object',
  required: ['rawLocationText', 'displayLat', 'displayLng', 'photoIds'],
  properties: {
    contributorName: { type: 'string' },
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
      items: { type: 'string', pattern: UUID_PATTERN }
    },
    removePhotoIds: {
      type: 'array',
      items: { type: 'string', pattern: UUID_PATTERN }
    },
    editClientKey: {
      type: 'string',
      minLength: 1,
      maxLength: 120
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

async function submissionsHasContributorAuthColumn(client) {
  const result = await client.query(
    `
      select 1
        from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'submissions'
         and column_name = 'contributor_cognito_sub'
       limit 1
    `
  );

  return result.rowCount > 0;
}

export async function insertPendingSubmissionWithPhotos(client, payload) {
  await client.query('begin');

  try {
    const hasContributorAuthColumn = await submissionsHasContributorAuthColumn(client);
    if (!hasContributorAuthColumn) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'submissions.contributor_cognito_sub is missing; storing submission without contributor auth linkage'
      }));
    }

    const insertColumns = [
      'contributor_name',
      'contributor_email',
      ...(hasContributorAuthColumn ? ['contributor_cognito_sub'] : []),
      'story_text',
      'raw_location_text',
      'privacy_mode',
      'display_lat',
      'display_lng',
      'status'
    ];
    const insertValues = [
      payload.contributorName ?? null,
      payload.contributorEmail ?? null,
      ...(hasContributorAuthColumn ? [payload.contributorCognitoSub ?? null] : []),
      payload.storyText ?? null,
      payload.rawLocationText,
      payload.privacyMode ?? 'city',
      payload.displayLat,
      payload.displayLng
    ];
    const insertPlaceholders = insertValues.map((_, index) => `$${index + 1}`);

    const submissionResult = await client.query(
      `
        insert into submissions (
          ${insertColumns.join(',\n          ')}
        ) values (${insertPlaceholders.join(', ')}, 'pending_review')
        returning id, status, created_at
      `,
      insertValues
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
        returning id, original_s3_key
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
      claimedPhotoIds: payload.photoIds,
      claimedPhotos: claimResult.rows
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function listContributorSubmissions(client, cognitoSub, cdnDomain) {
  const submissionsResult = await client.query(
    `
      select s.id, s.contributor_name, s.story_text, s.raw_location_text,
             s.privacy_mode, s.display_lat, s.display_lng, s.status, s.country,
             s.created_at, s.updated_at, s.edited_at, s.edit_count,
             exists (
               select 1 from submission_edits se
                where se.submission_id = s.id and se.status = 'pending_review'
             ) as has_pending_edit
        from submissions s
       where s.contributor_cognito_sub = $1
       order by s.created_at desc, s.id desc
    `,
    [cognitoSub]
  );

  const submissionIds = submissionsResult.rows.map((row) => row.id);
  const photosBySubmission = {};
  if (submissionIds.length > 0 && cdnDomain) {
    const photosResult = await client.query(
      `
        select submission_id, id,
               coalesce(thumbnail_s3_key, normalized_s3_key, original_s3_key) as display_s3_key
          from submission_photos
         where submission_id = any($1)
           and removed_at is null
           and not exists (
             select 1
               from submission_edit_photos sep
               join submission_edits se on se.id = sep.edit_id
              where sep.photo_id = submission_photos.id
                and sep.action = 'add'
                and se.status <> 'approved'
           )
           and review_status = 'approved'
         order by submission_id, created_at asc
      `,
      [submissionIds]
    );

    for (const photo of photosResult.rows) {
      if (!photosBySubmission[photo.submission_id]) {
        photosBySubmission[photo.submission_id] = [];
      }
      photosBySubmission[photo.submission_id].push({
        id: photo.id,
        url: `https://${cdnDomain}/${photo.display_s3_key}`
      });
    }
  }

  return submissionsResult.rows.map((row) => ({
    id: row.id,
    contributorName: row.contributor_name,
    storyText: row.story_text,
    rawLocationText: row.raw_location_text,
    privacyMode: row.privacy_mode,
    displayLat: row.display_lat,
    displayLng: row.display_lng,
    status: row.status,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    editCount: row.edit_count ?? 0,
    hasPendingEdit: row.has_pending_edit,
    photos: photosBySubmission[row.id] ?? []
  }));
}

export async function submitContributorSubmissionEdit(client, submissionId, cognitoSub, payload) {
  await client.query('begin');

  try {
    const submissionResult = await client.query(
      `
        select id, status
          from submissions
         where id = $1 and contributor_cognito_sub = $2
         for update
      `,
      [submissionId, cognitoSub]
    );

    if (submissionResult.rowCount === 0) {
      const error = new Error('Submission not found');
      error.code = 'SUBMISSION_NOT_FOUND';
      throw error;
    }

    const submission = submissionResult.rows[0];
    const removePhotoIds = payload.removePhotoIds ?? [];
    const editClientKey = payload.editClientKey?.trim() || null;

    if (submission.status === 'approved' && editClientKey) {
      const existingIdempotentEditResult = await client.query(
        `
          select id, status, created_at
            from submission_edits
           where submission_id = $1
             and client_edit_key = $2
           limit 1
        `,
        [submissionId, editClientKey]
      );
      if (existingIdempotentEditResult.rowCount > 0) {
        const edit = existingIdempotentEditResult.rows[0];
        await client.query('commit');
        return {
          submissionId,
          editId: edit.id,
          status: edit.status,
          createdAt: edit.created_at,
          queuedPhotoIds: [],
          idempotentReplay: true
        };
      }
    }

    const existingPhotoResult = await client.query(
      `
        select id
          from submission_photos
         where submission_id = $1
           and removed_at is null
           and review_status = 'approved'
      `,
      [submissionId]
    );
    const existingPhotoIds = existingPhotoResult.rows.map((row) => row.id);
    const keptExistingPhotoIds = existingPhotoIds.filter((id) => !removePhotoIds.includes(id));
    if (keptExistingPhotoIds.length + payload.photoIds.length < 1) {
      const error = new Error('At least one photo is required');
      error.code = 'MISSING_PHOTOS';
      throw error;
    }

    const claimResult = await client.query(
      `
        update submission_photos
        set submission_id = $1,
            claimed_at = now(),
            expires_at = null,
            review_status = case when $3::boolean then 'pending_edit' else review_status end
        where id = any($2::uuid[])
          and submission_id is null
          and (expires_at is null or expires_at > now())
        returning id
      `,
      [submissionId, payload.photoIds, submission.status === 'approved']
    );

    if (claimResult.rowCount !== payload.photoIds.length) {
      const error = new Error('One or more photoIds are invalid, expired, or already claimed');
      error.code = 'INVALID_PHOTO_IDS';
      throw error;
    }

    if (submission.status === 'approved') {
      const previousPendingEditResult = await client.query(
        `
          update submission_edits
             set status = 'denied',
                 reviewed_at = now(),
                 review_notes = coalesce(review_notes, 'Superseded by a newer contributor edit.')
           where submission_id = $1
             and status = 'pending_review'
           returning id
        `,
        [submissionId]
      );
      const supersededEditIds = previousPendingEditResult.rows.map((row) => row.id);
      if (supersededEditIds.length > 0) {
        await client.query(
          `
            update submission_photos sp
               set review_status = 'denied',
                   removed_at = now()
              from submission_edit_photos sep
             where sep.photo_id = sp.id
               and sep.action = 'add'
               and sep.edit_id = any($1::uuid[])
               and sp.removed_at is null
          `,
          [supersededEditIds]
        );
      }

      const editResult = await client.query(
        `
          insert into submission_edits (
            submission_id, contributor_name, story_text, raw_location_text,
            privacy_mode, display_lat, display_lng, status, client_edit_key
          ) values ($1, $2, $3, $4, $5, $6, $7, 'pending_review', $8)
          returning id, status, created_at
        `,
        [
          submissionId,
          payload.contributorName ?? null,
          payload.storyText ?? null,
          payload.rawLocationText,
          payload.privacyMode ?? 'city',
          payload.displayLat,
          payload.displayLng,
          editClientKey
        ]
      );
      const edit = editResult.rows[0];

      if (claimResult.rows.length > 0) {
        await client.query(
          `
            insert into submission_edit_photos (edit_id, photo_id, action)
            select $1, unnest($2::uuid[]), 'add'
          `,
          [edit.id, claimResult.rows.map((row) => row.id)]
        );
      }
      if (removePhotoIds.length > 0) {
        await client.query(
          `
            insert into submission_edit_photos (edit_id, photo_id, action)
            select $1, unnest($2::uuid[]), 'remove'
          `,
          [edit.id, removePhotoIds]
        );
      }

      await client.query('commit');
      return {
        submissionId,
        editId: edit.id,
        status: edit.status,
        createdAt: edit.created_at,
        queuedPhotoIds: claimResult.rows.map((row) => row.id)
      };
    }

    await client.query(
      `
        update submissions
           set contributor_name = $2,
               story_text = $3,
               raw_location_text = $4,
               privacy_mode = $5,
               display_lat = $6,
               display_lng = $7,
               status = 'pending_review',
               reviewed_by = null,
               reviewed_at = null,
               review_notes = null
         where id = $1
      `,
      [
        submissionId,
        payload.contributorName ?? null,
        payload.storyText ?? null,
        payload.rawLocationText,
        payload.privacyMode ?? 'city',
        payload.displayLat,
        payload.displayLng
      ]
    );

    if (removePhotoIds.length > 0) {
      await client.query(
        `
          update submission_photos
             set removed_at = now()
           where submission_id = $1
             and id = any($2::uuid[])
        `,
        [submissionId, removePhotoIds]
      );
    }

    await client.query('commit');
    return {
      submissionId,
      editId: null,
      status: 'pending_review',
      createdAt: new Date().toISOString(),
      queuedPhotoIds: claimResult.rows.map((row) => row.id)
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
