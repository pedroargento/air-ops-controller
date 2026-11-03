import tseslint from 'typescript-eslint';

const restrictImports = (...group) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message: 'Crosses a truth or layer boundary (implementation-plan.md §3).' }] }],
});

const banNondeterminism = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use a labeled stream from src/rng.' },
    ...['hypot', 'exp', 'log', 'sin', 'cos', 'tan', 'atan', 'atan2', 'pow'].map((property) => ({
      object: 'Math',
      property,
      message: 'Results differ between engines. Use src/domain/public/det-math.',
    })),
    { object: 'Date', property: 'now', message: 'Simulation code must not read the clock.' },
    { object: 'performance', property: 'now', message: 'Simulation code must not read the clock.' },
  ],
};

const OUTER = ['**/ui/**', '**/policies/**', '**/debug/**', '**/cli/**'];

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'reports/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/domain/public/**'],
    rules: restrictImports('../*', '../../*'),
  },
  {
    files: ['src/domain/truth/**'],
    rules: restrictImports('../../*', ...OUTER),
  },
  {
    files: ['src/sim/**', 'src/perception/**', 'src/scenario/**'],
    rules: restrictImports(...OUTER),
  },
  {
    files: ['src/ai/**', 'src/knowledge/**'],
    rules: restrictImports('**/domain/truth/**', '**/sim/**', '**/perception/**', ...OUTER),
  },
  {
    files: ['src/ui/**', 'src/policies/**'],
    rules: restrictImports(
      '**/domain/truth/**',
      '**/sim/**',
      '**/perception/**',
      '**/ai/**',
      '**/debug/**',
      '**/cli/**',
      '**/game/**',
      '**/knowledge/**',
      '!**/knowledge/player-view*',
    ),
  },
  {
    // Runs in the browser, where Node modules fail at load time even though the build passes.
    files: ['src/debug/**'],
    rules: restrictImports('node:*', '**/cli/batch', '**/cli/load-scenario', '**/cli/replay'),
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/ui/**', 'src/debug/**', 'src/cli/**', 'src/main.ts', 'src/play.ts'],
    rules: banNondeterminism,
  },
);
