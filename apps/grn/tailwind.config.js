import { colors, shadows, borderRadius, animation } from './src/theme/tokens';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Mobile-first breakpoints
      screens: {
        'xs': '375px',   // Small phones
        'sm': '640px',   // Large phones
        'md': '768px',   // Tablets
        'lg': '1024px',  // Laptops
        'xl': '1280px',  // Desktops
        '2xl': '1536px', // Large desktops
      },
      // Theme color tokens
      colors: {
        primary: colors.primary,
        secondary: colors.secondary,
        accent: colors.accent,
        neutral: colors.neutral,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
        info: colors.info,
      },
      // Shadow tokens for semi-flat design
      boxShadow: shadows,
      // Border radius tokens
      borderRadius: borderRadius,
      // Animation duration tokens
      transitionDuration: animation.duration,
      // Animation easing tokens
      transitionTimingFunction: animation.easing,
    },
  },
  plugins: [],
}
