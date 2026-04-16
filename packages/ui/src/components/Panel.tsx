import type { HTMLAttributes, PropsWithChildren } from 'react';

type PanelTone = 'default' | 'paper';
type PanelPadding = 'md' | 'none';

export interface PanelProps extends HTMLAttributes<HTMLDivElement>, PropsWithChildren {
  tone?: PanelTone;
  padding?: PanelPadding;
}

export function Panel({
  children,
  className = '',
  tone = 'default',
  padding = 'md',
  ...props
}: PanelProps) {
  return (
    <section
      className={`og-panel og-panel--${tone} og-panel--padding-${padding} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
