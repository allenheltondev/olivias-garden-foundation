import React from 'react';
import { spacing, animation } from '../../theme/tokens';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: 'sm' | 'base' | 'md' | 'lg';
  padding?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16' | '20' | '24';
  children: React.ReactNode;
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      elevation = 'base',
      padding = '6',
      children,
      interactive = false,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      bg-gradient-to-br from-white to-neutral-50
      rounded-lg
      transition-all
    `.trim().replace(/\s+/g, ' ');

    const elevationStyles = {
      sm: 'shadow-sm',
      base: 'shadow-base',
      md: 'shadow-md',
      lg: 'shadow-lg',
    };

    const interactiveStyles = interactive
      ? 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer'
      : '';

    const paddingValue = spacing[padding];

    const transitionStyle = {
      transitionDuration: animation.duration.base,
      transitionTimingFunction: animation.easing.inOut,
      padding: paddingValue,
    };

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${elevationStyles[elevation]} ${interactiveStyles} ${className}`}
        style={transitionStyle}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
