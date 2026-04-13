import React from 'react';
import { animation } from '../../theme/tokens';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      fullWidth = false,
      children,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      inline-flex items-center justify-center
      font-medium
      transition-all
      focus:outline-none focus:ring-2 focus:ring-offset-2
      disabled:opacity-50 disabled:cursor-not-allowed
      ${fullWidth ? 'w-full' : ''}
    `.trim().replace(/\s+/g, ' ');

    const variantStyles = {
      primary: `
        bg-primary-600
        text-white
        shadow-md hover:shadow-lg
        hover:bg-primary-700
        active:shadow-base
        focus:ring-primary-500
      `.trim().replace(/\s+/g, ' '),

      secondary: `
        bg-gradient-to-br from-neutral-100 to-neutral-200
        text-neutral-800
        shadow-sm hover:shadow-md
        hover:from-neutral-200 hover:to-neutral-300
        active:shadow-sm
        focus:ring-neutral-400
      `.trim().replace(/\s+/g, ' '),

      outline: `
        bg-transparent
        border-2 border-primary-600
        text-primary-600
        hover:bg-primary-50
        active:bg-primary-100
        focus:ring-primary-500
      `.trim().replace(/\s+/g, ' '),

      ghost: `
        bg-transparent
        text-neutral-700
        hover:bg-neutral-100
        active:bg-neutral-200
        focus:ring-neutral-400
      `.trim().replace(/\s+/g, ' '),
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm rounded-base',
      md: 'px-4 py-2 text-base rounded-base',
      lg: 'px-6 py-3 text-lg rounded-md',
    };

    const transitionStyle = {
      transitionDuration: animation.duration.base,
      transitionTimingFunction: animation.easing.inOut,
    };

    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        style={transitionStyle}
        aria-busy={loading}
        aria-disabled={isDisabled}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
