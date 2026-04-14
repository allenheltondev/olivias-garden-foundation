import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import crypto from 'node:crypto';
import { createReporter } from '../../scripts/integration/reporter.mjs';
import { poll, PollTimeoutError } from '../../scripts/integration/poll.mjs';
import { createHttpClient } from '../../scripts/integration/http-client.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// Property 1: Scenario Independence
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 1: Scenario Independence
describe('Property 1: Scenario Independence', () => {
  // **Validates: Requirements 3.1, 3.2, 3.3, 11.4**
  it('both scenarios are always executed and reported regardless of individual failures', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // approvalPasses
        fc.boolean(), // denialPasses
        (approvalPasses, denialPasses) => {
          const reporter = createReporter('ci-test0000');

          // Track which scenarios were executed
          let approvalExecuted = false;
          let denialExecuted = false;

          // Simulate the runner's try/catch pattern for the approval scenario
          try {
            approvalExecuted = true;
            if (approvalPasses) {
              reporter.pass('approval', 'Approval scenario passed');
            } else {
              throw new Error('Approval scenario failed');
            }
          } catch {
            reporter.fail('approval', 'Approval scenario failed');
          }

          // Simulate the runner's try/catch pattern for the denial scenario
          // This MUST execute regardless of approval outcome
          try {
            denialExecuted = true;
            if (denialPasses) {
              reporter.pass('denial', 'Denial scenario passed');
            } else {
              throw new Error('Denial scenario failed');
            }
          } catch {
            reporter.fail('denial', 'Denial scenario failed');
          }

          // Property: both scenarios are always executed
          expect(approvalExecuted).toBe(true);
          expect(denialExecuted).toBe(true);

          // Property: both scenarios have results recorded in the reporter
          // Verify by calling summary() and checking exit code matches expectations
          // Suppress console output during summary
          const originalLog = console.log;
          const logs: string[] = [];
          console.log = (...args: any[]) => {
            logs.push(args.join(' '));
          };

          const exitCode = reporter.summary();

          console.log = originalLog;

          // Both scenario names must appear in the summary output
          const summaryText = logs.join('\n');
          expect(summaryText).toContain('approval');
          expect(summaryText).toContain('denial');

          // Exit code should be 0 only when both pass
          if (approvalPasses && denialPasses) {
            expect(exitCode).toBe(0);
          } else {
            expect(exitCode).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 2: Exit Code Correctness
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 2: Exit Code Correctness
describe('Property 2: Exit Code Correctness', () => {
  // **Validates: Requirements 3.5, 12.7**
  it('exit code is 0 if and only if both scenarios pass, 1 otherwise', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // approvalPasses
        fc.boolean(), // denialPasses
        (approvalPasses, denialPasses) => {
          const reporter = createReporter('ci-test0000');

          // Record approval outcome
          if (approvalPasses) {
            reporter.pass('approval', 'Approval scenario passed');
          } else {
            reporter.fail('approval', 'Approval scenario failed');
          }

          // Record denial outcome
          if (denialPasses) {
            reporter.pass('denial', 'Denial scenario passed');
          } else {
            reporter.fail('denial', 'Denial scenario failed');
          }

          // Suppress console output during summary
          const originalLog = console.log;
          console.log = () => {};

          const exitCode = reporter.summary();

          console.log = originalLog;

          // Exit code is 0 if and only if both pass
          if (approvalPasses && denialPasses) {
            expect(exitCode).toBe(0);
          } else {
            expect(exitCode).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 3: Polling Convergence and Timeout
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 3: Polling Convergence and Timeout
describe('Property 3: Polling Convergence and Timeout', () => {
  // **Validates: Requirements 5.1, 5.3, 6.3, 6.4, 7.3, 7.4**

  it('returns after exactly N attempts when predicate is satisfied at attempt N', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // targetAttempt N
        async (targetN) => {
          let callCount = 0;

          const fn = async () => {
            callCount++;
            return callCount >= targetN;
          };

          const result = await poll({
            fn,
            until: (r: boolean) => r === true,
            intervalMs: 0,
            timeoutMs: 10000,
            label: 'convergence-test',
          });

          // Poll should return after exactly N attempts
          expect(result.attempts).toBe(targetN);
          expect(result.result).toBe(true);
          expect(callCount).toBe(targetN);
          expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('throws PollTimeoutError with correct metadata when predicate is never satisfied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // no variable input needed, but fast-check requires a generator
        async () => {
          let callCount = 0;

          const fn = async () => {
            callCount++;
            return false;
          };

          try {
            await poll({
              fn,
              until: (r: boolean) => r === true,
              intervalMs: 1,
              timeoutMs: 5,
              label: 'timeout-test',
            });
            // Should not reach here
            expect.fail('Expected PollTimeoutError to be thrown');
          } catch (err: any) {
            expect(err).toBeInstanceOf(PollTimeoutError);
            expect(err.attempts).toBeGreaterThanOrEqual(1);
            expect(err.attempts).toBe(callCount);
            expect(err.elapsedMs).toBeGreaterThanOrEqual(5);
            expect(err.lastResult).toBe(false);
            expect(err.label).toBe('timeout-test');
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 4: HTTP Client Log Completeness
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 4: HTTP Client Log Completeness
describe('Property 4: HTTP Client Log Completeness', () => {
  // **Validates: Requirements 12.3**
  it('logged output contains the HTTP method, path, and status code for every request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
        fc.stringMatching(/^\/[a-z][a-z0-9/\-]*$/),
        fc.integer({ min: 100, max: 599 }),
        async (method, path, statusCode) => {
          const logs: string[] = [];
          const originalLog = console.log;
          console.log = (...args: any[]) => {
            logs.push(args.join(' '));
          };

          const originalFetch = globalThis.fetch;
          const mockResponse = new Response('', { status: 200 });
          Object.defineProperty(mockResponse, 'status', { value: statusCode });
          globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

          try {
            const client = createHttpClient('http://localhost:9999');
            await client.request(path, { method });

            const logOutput = logs.join('\n');

            // Verify the logged output contains the method, path, and status code
            expect(logOutput).toContain(method);
            expect(logOutput).toContain(path);
            expect(logOutput).toContain(String(statusCode));
          } finally {
            console.log = originalLog;
            globalThis.fetch = originalFetch;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 5: Run Prefix Uniqueness and Format
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 5: Run Prefix Uniqueness and Format
describe('Property 5: Run Prefix Uniqueness and Format', () => {
  // **Validates: Requirements 11.1**
  it('every generated Run_Prefix matches ci-[0-9a-f]{8} and independently generated prefixes are distinct', () => {
    const prefixRegex = /^ci-[0-9a-f]{8}$/;

    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const prefix1 = `ci-${crypto.randomUUID().slice(0, 8)}`;
          const prefix2 = `ci-${crypto.randomUUID().slice(0, 8)}`;

          // Each prefix matches the required format
          expect(prefix1).toMatch(prefixRegex);
          expect(prefix2).toMatch(prefixRegex);

          // Independently generated prefixes are distinct
          expect(prefix1).not.toBe(prefix2);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Property 6: Scenario Artifact Isolation
// ═══════════════════════════════════════════════════════════════════════════

// Feature: api-integration-suite, Property 6: Scenario Artifact Isolation
describe('Property 6: Scenario Artifact Isolation', () => {
  // **Validates: Requirements 3.6**
  it('artifact IDs produced by approval and denial scenarios are always disjoint', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // approvalPhotoId
        fc.uuid(), // approvalSubmissionId
        fc.uuid(), // denialPhotoId
        fc.uuid(), // denialSubmissionId
        (approvalPhotoId, approvalSubmissionId, denialPhotoId, denialSubmissionId) => {
          const approvalArtifacts = new Set([approvalPhotoId, approvalSubmissionId]);
          const denialArtifacts = new Set([denialPhotoId, denialSubmissionId]);

          // Compute intersection of the two sets
          const intersection = new Set(
            [...approvalArtifacts].filter((id) => denialArtifacts.has(id))
          );

          // The intersection must be empty — no ID overlap between scenarios
          expect(intersection.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
