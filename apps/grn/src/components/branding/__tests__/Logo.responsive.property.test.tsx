import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from '../Logo';
import fc from 'fast-check';

/**
 * Property 2: Responsive Logo Sizing
 *
 * **Validates: Requirements 1.5, 9.1, 9.2, 9.3, 9.4**
 *
 * For any viewport size and logo size prop, the logo SHALL render at an
 * appropriate size and maintain its aspect ratio.
 */
describe('Property 2: Responsive Logo Sizing', () => {
  it('should render at appropriate size and maintain aspect ratio for all size props', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('full', 'horizontal', 'icon'),
        fc.constantFrom('sm', 'md', 'lg', 'xl'),
        (variant, size) => {
          const { container } = render(
            <Logo
              variant={variant as 'full' | 'horizontal' | 'icon'}
              size={size as 'sm' | 'md' | 'lg' | 'xl'}
            />
          );

          const img = container.querySelector('img');
          const fallback = container.querySelector('[role="img"]');
          const element = img || fallback;

          expect(element).toBeTruthy();

          // Verify size class is applied
          const sizeClasses = {
            sm: 'h-8',
            md: 'h-12',
            lg: 'h-16',
            xl: 'h-24',
          };

          expect(element?.className).toContain(sizeClasses[size as keyof typeof sizeClasses]);

          // Verify aspect ratio preservation (w-auto for images)
          if (img) {
            expect(img.className).toContain('w-auto');
            expect(img.className).toContain('object-contain');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
