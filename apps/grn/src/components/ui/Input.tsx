import React, { useState } from 'react';
import { animation } from '../../theme/tokens';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'email' | 'password';
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      type = 'text',
      label,
      placeholder,
      value,
      onChange,
      error,
      disabled = false,
      required = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const errorId = inputId ? `${inputId}-error` : undefined;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Call the onChange from props if it exists (supports both React Hook Form and custom handlers)
      if (onChange) {
        onChange(e);
      }
    };

    const togglePasswordVisibility = () => {
      setShowPassword(!showPassword);
    };

    const inputType = type === 'password' && showPassword ? 'text' : type;

    const baseInputStyles = `
      w-full
      px-4 py-2
      text-base
      text-neutral-800
      bg-white
      border-2
      rounded-base
      transition-all
      placeholder:text-neutral-400
      disabled:bg-neutral-100
      disabled:cursor-not-allowed
      disabled:text-neutral-500
      focus:outline-none
      focus:ring-2
      focus:ring-offset-1
    `.trim().replace(/\s+/g, ' ');

    const borderStyles = error
      ? 'border-error focus:border-error focus:ring-error'
      : isFocused
      ? 'border-primary-500 focus:border-primary-500 focus:ring-primary-500'
      : 'border-neutral-300 hover:border-neutral-400 focus:border-primary-500 focus:ring-primary-500';

    const transitionStyle = {
      transitionDuration: animation.duration.base,
      transitionTimingFunction: animation.easing.inOut,
    };

    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-neutral-700"
          >
            {label}
            {required && <span className="text-error ml-1" aria-label="required">*</span>}
          </label>
        )}

        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            value={value}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            className={`${baseInputStyles} ${borderStyles} ${type === 'password' ? 'pr-12' : ''}`}
            style={transitionStyle}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            aria-required={required}
            {...props}
          />

          {type === 'password' && (
            <button
              type="button"
              onClick={togglePasswordVisibility}
              disabled={disabled}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 focus:outline-none focus:text-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{
                transitionDuration: animation.duration.fast,
              }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={0}
            >
              {showPassword ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              )}
            </button>
          )}
        </div>

        {error && (
          <p
            id={errorId}
            className="text-sm text-error flex items-center gap-1"
            role="alert"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
