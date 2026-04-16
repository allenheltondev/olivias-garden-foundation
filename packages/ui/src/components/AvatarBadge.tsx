import type { HTMLAttributes } from 'react';

export interface AvatarBadgeProps extends HTMLAttributes<HTMLDivElement> {
  initials: string;
}

export function AvatarBadge({ initials, className = '', ...props }: AvatarBadgeProps) {
  return (
    <div className={`og-avatar-badge ${className}`.trim()} aria-hidden="true" {...props}>
      <span>{initials}</span>
    </div>
  );
}
