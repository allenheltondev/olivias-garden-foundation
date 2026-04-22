import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, PropsWithChildren {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  children,
  className = '',
  type = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      className={
        `og-button og-button--${variant} og-button--${size}` +
        `${fullWidth ? ' og-button--full' : ''}` +
        `${loading ? ' og-button--loading' : ''}` +
        `${className ? ` ${className}` : ''}`
      }
      {...props}
    >
      {loading ? (
        <svg className="og-button__spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="og-button__spinner-track" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="og-button__spinner-head" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
