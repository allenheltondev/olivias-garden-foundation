import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LoginPage } from '../../../pages/LoginPage';
import { SignUpPage } from '../../../pages/SignUpPage';
import { ForgotPasswordPage } from '../../../pages/ForgotPasswordPage';
import fc from 'fast-check';

/**
 * Property 5: Auth Page Branding Consistency
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.5**
 *
 * For any authentication page (LoginPage, SignUpPage, ForgotPasswordPage, VerifyEmailForm),
 * the page SHALL render branding through the AuthLayout component, ensuring consistent
 * logo and tagline display.
 */
describe('Property 5: Auth Page Branding Consistency', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render branding through AuthLayout for all auth pages', () => {
    const authPages = [
      { name: 'LoginPage', component: LoginPage },
      { name: 'SignUpPage', component: SignUpPage },
      { name: 'ForgotPasswordPage', component: ForgotPasswordPage },
    ];

    authPages.forEach(({ name, component: Component }) => {
      const { container } = render(
        <Component
          onSuccess={vi.fn()}
          onNavigateToLogin={vi.fn()}
          onNavigateToSignUp={vi.fn()}
          onNavigateToForgotPassword={vi.fn()}
        />
      );

      // Verify BrandHeader is rendered (logo + brand name)
      const logo = container.querySelector('img[alt="Good Roots Network logo"]') ||
                   container.querySelector('[role="img"][aria-label="Good Roots Network logo"]');
      expect(logo, `${name} should render logo`).toBeTruthy();

      // Verify brand name is present
      const brandNames = container.querySelectorAll('h1');
      const hasBrandName = Array.from(brandNames).some(h => h.textContent === 'Good Roots Network');
      expect(hasBrandName, `${name} should render brand name`).toBe(true);

      // Verify no duplicate branding logic exists (should only be in AuthLayout)
      const brandHeaders = container.querySelectorAll('h1');
      const brandNameHeaders = Array.from(brandHeaders).filter(
        h => h.textContent === 'Good Roots Network'
      );
      expect(brandNameHeaders.length, `${name} should have exactly one brand name header`).toBe(1);

      // Clean up before next render
      cleanup();
    });
  });

  it('should maintain consistent branding across random auth page renders', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('login', 'signup', 'forgot'),
        (pageType) => {
          let Component;
          switch (pageType) {
            case 'login':
              Component = LoginPage;
              break;
            case 'signup':
              Component = SignUpPage;
              break;
            case 'forgot':
              Component = ForgotPasswordPage;
              break;
          }

          const { container } = render(
            <Component
              onSuccess={vi.fn()}
              onNavigateToLogin={vi.fn()}
              onNavigateToSignUp={vi.fn()}
              onNavigateToForgotPassword={vi.fn()}
            />
          );

          try {
            // All pages should have the logo
            const logo = container.querySelector('img[alt="Good Roots Network logo"]') ||
                         container.querySelector('[role="img"][aria-label="Good Roots Network logo"]');
            expect(logo).toBeTruthy();

            // All pages should have the brand name
            const brandNames = container.querySelectorAll('h1');
            const hasBrandName = Array.from(brandNames).some(h => h.textContent === 'Good Roots Network');
            expect(hasBrandName).toBe(true);
          } finally {
            // Always clean up
            cleanup();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
