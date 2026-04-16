import type { HTMLAttributes, PropsWithChildren } from 'react';

type CardPadding = 'none' | '4' | '6' | '8';
type CardElevation = 'sm' | 'base' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement>, PropsWithChildren {
  title?: string;
  padding?: CardPadding;
  elevation?: CardElevation;
  interactive?: boolean;
}

export function Card({
  children,
  className = '',
  title,
  padding,
  elevation,
  interactive = false,
  ...props
}: CardProps) {
  const classes = [
    'og-card',
    padding ? `og-card--padding-${padding}` : '',
    elevation ? `og-card--elevation-${elevation}` : '',
    interactive ? 'og-card--interactive' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <section className={classes} {...props}>
      {title ? <h3 className="og-card-title">{title}</h3> : null}
      <div className="og-card-body">{children}</div>
    </section>
  );
}
