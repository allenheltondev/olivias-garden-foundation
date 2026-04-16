import type { HTMLAttributes, PropsWithChildren } from 'react';

export interface SummaryChipProps extends HTMLAttributes<HTMLSpanElement>, PropsWithChildren {}

export function SummaryChip({ children, className = '', ...props }: SummaryChipProps) {
  return (
    <span className={`og-summary-chip ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
