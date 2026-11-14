import type { ReactNode } from 'react';
import { GardenIcon, type GardenIconName } from './GardenIcon';

export function EmptyState({ title, children, icon, actions, className = '' }: {
  title: string;
  children: ReactNode;
  icon: GardenIconName;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`og-empty-state ${className}`.trim()} aria-label={title}>
      <GardenIcon name={icon} />
      <div className="og-empty-state__copy">
        <h2>{title}</h2>
        <div>{children}</div>
        {actions ? <div className="og-empty-state__actions">{actions}</div> : null}
      </div>
    </section>
  );
}
