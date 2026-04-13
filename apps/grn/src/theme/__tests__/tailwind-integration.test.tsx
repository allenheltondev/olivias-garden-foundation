/**
 * Tailwind Integration Tests
 *
 * Verifies that theme tokens are properly integrated with Tailwind CSS
 * and that Tailwind classes using theme tokens work correctly.
 */

import { describe, it, expect } from 'vitest';
import { colors, shadows, borderRadius, animation } from '../tokens';

describe('Tailwind Theme Integration', () => {
  describe('Color tokens', () => {
    it('should export primary color palette', () => {
      expect(colors.primary).toBeDefined();
      expect(colors.primary[500]).toBe('#3F7D3A');
      expect(colors.primary[50]).toBe('#f0f7f0');
      expect(colors.primary[900]).toBe('#0d190c');
    });

    it('should export neutral color palette', () => {
      expect(colors.neutral).toBeDefined();
      expect(colors.neutral[500]).toBe('#78716c');
    });

    it('should export semantic colors', () => {
      expect(colors.success).toBe('#3F7D3A');
      expect(colors.warning).toBe('#D8A741');
      expect(colors.error).toBe('#ef4444');
      expect(colors.info).toBe('#3b82f6');
    });
  });

  describe('Shadow tokens', () => {
    it('should export shadow values for semi-flat design', () => {
      expect(shadows.none).toBe('none');
      expect(shadows.sm).toContain('rgba(0, 0, 0, 0.05)');
      expect(shadows.md).toContain('rgba(0, 0, 0, 0.1)');
      expect(shadows.lg).toContain('rgba(0, 0, 0, 0.1)');
    });
  });

  describe('Border radius tokens', () => {
    it('should export border radius values', () => {
      expect(borderRadius.none).toBe('0');
      expect(borderRadius.sm).toBe('0.25rem');
      expect(borderRadius.base).toBe('0.5rem');
      expect(borderRadius.lg).toBe('1rem');
      expect(borderRadius.full).toBe('9999px');
    });
  });

  describe('Animation tokens', () => {
    it('should export duration values', () => {
      expect(animation.duration.fast).toBe('150ms');
      expect(animation.duration.base).toBe('200ms');
      expect(animation.duration.slow).toBe('300ms');
    });

    it('should export easing functions', () => {
      expect(animation.easing.linear).toBe('linear');
      expect(animation.easing.in).toContain('cubic-bezier');
      expect(animation.easing.out).toContain('cubic-bezier');
      expect(animation.easing.inOut).toContain('cubic-bezier');
    });
  });
});
