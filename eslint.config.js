import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'homebridge-ui/public/index.js'],
  },
  {
    rules: {
      'quotes': ['error', 'single'],
      'indent': ['error', 2, { 'SwitchCase': 0 }],
      'linebreak-style': ['error', 'unix'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'dot-notation': 'error',
      'eqeqeq': ['error', 'smart'],
      'curly': ['error', 'all'],
      'brace-style': ['error'],
      'prefer-arrow-callback': 'warn',
      'max-len': ['warn', 160],
      'object-curly-spacing': ['error', 'always'],
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { 'classes': false, 'enums': false }],
      '@typescript-eslint/no-unused-vars': ['error', { 'caughtErrors': 'none' }],
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    // The local harness is plain ESM run by Node; these are the Node globals it uses.
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        Response: 'readonly',
        URLSearchParams: 'readonly',
        setImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
