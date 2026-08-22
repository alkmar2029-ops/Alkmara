import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'device-data/**',
    '.claude/**',
    'next-env.d.ts',
    'tsconfig.tsbuildinfo',
    '*.config.mjs',
    '*.config.js',
    'debug-templates.js',
    'generate-report.js',
    'pull-and-compare.js',
    'pull-device-data.js',
    'update-zero-ids.js',
  ]),
  ...nextVitals,
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // This React 18 codebase intentionally initializes and synchronizes local
      // UI state in effects. These React Compiler rules arrived via the Next 16
      // preset and require architectural migrations, not lint-only changes.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
]);
