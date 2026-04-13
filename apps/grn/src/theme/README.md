# Theme System

This directory contains the design token definitions and theme configuration for the community food coordination platform.

## Overview

The theme system provides a centralized set of design tokens that define the visual language of the application. These tokens are integrated with Tailwind CSS to ensure consistent styling across all components.

## Files

- `tokens.ts` - TypeScript definitions of all design tokens (colors, typography, spacing, shadows, etc.)
- `theme.css` - CSS custom properties for all design tokens
- `index.ts` - Main export file for theme tokens and types

## Tailwind CSS Integration

The theme tokens are integrated into Tailwind CSS via `tailwind.config.js`. This allows you to use theme tokens directly in your components using Tailwind utility classes.

### Available Tailwind Classes

#### Colors
```tsx
// Primary colors
<div className="bg-primary-500 text-primary-50">...</div>

// Neutral colors
<div className="bg-neutral-100 text-neutral-900">...</div>

// Semantic colors
<div className="bg-success">Success</div>
<div className="bg-warning">Warning</div>
<div className="bg-error">Error</div>
<div className="bg-info">Info</div>
```

#### Shadows (Semi-Flat Design)
```tsx
<div className="shadow-sm">Subtle shadow</div>
<div className="shadow-base">Base shadow</div>
<div className="shadow-md">Medium shadow</div>
<div className="shadow-lg">Large shadow</div>
<div className="shadow-xl">Extra large shadow</div>
```

#### Border Radius
```tsx
<div className="rounded-sm">Small radius</div>
<div className="rounded-base">Base radius</div>
<div className="rounded-md">Medium radius</div>
<div className="rounded-lg">Large radius</div>
<div className="rounded-xl">Extra large radius</div>
<div className="rounded-full">Fully rounded</div>
```

#### Transitions
```tsx
// Duration
<button className="transition-all duration-fast">Fast (150ms)</button>
<button className="transition-all duration-base">Base (200ms)</button>
<button className="transition-all duration-slow">Slow (300ms)</button>

// Easing (use with transition utilities)
<button className="transition ease-linear">Linear</button>
<button className="transition ease-in">Ease in</button>
<button className="transition ease-out">Ease out</button>
<button className="transition ease-in-out">Ease in-out</button>
```

## CSS Custom Properties

All design tokens are also available as CSS custom properties for use in custom CSS:

```css
.my-component {
  color: var(--color-primary-500);
  background: var(--gradient-primary);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-lg);
  transition: all var(--duration-base) var(--easing-out);
}
```

## Semi-Flat Design Principles

The theme implements a semi-flat/flat 2.0 design approach that balances cleanliness with visual depth:

1. **Subtle Shadows** - Use shadows to create depth without heavy drop shadows
2. **Rounded Corners** - Apply border radius to soften edges and improve visual appeal
3. **Gradients** - Use subtle gradients instead of flat colors for backgrounds
4. **Smooth Transitions** - Apply micro-animations for interactive feedback

## Usage in Components

Import theme tokens directly in TypeScript/React components:

```tsx
import { colors, shadows, borderRadius } from '@/theme/tokens';

// Use in inline styles
<div style={{
  backgroundColor: colors.primary[500],
  boxShadow: shadows.md,
  borderRadius: borderRadius.lg
}}>
  ...
</div>

// Or use Tailwind classes (preferred)
<div className="bg-primary-500 shadow-md rounded-lg">
  ...
</div>
```

## Testing

Theme integration tests are located in `__tests__/tailwind-integration.test.tsx`. Run tests with:

```bash
npm test
```

## Demo

A visual demonstration of the theme system is available in `__tests__/ThemeDemo.tsx`. This component shows all theme tokens in action.
