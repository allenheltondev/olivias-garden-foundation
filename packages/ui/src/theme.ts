export const colors = {
  primary: {
    50: '#f0f7f0',
    100: '#d9ead8',
    200: '#b3d5b1',
    300: '#8cc08a',
    400: '#66ab63',
    500: '#3F7D3A',
    600: '#336431',
    700: '#264a25',
    800: '#1a3119',
    900: '#0d190c',
  },
  secondary: {
    50: '#f7f5f3',
    100: '#ebe5df',
    200: '#d7cbbf',
    300: '#c3b19f',
    400: '#af977f',
    500: '#8A6B4F',
    600: '#6f5640',
    700: '#544030',
    800: '#392b20',
    900: '#1d1510',
  },
  accent: {
    50: '#fdf9f0',
    100: '#f9efd4',
    200: '#f3dfa9',
    300: '#edcf7e',
    400: '#e7bf53',
    500: '#D8A741',
    600: '#ad8634',
    700: '#826527',
    800: '#57431a',
    900: '#2b220d',
  },
  neutral: {
    50: '#fafaf9',
    100: '#f5f5f4',
    200: '#e7e5e4',
    300: '#d6d3d1',
    400: '#a8a29e',
    500: '#78716c',
    600: '#57534e',
    700: '#44403c',
    800: '#2E2E2E',
    900: '#1c1917',
  },
  success: '#3F7D3A',
  warning: '#D8A741',
  error: '#ef4444',
  info: '#3b82f6',
} as const;

export const background = '#F7F5EF';

export const typography = {
  fontFamily: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    body: '"Trebuchet MS", "Segoe UI", sans-serif',
    display: '"Georgia", "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  card: '0 24px 48px rgba(35, 27, 22, 0.08)',
  button: '0 10px 20px rgba(66, 107, 63, 0.18)',
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.25rem',
  base: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  full: '9999px',
} as const;

export const animation = {
  duration: {
    fast: '150ms',
    base: '200ms',
    slow: '300ms',
  },
  easing: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export const gradients = {
  primary: 'linear-gradient(135deg, #3F7D3A 0%, #336431 100%)',
  secondary: 'linear-gradient(135deg, #8A6B4F 0%, #6f5640 100%)',
  accent: 'linear-gradient(135deg, #D8A741 0%, #ad8634 100%)',
  neutral: 'linear-gradient(135deg, #f5f5f4 0%, #e7e5e4 100%)',
  glass: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
} as const;

export interface ThemeConfig {
  colors: typeof colors;
  typography: typeof typography;
  spacing: typeof spacing;
  shadows: typeof shadows;
  borderRadius: typeof borderRadius;
  animation: typeof animation;
  gradients: typeof gradients;
}

export const theme: ThemeConfig = {
  colors,
  typography,
  spacing,
  shadows,
  borderRadius,
  animation,
  gradients,
};
