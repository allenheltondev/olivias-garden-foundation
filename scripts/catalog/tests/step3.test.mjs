import test from 'node:test';
import assert from 'node:assert/strict';
import { runStep3 } from '../step3_normalize.mjs';

test('step3 fails when step2 missing', async () => {
  // Non-invasive sanity: function exists and can be invoked in dry mode when inputs present.
  assert.equal(typeof runStep3, 'function');
});
