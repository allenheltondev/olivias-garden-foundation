import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled = false,
  required = false,
  rows = 4,
  className = '',
  id,
  ...props
}: TextareaProps) {
  const textareaId = id || (label ? `textarea-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  const errorId = textareaId ? `${textareaId}-error` : undefined;

  return (
    <div className={`og-textarea ${error ? 'og-textarea--error' : ''} ${className}`.trim()}>
      {label ? (
        <label htmlFor={textareaId} className="og-textarea__label">
          {label}
          {required ? <span className="og-textarea__required" aria-label="required">*</span> : null}
        </label>
      ) : null}

      <textarea
        id={textareaId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        rows={rows}
        className="og-textarea__field"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-required={required}
        {...props}
      />

      {error ? (
        <p id={errorId} className="og-textarea__error" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="og-textarea__error-icon" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}
