import type { ReactNode } from 'react';

/** A compact primary heading for application pages. */
export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="og-page-heading">
      <h1>{title}</h1>
      {children ? <div className="og-page-heading__body">{children}</div> : null}
    </header>
  );
}
