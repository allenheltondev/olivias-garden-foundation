import React from 'react';
import { AppHeader } from '../branding/AppHeader';

export interface AppShellProps {
  children: React.ReactNode;
  showHeader?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  showHeader = true
}) => {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {showHeader && <AppHeader />}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
};
