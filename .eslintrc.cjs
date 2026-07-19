'use strict';

module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script'
  },
  rules: {
    // Existing scripts intentionally retain exploratory helpers and report fields.
    'no-unused-vars': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-empty': ['error', { allowEmptyCatch: true }]
  },
  ignorePatterns: [
    'node_modules/',
    'data/',
    'run-logs/',
    'agents/',
    'coverage/'
  ]
};
