/**
 * Button Component Tests
 *
 * Tests all variants, sizes, states, and accessibility features of the Button component.
 * Requirements: 4.3, 7.2
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button Component', () => {
  describe('Variants', () => {
    it('should render primary variant with correct styles', () => {
      render(<Button variant="primary">Primary Button</Button>);
      const button = screen.getByRole('button', { name: /primary button/i });

      expect(button).toBeInTheDocument();
      expect(button.className).toContain('bg-primary-600');
      expect(button.className).toContain('text-white');
      expect(button.className).toContain('shadow-md');
    });

    it('should render secondary variant with correct styles', () => {
      render(<Button variant="secondary">Secondary Button</Button>);
      const button = screen.getByRole('button', { name: /secondary button/i });

      expect(button.className).toContain('from-neutral-100');
      expect(button.className).toContain('to-neutral-200');
      expect(button.className).toContain('text-neutral-800');
      expect(button.className).toContain('shadow-sm');
    });

    it('should render outline variant with correct styles', () => {
      render(<Button variant="outline">Outline Button</Button>);
      const button = screen.getByRole('button', { name: /outline button/i });

      expect(button.className).toContain('bg-transparent');
      expect(button.className).toContain('border-2');
      expect(button.className).toContain('border-primary-600');
      expect(button.className).toContain('text-primary-600');
    });

    it('should render ghost variant with correct styles', () => {
      render(<Button variant="ghost">Ghost Button</Button>);
      const button = screen.getByRole('button', { name: /ghost button/i });

      expect(button.className).toContain('bg-transparent');
      expect(button.className).toContain('text-neutral-700');
    });

    it('should default to primary variant when not specified', () => {
      render(<Button>Default Button</Button>);
      const button = screen.getByRole('button', { name: /default button/i });

      expect(button.className).toContain('bg-primary-600');
    });
  });

  describe('Sizes', () => {
    it('should render small size with correct styles', () => {
      render(<Button size="sm">Small Button</Button>);
      const button = screen.getByRole('button', { name: /small button/i });

      expect(button.className).toContain('px-3');
      expect(button.className).toContain('py-1.5');
      expect(button.className).toContain('text-sm');
      expect(button.className).toContain('rounded-base');
    });

    it('should render medium size with correct styles', () => {
      render(<Button size="md">Medium Button</Button>);
      const button = screen.getByRole('button', { name: /medium button/i });

      expect(button.className).toContain('px-4');
      expect(button.className).toContain('py-2');
      expect(button.className).toContain('text-base');
      expect(button.className).toContain('rounded-base');
    });

    it('should render large size with correct styles', () => {
      render(<Button size="lg">Large Button</Button>);
      const button = screen.getByRole('button', { name: /large button/i });

      expect(button.className).toContain('px-6');
      expect(button.className).toContain('py-3');
      expect(button.className).toContain('text-lg');
      expect(button.className).toContain('rounded-md');
    });

    it('should default to medium size when not specified', () => {
      render(<Button>Default Size</Button>);
      const button = screen.getByRole('button', { name: /default size/i });

      expect(button.className).toContain('px-4');
      expect(button.className).toContain('py-2');
    });
  });

  describe('Loading state', () => {
    it('should display loading spinner when loading is true', () => {
      render(<Button loading>Loading Button</Button>);
      const button = screen.getByRole('button', { name: /loading button/i });

      const spinner = button.querySelector('svg');
      expect(spinner).toBeInTheDocument();
      expect(spinner?.classList.contains('animate-spin')).toBe(true);
    });

    it('should be disabled when loading', () => {
      render(<Button loading>Loading Button</Button>);
      const button = screen.getByRole('button', { name: /loading button/i });

      expect(button).toBeDisabled();
    });

    it('should have aria-busy attribute when loading', () => {
      render(<Button loading>Loading Button</Button>);
      const button = screen.getByRole('button', { name: /loading button/i });

      expect(button).toHaveAttribute('aria-busy', 'true');
    });

    it('should not display spinner when loading is false', () => {
      render(<Button loading={false}>Not Loading</Button>);
      const button = screen.getByRole('button', { name: /not loading/i });

      const spinner = button.querySelector('svg');
      expect(spinner).not.toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled Button</Button>);
      const button = screen.getByRole('button', { name: /disabled button/i });

      expect(button).toBeDisabled();
    });

    it('should have reduced opacity when disabled', () => {
      render(<Button disabled>Disabled Button</Button>);
      const button = screen.getByRole('button', { name: /disabled button/i });

      expect(button.className).toContain('disabled:opacity-50');
      expect(button.className).toContain('disabled:cursor-not-allowed');
    });

    it('should have aria-disabled attribute when disabled', () => {
      render(<Button disabled>Disabled Button</Button>);
      const button = screen.getByRole('button', { name: /disabled button/i });

      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('should not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button disabled onClick={handleClick}>Disabled Button</Button>);
      const button = screen.getByRole('button', { name: /disabled button/i });

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('Click handlers', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button onClick={handleClick}>Click Me</Button>);
      const button = screen.getByRole('button', { name: /click me/i });

      await user.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when loading', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button loading onClick={handleClick}>Loading Button</Button>);
      const button = screen.getByRole('button', { name: /loading button/i });

      await user.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('should support multiple clicks', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button onClick={handleClick}>Click Me</Button>);
      const button = screen.getByRole('button', { name: /click me/i });

      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(handleClick).toHaveBeenCalledTimes(3);
    });
  });

  describe('Accessibility attributes', () => {
    it('should have type="button" by default', () => {
      render(<Button>Button</Button>);
      const button = screen.getByRole('button', { name: /button/i });

      expect(button).toHaveAttribute('type', 'button');
    });

    it('should support type="submit"', () => {
      render(<Button type="submit">Submit</Button>);
      const button = screen.getByRole('button', { name: /submit/i });

      expect(button).toHaveAttribute('type', 'submit');
    });

    it('should support type="reset"', () => {
      render(<Button type="reset">Reset</Button>);
      const button = screen.getByRole('button', { name: /reset/i });

      expect(button).toHaveAttribute('type', 'reset');
    });

    it('should have focus ring styles', () => {
      render(<Button>Focus Me</Button>);
      const button = screen.getByRole('button', { name: /focus me/i });

      expect(button.className).toContain('focus:outline-none');
      expect(button.className).toContain('focus:ring-2');
      expect(button.className).toContain('focus:ring-offset-2');
    });

    it('should be keyboard accessible', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button onClick={handleClick}>Keyboard Button</Button>);
      const button = screen.getByRole('button', { name: /keyboard button/i });

      button.focus();
      expect(button).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should support space key activation', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(<Button onClick={handleClick}>Space Button</Button>);
      const button = screen.getByRole('button', { name: /space button/i });

      button.focus();
      await user.keyboard(' ');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Full width', () => {
    it('should render full width when fullWidth is true', () => {
      render(<Button fullWidth>Full Width Button</Button>);
      const button = screen.getByRole('button', { name: /full width button/i });

      expect(button.className).toContain('w-full');
    });

    it('should not render full width by default', () => {
      render(<Button>Normal Button</Button>);
      const button = screen.getByRole('button', { name: /normal button/i });

      expect(button.className).not.toContain('w-full');
    });
  });

  describe('Custom className', () => {
    it('should merge custom className with default styles', () => {
      render(<Button className="custom-class">Custom Button</Button>);
      const button = screen.getByRole('button', { name: /custom button/i });

      expect(button.className).toContain('custom-class');
      expect(button.className).toContain('bg-primary-600');
    });
  });

  describe('Ref forwarding', () => {
    it('should forward ref to button element', () => {
      const ref = { current: null as HTMLButtonElement | null };

      render(<Button ref={ref}>Ref Button</Button>);

      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe('Ref Button');
    });
  });

  describe('Transition styles', () => {
    it('should apply transition duration and easing', () => {
      render(<Button>Transition Button</Button>);
      const button = screen.getByRole('button', { name: /transition button/i });

      expect(button.className).toContain('transition-all');
      expect(button.style.transitionDuration).toBe('200ms');
      expect(button.style.transitionTimingFunction).toContain('cubic-bezier');
    });
  });

  describe('Combined states', () => {
    it('should render all size and variant combinations', () => {
      const variants = ['primary', 'secondary', 'outline', 'ghost'] as const;
      const sizes = ['sm', 'md', 'lg'] as const;

      variants.forEach(variant => {
        sizes.forEach(size => {
          const { unmount } = render(
            <Button variant={variant} size={size}>
              {variant} {size}
            </Button>
          );

          const button = screen.getByRole('button', { name: new RegExp(`${variant} ${size}`, 'i') });
          expect(button).toBeInTheDocument();

          unmount();
        });
      });
    });

    it('should handle loading and disabled together', () => {
      render(<Button loading disabled>Both States</Button>);
      const button = screen.getByRole('button', { name: /both states/i });

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
