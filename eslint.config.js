//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import { plugin as shadcn } from '@shadcn/lint'

export default [
  ...tanstackConfig,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: ['@/components', '#/components'],
      },
    },
    // Add design rules here after you select the allowed styles.
    // Setup guide: https://github.com/shadcn-ui/lint/blob/main/SETUP.md
    // Available rules: https://github.com/shadcn-ui/lint#rules
    // The plugin finds the Tailwind theme in src/styles.css.
    rules: {},
  },
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    files: ['agent-runner/vite-plugin.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    ignores: [
      '.wrangler/**',
      'eslint.config.js',
      'agent-runner/openhands-browser-js/**',
      'prettier.config.js',
      'public/sw.js',
    ],
  },
]
