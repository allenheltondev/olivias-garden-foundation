import React from 'react';

export interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

/**
 * FormField component wraps form controls with consistent label and error display.
 *
 * Note: The Input component already has built-in label and error handling.
 * Use FormField for other form controls like textareas, selects, or custom inputs
 * that need consistent styling and error handling.
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  required = false,
  children,
  htmlFor,
  className = '',
}) => {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-neutral-700"
      >
        {label}
        {required && (
          <span className="text-error ml-1" aria-label="required">
            *
          </span>
        )}
      </label>

      <div className="relative">
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return React.cloneElement(child as React.ReactElement<any>, {
              'aria-invalid': !!error,
              'aria-describedby': error ? errorId : undefined,
              'aria-required': required,
            });
          }
          return child;
        })}
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
};
