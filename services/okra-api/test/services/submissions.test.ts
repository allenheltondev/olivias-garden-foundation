import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import { submissionSchema } from '../../src/services/submissions.mjs';

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
