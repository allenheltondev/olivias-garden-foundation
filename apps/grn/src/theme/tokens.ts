export {
  animation,
  background,
  borderRadius,
  colors,
  gradients,
  shadows,
  spacing,
  theme,
  typography,
} from '@olivias/ui/theme';

export type { ThemeConfig } from '@olivias/ui/theme';
export type ColorTokens = typeof import('@olivias/ui/theme').colors;
export type TypographyTokens = typeof import('@olivias/ui/theme').typography;
export type SpacingTokens = typeof import('@olivias/ui/theme').spacing;
export type ShadowTokens = typeof import('@olivias/ui/theme').shadows;
export type BorderRadiusTokens = typeof import('@olivias/ui/theme').borderRadius;
export type AnimationTokens = typeof import('@olivias/ui/theme').animation;
export type GradientTokens = typeof import('@olivias/ui/theme').gradients;
