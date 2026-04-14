const color = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m'
};

const symbol = {
  pass: `${color.green}✓${color.reset}`,
  fail: `${color.red}✗${color.reset}`
};

/**
 * Tracks assertions and produces a summary.
 *
 * @param {string} runPrefix - The ci-<uuid> prefix for this run
 * @returns {{ pass, fail, assert, summary }}
 */
export function createReporter(runPrefix) {
  /** @type {Record<string, { passed: number, failed: number }>} */
  const scenarios = {};

  function ensure(scenario) {
    if (!scenarios[scenario]) {
      scenarios[scenario] = { passed: 0, failed: 0 };
    }
  }

  function pass(scenario, message) {
    ensure(scenario);
    scenarios[scenario].passed++;
    console.log(`  ${symbol.pass} ${message}`);
  }

  function fail(scenario, message, responseBody) {
    ensure(scenario);
    scenarios[scenario].failed++;
    console.log(`  ${symbol.fail} ${message}`);
    if (responseBody !== undefined) {
      const body = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2);
      console.log(`${color.red}  Response body: ${body}${color.reset}`);
    }
    console.log(`${color.dim}  Run_Prefix: ${runPrefix}${color.reset}`);
  }

  function assert(scenario, condition, message, responseBody) {
    if (condition) {
      pass(scenario, message);
    } else {
      fail(scenario, message, responseBody);
    }
  }

  function summary() {
    console.log(`\n${color.yellow}=== Test Summary (${runPrefix}) ===${color.reset}`);

    let totalPassed = 0;
    let totalFailed = 0;

    for (const [name, counts] of Object.entries(scenarios)) {
      totalPassed += counts.passed;
      totalFailed += counts.failed;
      const status = counts.failed === 0 ? symbol.pass : symbol.fail;
      console.log(`  ${status} ${name}: ${counts.passed} passed, ${counts.failed} failed`);
    }

    console.log(`\n${color.yellow}Total: ${totalPassed} passed, ${totalFailed} failed${color.reset}`);

    if (totalFailed === 0) {
      console.log(`${color.green}All tests passed.${color.reset}`);
      return 0;
    }
    console.log(`${color.red}Some tests failed.${color.reset}`);
    return 1;
  }

  return { pass, fail, assert, summary };
}
