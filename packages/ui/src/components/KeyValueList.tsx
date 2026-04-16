import type { ReactNode } from 'react';

export interface KeyValueItem {
  key: string;
  label: string;
  value: ReactNode;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  className?: string;
}

export function KeyValueList({ items, className = '' }: KeyValueListProps) {
  return (
    <dl className={`og-key-value-list ${className}`.trim()}>
      {items.map((item) => (
        <div key={item.key} className="og-key-value-list__row">
          <dt className="og-key-value-list__label">{item.label}</dt>
          <dd className="og-key-value-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
