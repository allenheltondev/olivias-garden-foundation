import React from 'react';
import { SiteFooter } from '@olivias/ui';
import { AppHeader } from '../branding/AppHeader';

export interface AppShellProps {
  children: React.ReactNode;
  showHeader?: boolean;
}

const foundationBaseUrl = import.meta.env.VITE_FOUNDATION_URL || 'https://oliviasgarden.org';
const footerLinks = [
  { id: 'home', label: 'Home', href: `${foundationBaseUrl}/` },
  { id: 'about', label: 'About', href: `${foundationBaseUrl}/about` },
  { id: 'okra', label: 'Okra Project', href: `${foundationBaseUrl}/okra` },
  { id: 'donate', label: 'Donate', href: `${foundationBaseUrl}/donate` },
  { id: 'contact', label: 'Contact', href: `${foundationBaseUrl}/contact` },
];

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
      <SiteFooter
        meta={`${new Date().getFullYear()} Olivia's Garden Foundation. All rights reserved.`}
        links={footerLinks.map((link) => ({
          id: link.id,
          label: link.label,
          onSelect: () => window.location.assign(link.href),
        }))}
        socialLinks={[
          {
            id: 'instagram',
            href: 'https://instagram.com/oliviasgardentx',
            label: "Follow Olivia's Garden Foundation on Instagram",
            icon: 'instagram',
          },
        ]}
      />
    </div>
  );
};
