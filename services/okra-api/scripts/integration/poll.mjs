/**
 * Custom error thrown when polling exceeds the configured timeout.
 */
export class PollTimeoutError extends Error {
  /**
   * @param {string} message
   * @param {{ attempts: number, elapsedMs: number, lastResult: any, label?: string }} details
   */
  constructor(message, { attempts, elapsedMs, lastResult, label }) {
    super(message);
    this.name = 'PollTimeoutError';
    this.attempts = attempts;
    this.elapsedMs = elapsedMs;
    this.lastResult = lastResult;
    this.label = label;
  }
}

/**
 * Polls a function until a condition is met or timeout expires.
 *
 * @param {object} options
 * @param {() => Promise<any>} options.fn          - Async function to call each iteration
 * @param {(result: any) => boolean} options.until - Predicate: return true to stop polling
 * @param {number} [options.intervalMs=2000]       - Milliseconds between polls
 * @param {number} [options.timeoutMs=60000]       - Total timeout in milliseconds
 * @param {string} [options.label]                 - Label for diagnostic output on timeout
 * @returns {Promise<{ result: any, attempts: number, elapsedMs: number }>}
 * @throws {PollTimeoutError} with attempts, elapsedMs, lastResult, and label
 */
export async function poll({ fn, until, intervalMs = 2000, timeoutMs = 60000, label }) {
  const start = Date.now();
  let attempts = 0;
  let lastResult;

  while (true) {
    attempts++;
    lastResult = await fn();

    if (until(lastResult)) {
      return { result: lastResult, attempts, elapsedMs: Date.now() - start };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) {
      throw new PollTimeoutError(
        `Poll timed out after ${elapsed}ms / ${attempts} attempts${label ? ` [${label}]` : ''}`,
        { attempts, elapsedMs: elapsed, lastResult, label }
      );
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
