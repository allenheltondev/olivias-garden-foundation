import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  label: ReactNode;
  description?: ReactNode;
  error?: string;
}

export function Checkbox({
  label,
  description,
  error,
  className = '',
  id,
  disabled = false,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id || `checkbox-${generatedId}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy = [errorId, descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={
        `og-checkbox${error ? ' og-checkbox--error' : ''}${disabled ? ' og-checkbox--disabled' : ''}` +
        `${className ? ` ${className}` : ''}`
      }
    >
      <label htmlFor={inputId} className="og-checkbox__label">
        <input
          {...props}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="og-checkbox__input"
        />
        <span className="og-checkbox__text">
          <span className="og-checkbox__title">{label}</span>
          {description ? (
            <span id={descriptionId} className="og-checkbox__description">
              {description}
            </span>
          ) : null}
        </span>
      </label>

      {error ? (
        <p id={errorId} className="og-checkbox__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
