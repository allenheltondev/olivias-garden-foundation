import type { HTMLAttributes, PropsWithChildren } from 'react';

export type FormFeedbackTone = 'success' | 'error' | 'info';

export interface FormFeedbackProps
  extends Omit<HTMLAttributes<HTMLParagraphElement>, 'role'>,
    PropsWithChildren {
  tone: FormFeedbackTone;
}

/**
 * Form-level feedback pill for success/error/info messages.
 *
 * For field-level errors, prefer the `error` prop on Input/Textarea/FormField.
 */
export function FormFeedback({
  tone,
  children,
  className = '',
  ...props
}: FormFeedbackProps) {
  return (
    <p
      className={`og-form-feedback og-form-feedback--${tone} ${className}`.trim()}
      role={tone === 'error' ? 'alert' : 'status'}
      {...props}
    >
      {children}
    </p>
  );
}
