import type { PropsWithChildren } from 'react';

export interface FormFieldProps extends PropsWithChildren {
  label: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}

/**
 * FormField wraps form controls with a consistent label and error display.
 *
 * Use for controls that are not the Input component (which has its own
 * built-in label and error handling). Good for textareas, selects, custom
 * inputs, or any composite control that needs the standard field chrome.
 */
export function FormField({
  label,
  error,
  required = false,
  children,
  htmlFor,
  className = '',
}: FormFieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={`og-form-field ${error ? 'og-form-field--error' : ''} ${className}`.trim()}>
      <label htmlFor={htmlFor} className="og-form-field__label">
        {label}
        {required ? <span className="og-form-field__required" aria-label="required">*</span> : null}
      </label>

      <div className="og-form-field__control">
        {children}
      </div>

      {error ? (
        <p id={errorId} className="og-form-field__error" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="og-form-field__error-icon" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}
