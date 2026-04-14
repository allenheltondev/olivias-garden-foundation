import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import { isUuid, photoCreateSchema } from '../../src/services/photos.mjs';

describe('photo create validation', () => {
  it('accepts supported contentType', () => {
    expect(() =>
      validate({ payload: { contentType: 'image/jpeg', fileName: 'okra.jpg' }, schema: photoCreateSchema })
    ).not.toThrow();
  });

  it('rejects unsupported contentType', () => {
    expect(() =>
      validate({ payload: { contentType: 'application/pdf' }, schema: photoCreateSchema })
    ).toThrow(SchemaValidationError);
  });

  it('validates uuid helper', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
