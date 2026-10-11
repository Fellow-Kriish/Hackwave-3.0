import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/node_modules/**', '**/dist/**', 'runs/**', 'apps/shop/data/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/shop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // One adapter is the only door to the model, and only its callers may open it: the planner (and, later,
    // rung 3, the re-planner and the RED explainer). run.ts and doctor.ts wire it up; the executor never can.
    files: ['packages/engine/src/**/*.ts'],
    ignores: [
      'packages/engine/src/llm/**',
      'packages/engine/src/planner.ts',
      'packages/engine/src/run.ts',
      'packages/engine/src/doctor.ts',
      'packages/engine/src/**/*.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/llm', '**/llm/**'],
              message: 'Only the planner, rung 3, the re-planner and the explainer may use the LLM adapter.',
            },
          ],
        },
      ],
    },
  },
  {
    // The verifier decides pass/fail and must never reach the LLM adapter (packages/engine/src/llm).
    // Contracts stay dependency-free for the same reason. Dynamic import() would dodge the static rule, so it is banned too.
    files: ['packages/verifier/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@hackwave/engine', '@hackwave/engine/*', '**/engine', '**/engine/**', '**/llm', '**/llm/**'],
              message: 'The verifier and contracts must never import the engine or the LLM adapter. If a change seems to need it, the change is wrong.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'No dynamic import() here: it would bypass the LLM-adapter import ban.' },
      ],
    },
  },
]);
