import type { HTMLAttributes, PropsWithChildren } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement>, PropsWithChildren {
  title?: string;
}

export function Card({ children, className = '', title, ...props }: CardProps) {
  return (
    <section className={`og-card ${className}`.trim()} {...props}>
      {title ? <h3 className="og-card-title">{title}</h3> : null}
      <div className="og-card-body">{children}</div>
    </section>
  );
}
