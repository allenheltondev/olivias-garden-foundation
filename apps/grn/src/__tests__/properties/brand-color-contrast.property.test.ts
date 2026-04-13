import { describe, it, expect } from 'vitest';
import { brandConfig } from '../../config/brand';
import fc from 'fast-check';

/**
 * Property 4: Brand Color Contrast
 *
 * **Validates: Requirements 7.4**
 *
 * For any brand color used for text or interactive elements, the color SHALL maintain
 * a contrast ratio of at least 4.5:1 against its background for normal text, or 3:1 for
 * large text, meeting WCAG AA standards.
 */
describe('Property 4: Brand Color Contrast', () => {
  // Helper function to convert hex to RGB
  function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  // Calculate relative luminance
  function getLuminance(hex: string): number {
    const rgb = hexToRgb(hex);
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
      const sRGB = val / 255;
      return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Calculate contrast ratio
  function getContrastRatio(foreground: string, background: string): number {
    const l1 = getLuminance(foreground);
    const l2 = getLuminance(background);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Brand colors to test
  const brandColors = {
    primary: brandConfig.colors.primary,      // #3F7D3A (green)
    background: brandConfig.colors.background, // #F7F5EF (cream)
    themeColor: brandConfig.colors.themeColor, // #3F7D3A (green)
  };

  // Common background colors used in the app
  const backgrounds = {
    white: '#FFFFFF',
    cream: brandConfig.colors.background,
    lightGray: '#F3F4F6',
    darkGray: '#1F2937',
  };

  it('should maintain WCAG AA contrast for normal text (4.5:1)', () => {
    // Test primary green on light backgrounds
    const primaryOnWhite = getContrastRatio(brandColors.primary, backgrounds.white);
    expect(primaryOnWhite, 'Primary green on white should meet WCAG AA').toBeGreaterThanOrEqual(4.5);

    const primaryOnCream = getContrastRatio(brandColors.primary, backgrounds.cream);
    expect(primaryOnCream, 'Primary green on cream should meet WCAG AA').toBeGreaterThanOrEqual(4.5);

    const primaryOnLightGray = getContrastRatio(brandColors.primary, backgrounds.lightGray);
    expect(primaryOnLightGray, 'Primary green on light gray should meet WCAG AA').toBeGreaterThanOrEqual(4.5);
  });

  it('should maintain WCAG AA contrast for large text (3:1)', () => {
    // Test primary green on light backgrounds for large text (18pt+)
    const primaryOnWhite = getContrastRatio(brandColors.primary, backgrounds.white);
    expect(primaryOnWhite, 'Primary green on white should meet WCAG AA for large text').toBeGreaterThanOrEqual(3.0);

    const primaryOnCream = getContrastRatio(brandColors.primary, backgrounds.cream);
    expect(primaryOnCream, 'Primary green on cream should meet WCAG AA for large text').toBeGreaterThanOrEqual(3.0);
  });

  it('should verify contrast ratios for all brand color combinations', () => {
    // Only test valid combinations (light text on dark, dark text on light)
    const validCombinations = [
      { foreground: brandColors.primary, background: backgrounds.white, fontSize: 14 },
      { foreground: brandColors.primary, background: backgrounds.white, fontSize: 18 },
      { foreground: brandColors.primary, background: backgrounds.cream, fontSize: 14 },
      { foreground: brandColors.primary, background: backgrounds.cream, fontSize: 18 },
      { foreground: brandColors.primary, background: backgrounds.lightGray, fontSize: 14 },
      { foreground: brandColors.primary, background: backgrounds.lightGray, fontSize: 18 },
      // White text on dark backgrounds
      { foreground: backgrounds.white, background: brandColors.primary, fontSize: 14 },
      { foreground: backgrounds.white, background: brandColors.primary, fontSize: 18 },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...validCombinations),
        (combo) => {
          const ratio = getContrastRatio(combo.foreground, combo.background);

          // WCAG AA requirements
          const requiredRatio = combo.fontSize >= 18 ? 3.0 : 4.5;

          // Verify contrast ratio meets or exceeds requirement
          expect(ratio,
            `Contrast ratio ${ratio.toFixed(2)}:1 for ${combo.foreground} on ${combo.background} (${combo.fontSize}pt) should be >= ${requiredRatio}:1`
          ).toBeGreaterThanOrEqual(requiredRatio);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should calculate specific contrast ratios for documentation', () => {
    // Document actual contrast ratios for reference
    const primaryOnWhite = getContrastRatio(brandColors.primary, backgrounds.white);
    const primaryOnCream = getContrastRatio(brandColors.primary, backgrounds.cream);

    console.log('Brand Color Contrast Ratios:');
    console.log(`  Primary (#3F7D3A) on White: ${primaryOnWhite.toFixed(2)}:1`);
    console.log(`  Primary (#3F7D3A) on Cream: ${primaryOnCream.toFixed(2)}:1`);

    // Verify they meet minimum standards
    expect(primaryOnWhite).toBeGreaterThanOrEqual(4.5);
    expect(primaryOnCream).toBeGreaterThanOrEqual(4.5);
  });
});
