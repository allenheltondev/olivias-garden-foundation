import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['.aws-sam/**', '**/*.ts']
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest
      }
    }
  }
];
