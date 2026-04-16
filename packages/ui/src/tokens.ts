import { borderRadius, shadows } from './theme.ts';

export const brandTokens = {
  color: {
    soil: '#4f3825',
    moss: '#426b3f',
    sage: '#6f8f5f',
    sunflower: '#d8a741',
    cream: '#f7f2e7',
    paper: '#fffdf8',
    ink: '#231b16',
    mist: '#e8decb',
  },
  radius: {
    sm: borderRadius.base,
    md: borderRadius.lg,
    lg: borderRadius.xl,
    pill: borderRadius.full,
  },
  shadow: {
    card: shadows.card,
    button: shadows.button,
  },
} as const;
