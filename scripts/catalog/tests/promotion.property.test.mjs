import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

function partition(records) {
  let promoted = 0;
  let review = 0;
  let unresolved = 0;
  let excluded = 0;
  for (const rec of records) {
    const valid = Boolean(rec.canonical_id && rec.scientific_name && rec.common_name);
    if ((rec.catalog_status === 'core' || rec.catalog_status === 'extended') && rec.review_status === 'auto_approved' && valid) promoted += 1;
    else if (rec.catalog_status === 'excluded') excluded += 1;
    else if (rec.review_status === 'needs_review') review += 1;
    else unresolved += 1;
  }
  return { promoted, review, unresolved, excluded };
}

test('promotion partition is exhaustive', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          canonical_id: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          scientific_name: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          common_name: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
          catalog_status: fc.constantFrom('core', 'extended', 'excluded', 'hidden'),
          review_status: fc.constantFrom('auto_approved', 'needs_review', 'rejected'),
        }),
        { maxLength: 80 },
      ),
      async (records) => {
        const r = partition(records);
        assert.equal(r.promoted + r.review + r.unresolved + r.excluded, records.length);
      },
    ),
  );
});
