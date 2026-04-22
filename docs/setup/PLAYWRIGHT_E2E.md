# Playwright E2E Strategy

Playwright tests in `apps/web/tests` are intended to verify real UI workflows against a deployed environment.

## Default policy

- Use a real deployed site via `PLAYWRIGHT_BASE_URL`
- Exercise real browser behavior and real backend integrations
- Do not mock app API responses for workflow tests
- Run tests against staging as the default operating mode

## Required environment variables

- `PLAYWRIGHT_BASE_URL`
  Use the deployed staging environment you want to validate.

## Optional environment variables

- `OGF_CI_USERNAME` / `OGF_CI_PASSWORD`
  Required for signed-in profile workflow tests.

## PowerShell examples

Run the full deployed suite against staging:

```powershell
cd apps/web
$env:PLAYWRIGHT_BASE_URL = "https://your-staging-site"
npm run test:e2e
```

Run only the okra submission workflow against staging:

```powershell
cd apps/web
$env:PLAYWRIGHT_BASE_URL = "https://your-staging-site"
npm run test:e2e -- okra-submission.spec.ts
```

## Notes

- The okra submission test creates a real submission in the target environment.
- The donation flow opens a real staging Stripe checkout session.
- Signed-in profile tests still require valid staging credentials.
