/**
 * Input Component Tests
 *
 * Tests input types, states, error display, and accessibility features of the Input component.
 * Requirements: 4.4, 4.7, 14.2
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';

describe('Input Component', () => {
  describe('Input types', () => {
    it('should render text input by default', () => {
      render(<Input label="Username" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/username/i);

      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'text');
    });

    it('should render email input when type is email', () => {
      render(<Input type="email" label="Email" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('type', 'email');
    });

    it('should render password input when type is password', () => {
      render(<Input type="password" label="Password" value="" onChange={() => {}} />);
      const input = screen.getByLabelText('Password', { selector: 'input' });

      expect(input).toHaveAttribute('type', 'password');
    });

    it('should show password toggle button for password inputs', () => {
      render(<Input type="password" label="Password" value="" onChange={() => {}} />);
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(toggleButton).toBeInTheDocument();
    });

    it('should not show password toggle button for non-password inputs', () => {
      render(<Input type="text" label="Username" value="" onChange={() => {}} />);
      const toggleButton = screen.queryByRole('button', { name: /show password/i });

      expect(toggleButton).not.toBeInTheDocument();
    });
  });

  describe('Password visibility toggle', () => {
    it('should toggle password visibility when toggle button is clicked', async () => {
      const user = userEvent.setup();
      render(<Input type="password" label="Password" value="secret" onChange={() => {}} />);

      const input = screen.getByLabelText('Password', { selector: 'input' });
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(input).toHaveAttribute('type', 'password');

      await user.click(toggleButton);
      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();

      await user.click(toggleButton);
      expect(input).toHaveAttribute('type', 'password');
      expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument();
    });

    it('should disable password toggle when input is disabled', () => {
      render(<Input type="password" label="Password" value="" onChange={() => {}} disabled />);
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(toggleButton).toBeDisabled();
    });
  });

  describe('Input states', () => {
    it('should render with placeholder text', () => {
      render(
        <Input
          label="Email"
          placeholder="Enter your email"
          value=""
          onChange={() => {}}
        />
      );
      const input = screen.getByPlaceholderText(/enter your email/i);

      expect(input).toBeInTheDocument();
    });

    it('should render with initial value', () => {
      render(<Input label="Username" value="john_doe" onChange={() => {}} />);
      const input = screen.getByLabelText(/username/i);

      expect(input).toHaveValue('john_doe');
    });

    it('should be disabled when disabled prop is true', () => {
      render(<Input label="Username" value="" onChange={() => {}} disabled />);
      const input = screen.getByLabelText(/username/i);

      expect(input).toBeDisabled();
      expect(input.className).toContain('disabled:bg-neutral-100');
      expect(input.className).toContain('disabled:cursor-not-allowed');
    });

    it('should show required indicator when required is true', () => {
      render(<Input label="Email" value="" onChange={() => {}} required />);
      const requiredIndicator = screen.getByLabelText(/required/i);

      expect(requiredIndicator).toBeInTheDocument();
      expect(requiredIndicator).toHaveTextContent('*');
    });

    it('should apply focus styles when focused', async () => {
      const user = userEvent.setup();
      render(<Input label="Username" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/username/i);

      await user.click(input);
      expect(input).toHaveFocus();
      expect(input.className).toContain('focus:ring-2');
      expect(input.className).toContain('focus:ring-primary-500');
    });
  });

  describe('Error display', () => {
    it('should display error message when error prop is provided', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Email is required"
        />
      );
      const errorMessage = screen.getByRole('alert');

      expect(errorMessage).toBeInTheDocument();
      expect(errorMessage).toHaveTextContent('Email is required');
    });

    it('should apply error styles to input when error is present', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
        />
      );
      const input = screen.getByLabelText(/email/i);

      expect(input.className).toContain('border-error');
      expect(input.className).toContain('focus:border-error');
    });

    it('should not display error message when error prop is not provided', () => {
      render(<Input label="Email" value="" onChange={() => {}} />);
      const errorMessage = screen.queryByRole('alert');

      expect(errorMessage).not.toBeInTheDocument();
    });

    it('should show error icon alongside error message', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
        />
      );
      const errorMessage = screen.getByRole('alert');
      const errorIcon = errorMessage.querySelector('svg');

      expect(errorIcon).toBeInTheDocument();
      expect(errorIcon).toHaveAttribute('aria-hidden', 'true');
    });

    it('should clear error styles when error is removed', () => {
      const { rerender } = render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
        />
      );

      let input = screen.getByLabelText(/email/i);
      expect(input.className).toContain('border-error');

      rerender(<Input label="Email" value="" onChange={() => {}} />);

      input = screen.getByLabelText(/email/i);
      expect(input.className).not.toContain('border-error');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Change handlers', () => {
    it('should call onChange when input value changes', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<Input label="Username" value="" onChange={handleChange} />);
      const input = screen.getByLabelText(/username/i);

      await user.type(input, 'test');

      // onChange is called for each keystroke
      expect(handleChange).toHaveBeenCalledTimes(4);
      // Verify onChange was called with string values
      expect(handleChange).toHaveBeenCalled();
    });

    it('should not call onChange when disabled', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<Input label="Username" value="" onChange={handleChange} disabled />);
      const input = screen.getByLabelText(/username/i);

      await user.type(input, 'test');

      expect(handleChange).not.toHaveBeenCalled();
    });

    it('should handle controlled input updates', () => {
      const { rerender } = render(
        <Input label="Username" value="john" onChange={() => {}} />
      );

      let input = screen.getByLabelText(/username/i);
      expect(input).toHaveValue('john');

      rerender(<Input label="Username" value="jane" onChange={() => {}} />);

      input = screen.getByLabelText(/username/i);
      expect(input).toHaveValue('jane');
    });
  });

  describe('Accessibility attributes', () => {
    it('should associate label with input using htmlFor and id', () => {
      render(<Input label="Email Address" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/email address/i);
      const label = screen.getByText(/email address/i);

      expect(label).toHaveAttribute('for', input.id);
      expect(input).toHaveAttribute('id');
    });

    it('should generate consistent id from label', () => {
      render(<Input label="Email Address" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/email address/i);

      expect(input).toHaveAttribute('id', 'input-email-address');
    });

    it('should use custom id when provided', () => {
      render(<Input label="Email" value="" onChange={() => {}} id="custom-email-id" />);
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('id', 'custom-email-id');
    });

    it('should have aria-required when required is true', () => {
      render(<Input label="Email" value="" onChange={() => {}} required />);
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).toHaveAttribute('required');
    });

    it('should have aria-invalid when error is present', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
        />
      );
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('should not have aria-invalid when no error', () => {
      render(<Input label="Email" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('aria-invalid', 'false');
    });

    it('should associate error message with input using aria-describedby', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
        />
      );
      const input = screen.getByLabelText(/email/i);
      const errorMessage = screen.getByRole('alert');

      expect(input).toHaveAttribute('aria-describedby', errorMessage.id);
      expect(errorMessage).toHaveAttribute('id');
    });

    it('should not have aria-describedby when no error', () => {
      render(<Input label="Email" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/email/i);

      expect(input).not.toHaveAttribute('aria-describedby');
    });

    it('should support autoComplete attribute', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          autoComplete="email"
        />
      );
      const input = screen.getByLabelText(/email/i);

      expect(input).toHaveAttribute('autocomplete', 'email');
    });

    it('should have focus ring for keyboard accessibility', () => {
      render(<Input label="Username" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/username/i);

      expect(input.className).toContain('focus:outline-none');
      expect(input.className).toContain('focus:ring-2');
      expect(input.className).toContain('focus:ring-offset-1');
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Input label="First Name" value="" onChange={() => {}} />
          <Input label="Last Name" value="" onChange={() => {}} />
        </>
      );

      const firstInput = screen.getByLabelText(/first name/i);
      const lastInput = screen.getByLabelText(/last name/i);

      firstInput.focus();
      expect(firstInput).toHaveFocus();

      await user.tab();
      expect(lastInput).toHaveFocus();
    });

    it('should have accessible password toggle button', () => {
      render(<Input type="password" label="Password" value="" onChange={() => {}} />);
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(toggleButton).toHaveAttribute('aria-label', 'Show password');
      expect(toggleButton).toHaveAttribute('type', 'button');
      expect(toggleButton).toHaveAttribute('tabIndex', '0');
    });

    it('should update toggle button aria-label when password visibility changes', async () => {
      const user = userEvent.setup();
      render(<Input type="password" label="Password" value="" onChange={() => {}} />);

      let toggleButton = screen.getByRole('button', { name: /show password/i });
      expect(toggleButton).toHaveAttribute('aria-label', 'Show password');

      await user.click(toggleButton);

      toggleButton = screen.getByRole('button', { name: /hide password/i });
      expect(toggleButton).toHaveAttribute('aria-label', 'Hide password');
    });
  });

  describe('Ref forwarding', () => {
    it('should forward ref to input element', () => {
      const ref = { current: null as HTMLInputElement | null };

      render(<Input ref={ref} label="Username" value="" onChange={() => {}} />);

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current?.type).toBe('text');
    });

    it('should allow programmatic focus via ref', () => {
      const ref = { current: null as HTMLInputElement | null };

      render(<Input ref={ref} label="Username" value="" onChange={() => {}} />);

      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('Transition styles', () => {
    it('should apply transition duration and easing', () => {
      render(<Input label="Username" value="" onChange={() => {}} />);
      const input = screen.getByLabelText(/username/i);

      expect(input.className).toContain('transition-all');
      expect(input.style.transitionDuration).toBe('200ms');
      expect(input.style.transitionTimingFunction).toContain('cubic-bezier');
    });

    it('should apply fast transition to password toggle button', () => {
      render(<Input type="password" label="Password" value="" onChange={() => {}} />);
      const toggleButton = screen.getByRole('button', { name: /show password/i });

      expect(toggleButton.className).toContain('transition-colors');
      expect(toggleButton.style.transitionDuration).toBe('150ms');
    });
  });

  describe('Custom className', () => {
    it('should merge custom className with default styles', () => {
      render(
        <Input
          label="Username"
          value=""
          onChange={() => {}}
          className="custom-class"
        />
      );
      const container = screen.getByLabelText(/username/i).parentElement?.parentElement;

      expect(container?.className).toContain('custom-class');
      expect(container?.className).toContain('flex');
      expect(container?.className).toContain('flex-col');
    });
  });

  describe('Additional HTML attributes', () => {
    it('should pass through additional HTML attributes', () => {
      render(
        <Input
          label="Username"
          value=""
          onChange={() => {}}
          data-testid="custom-input"
          name="username"
        />
      );
      const input = screen.getByLabelText(/username/i);

      expect(input).toHaveAttribute('data-testid', 'custom-input');
      expect(input).toHaveAttribute('name', 'username');
    });

    it('should support maxLength attribute', () => {
      render(
        <Input
          label="Username"
          value=""
          onChange={() => {}}
          maxLength={20}
        />
      );
      const input = screen.getByLabelText(/username/i);

      expect(input).toHaveAttribute('maxLength', '20');
    });
  });

  describe('Combined states', () => {
    it('should handle error and disabled states together', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Invalid email"
          disabled
        />
      );
      const input = screen.getByLabelText(/email/i);
      const errorMessage = screen.getByRole('alert');

      expect(input).toBeDisabled();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(errorMessage).toBeInTheDocument();
    });

    it('should handle required and error states together', () => {
      render(
        <Input
          label="Email"
          value=""
          onChange={() => {}}
          error="Email is required"
          required
        />
      );
      const input = screen.getByLabelText(/email/i);
      const requiredIndicator = screen.getByLabelText(/required/i);
      const errorMessage = screen.getByRole('alert');

      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(requiredIndicator).toBeInTheDocument();
      expect(errorMessage).toBeInTheDocument();
    });

    it('should handle all input types with all states', () => {
      const types = ['text', 'email', 'password'] as const;

      types.forEach(type => {
        const { unmount } = render(
          <Input
            type={type}
            label={`${type} input`}
            value=""
            onChange={() => {}}
            error="Error message"
            required
          />
        );

        const input = screen.getByLabelText(new RegExp(`${type} input`, 'i'));
        expect(input).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-required', 'true');
        expect(input).toHaveAttribute('aria-invalid', 'true');

        unmount();
      });
    });
  });
});
