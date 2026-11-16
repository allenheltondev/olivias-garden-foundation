import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildLoginPath, readAuthMode, resolveAuthRedirect } from '../src/auth/redirect-policy.mjs';

const site = 'https://oliviasgarden.org';
const options = {
  currentOrigin: site,
  trustedOrigins: ['https://grn.oliviasgarden.org', 'https://admin.oliviasgarden.org', ''],
};

describe('resolveAuthRedirect', () => {
  test('allows same-origin paths without handing off tokens', () => {
    assert.deepEqual(resolveAuthRedirect('/workshops/bees', options), {
      url: 'https://oliviasgarden.org/workshops/bees',
      crossOrigin: false,
    });
  });

  test('allows the planner and admin apps as cross-origin targets', () => {
    assert.deepEqual(resolveAuthRedirect('https://grn.oliviasgarden.org/garden?x=1', options), {
      url: 'https://grn.oliviasgarden.org/garden?x=1',
      crossOrigin: true,
    });
    assert.equal(resolveAuthRedirect('https://admin.oliviasgarden.org/', options)?.crossOrigin, true);
  });

  test('allows https sibling subdomains such as the store', () => {
    assert.equal(resolveAuthRedirect('https://store.oliviasgarden.org/cart', options)?.crossOrigin, true);
    assert.equal(
      resolveAuthRedirect('https://store.oliviasgarden.org/', { ...options, currentOrigin: 'https://www.oliviasgarden.org' })?.crossOrigin,
      true,
    );
  });

  test('rejects other sites, lookalikes, and downgraded subdomains', () => {
    for (const target of [
      'https://evil.example/',
      'https://oliviasgarden.org.evil.example/',
      'https://evil-oliviasgarden.org/',
      'http://store.oliviasgarden.org/',
      '//evil.example/path',
      'https://user:pass@grn.oliviasgarden.org/',
    ]) {
      assert.equal(resolveAuthRedirect(target, options), null, target);
    }
  });

  test('rejects script and data URLs', () => {
    assert.equal(resolveAuthRedirect('javascript:alert(1)', options), null);
    assert.equal(resolveAuthRedirect('data:text/html,hi', options), null);
  });

  test('ignores empty or non-string input', () => {
    assert.equal(resolveAuthRedirect('', options), null);
    assert.equal(resolveAuthRedirect(null, options), null);
    assert.equal(resolveAuthRedirect(42, options), null);
  });

  test('does not widen trust to subdomains of a bare host such as localhost', () => {
    const local = { currentOrigin: 'http://localhost:5173', trustedOrigins: ['http://localhost:5174'] };
    assert.equal(resolveAuthRedirect('http://localhost:5174/', local)?.crossOrigin, true);
    assert.equal(resolveAuthRedirect('https://evil.localhost/', local), null);
  });
});

describe('readAuthMode', () => {
  test('reads signup and login, ignores anything else', () => {
    assert.equal(readAuthMode('?mode=signup'), 'signup');
    assert.equal(readAuthMode('?mode=login&redirect=/x'), 'login');
    assert.equal(readAuthMode('?mode=admin'), null);
    assert.equal(readAuthMode(''), null);
  });
});

describe('buildLoginPath', () => {
  test('encodes mode and redirect', () => {
    assert.equal(
      buildLoginPath({ mode: 'signup', redirect: 'https://grn.oliviasgarden.org' }),
      '/login?mode=signup&redirect=https%3A%2F%2Fgrn.oliviasgarden.org',
    );
    assert.equal(buildLoginPath(), '/login');
  });

  test('round-trips through readAuthMode and URLSearchParams', () => {
    const path = buildLoginPath({ mode: 'signup', redirect: 'https://grn.oliviasgarden.org/?a=1&b=2' });
    const search = path.slice(path.indexOf('?'));
    assert.equal(readAuthMode(search), 'signup');
    assert.equal(new URLSearchParams(search).get('redirect'), 'https://grn.oliviasgarden.org/?a=1&b=2');
  });
});
