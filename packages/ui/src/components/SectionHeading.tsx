import type { HTMLAttributes, PropsWithChildren } from 'react';

export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement>, PropsWithChildren {
  eyebrow?: string;
  title?: string;
  body?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  children,
  className = '',
  ...props
}: SectionHeadingProps) {
  return (
    <div className={`og-section-heading-block ${className}`.trim()} {...props}>
      {eyebrow ? <p className="og-section-heading-block__eyebrow">{eyebrow}</p> : null}
      {title ? <h2 className="og-section-heading-block__title">{title}</h2> : null}
      {body ? <p className="og-section-heading-block__body">{body}</p> : null}
      {children}
    </div>
  );
}
