import { describe, expect, it, vi } from 'vitest';
import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import {
  insertPendingSubmissionWithPhotos,
  submissionSchema,
  submitContributorSubmissionEdit
} from '../../src/services/submissions.mjs';

describe('submission payload validation', () => {
  it('accepts valid payload', () => {
    expect(() =>
      validate({
        payload: {
          rawLocationText: 'Austin, TX',
          displayLat: 30.2672,
          displayLng: -97.7431,
          privacyMode: 'city',
          photoIds: ['550e8400-e29b-41d4-a716-446655440000']
        },
        schema: submissionSchema
      })
    ).not.toThrow();
  });

  it('rejects invalid coordinates', () => {
    expect(() =>
      validate({
        payload: {
          rawLocationText: 'Austin, TX',
          displayLat: 120,
          displayLng: -500,
          photoIds: ['550e8400-e29b-41d4-a716-446655440000']
        },
        schema: submissionSchema
      })
    ).toThrow(SchemaValidationError);
  });
});

describe('submitContributorSubmissionEdit', () => {
  const editPayload = {
    contributorName: 'Edited Grower',
    storyText: 'Edited story',
    rawLocationText: 'McKinney, TX',
    privacyMode: 'city',
    displayLat: 33.1972,
    displayLng: -96.6398,
    photoIds: ['550e8400-e29b-41d4-a716-446655440012'],
    removePhotoIds: ['550e8400-e29b-41d4-a716-446655440011'],
    editClientKey: 'edit-key-1'
  };

  it('creates a pending edit for approved submissions and marks new photos pending review', async () => {
    const client = {
      query: vi.fn((text) => {
        const sql = String(text);
        if (text === 'begin' || text === 'commit' || text === 'rollback') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes('from submissions') && sql.includes('for update')) {
          return Promise.resolve({ rows: [{ id: 'sub-1', status: 'approved' }], rowCount: 1 });
        }
        if (sql.includes('client_edit_key') && sql.includes('select id')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes('from submission_photos') && sql.includes('review_status')) {
          return Promise.resolve({ rows: [{ id: '550e8400-e29b-41d4-a716-446655440011' }], rowCount: 1 });
        }
        if (sql.includes('update submission_photos') && sql.includes('submission_id is null')) {
          expect(sql).toContain("review_status = case when $3::boolean then 'pending_edit'");
          return Promise.resolve({ rows: [{ id: editPayload.photoIds[0] }], rowCount: 1 });
        }
        if (sql.includes('update submission_edits') && sql.includes('Superseded')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes('insert into submission_edits')) {
          return Promise.resolve({
            rows: [{ id: 'edit-1', status: 'pending_review', created_at: '2026-04-27T12:00:00.000Z' }],
            rowCount: 1
          });
        }
        if (sql.includes('insert into submission_edit_photos')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };

    const result = await submitContributorSubmissionEdit(client, 'sub-1', 'user-1', editPayload);

    expect(result.editId).toBe('edit-1');
    expect(result.status).toBe('pending_review');
    expect(result.queuedPhotoIds).toEqual(editPayload.photoIds);
  });

  it('returns an existing edit for idempotent replays before claiming photos', async () => {
    const client = {
      query: vi.fn((text) => {
        const sql = String(text);
        if (text === 'begin' || text === 'commit' || text === 'rollback') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes('from submissions') && sql.includes('for update')) {
          return Promise.resolve({ rows: [{ id: 'sub-1', status: 'approved' }], rowCount: 1 });
        }
        if (sql.includes('client_edit_key') && sql.includes('select id')) {
          return Promise.resolve({
            rows: [{ id: 'edit-1', status: 'pending_review', created_at: '2026-04-27T12:00:00.000Z' }],
            rowCount: 1
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };

    const result = await submitContributorSubmissionEdit(client, 'sub-1', 'user-1', editPayload);

    expect(result.idempotentReplay).toBe(true);
    expect(client.query.mock.calls.some(([text]) => String(text).includes('submission_id is null'))).toBe(false);
  });
});

describe('insertPendingSubmissionWithPhotos', () => {
  const payload = {
    contributorName: 'Okra Grower',
    contributorEmail: 'okra@example.com',
    contributorCognitoSub: 'user-123',
    storyText: 'Backyard okra patch',
    rawLocationText: 'Austin, TX',
    privacyMode: 'city',
    displayLat: 30.2672,
    displayLng: -97.7431,
    photoIds: ['550e8400-e29b-41d4-a716-446655440000']
  };

  it('stores contributor auth linkage when the column exists', async () => {
    const client = {
      query: vi.fn((text, params) => {
        if (text === 'begin' || text === 'commit' || text === 'rollback') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (String(text).includes('information_schema.columns')) {
          return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
        }
        if (String(text).includes('insert into submissions')) {
          return Promise.resolve({
            rows: [{ id: 'sub-1', status: 'pending_review', created_at: '2026-04-22T12:00:00.000Z' }],
            rowCount: 1
          });
        }
        if (String(text).includes('update submission_photos')) {
          return Promise.resolve({
            rows: [{ id: payload.photoIds[0], original_s3_key: 'temp-photos/photo/original' }],
            rowCount: 1
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };

    await insertPendingSubmissionWithPhotos(client, payload);

    const insertCall = client.query.mock.calls.find(([text]) => String(text).includes('insert into submissions'));
    expect(insertCall[0]).toContain('contributor_cognito_sub');
    expect(insertCall[1][2]).toBe('user-123');
  });

  it('omits contributor auth linkage when the column is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      query: vi.fn((text, params) => {
        if (text === 'begin' || text === 'commit' || text === 'rollback') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (String(text).includes('information_schema.columns')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (String(text).includes('insert into submissions')) {
          return Promise.resolve({
            rows: [{ id: 'sub-1', status: 'pending_review', created_at: '2026-04-22T12:00:00.000Z' }],
            rowCount: 1
          });
        }
        if (String(text).includes('update submission_photos')) {
          return Promise.resolve({
            rows: [{ id: payload.photoIds[0], original_s3_key: 'temp-photos/photo/original' }],
            rowCount: 1
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      })
    };

    await insertPendingSubmissionWithPhotos(client, payload);

    const insertCall = client.query.mock.calls.find(([text]) => String(text).includes('insert into submissions'));
    expect(insertCall[0]).not.toContain('contributor_cognito_sub');
    expect(insertCall[1]).not.toContain('user-123');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
