import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
    },
  },
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
  },
  {
    // process.env may only be read in config/env.js (CLAUDE.md Section 3).
    files: ['server/src/**/*.js'],
    ignores: ['server/src/config/env.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read config via config/env.js only.' },
      ],
    },
  },
  {
    // CLI scripts talk to the operator on stdout/stderr.
    files: ['server/scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
