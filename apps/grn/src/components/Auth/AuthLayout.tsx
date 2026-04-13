import React from 'react';
import { Card } from '../ui/Card';
import { BrandHeader } from '../branding/BrandHeader';

export interface AuthLayoutProps {
  subtitle?: string;
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  subtitle,
  children,
}) => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card elevation="md" padding="8">
          <div className="mb-8">
            <BrandHeader logoSize="md" />
            {subtitle && (
              <p className="text-base text-neutral-600 text-center mt-4">
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
};
