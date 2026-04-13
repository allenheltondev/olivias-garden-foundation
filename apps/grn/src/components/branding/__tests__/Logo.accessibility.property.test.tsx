import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from '../Logo';
import fc from 'fast-check';

/**
 * Property 1: Logo Accessibility
 *
 * **Validates: Requirements 7.1, 7.3**
 *
 * For any logo instance rendered in the application, the image SHALL have
 * appropriate accessibility attributes (alt text describing "Good Roots Network logo"
 * for meaningful logos, or aria-hidden for decorative instances).
 */
describe('Property 1: Logo Accessibility', () => {
  it('should have appropriate accessibility attributes for all variants and contexts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('full', 'horizontal', 'icon'),
        fc.constantFrom('sm', 'md', 'lg', 'xl'),
        fc.boolean(),
        (variant, size, isDecorative) => {
          const { container } = render(
            <Logo
              variant={variant as 'full' | 'horizontal' | 'icon'}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
              className={isDecorative ? 'decorative' : ''}
            />
          );

          // Check for either img with alt text or element with aria-label
          const img = container.querySelector('img');
          const fallback = container.querySelector('[role="img"]');

          if (img) {
            // Image should have meaningful alt text
            expect(img.getAttribute('alt')).toBe('Good Roots Network logo');
          } else if (fallback) {
            // Fallback should have aria-label
            expect(fallback.getAttribute('aria-label')).toBe('Good Roots Network logo');
          } else {
            throw new Error('Logo must render either an img or an element with role="img"');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
