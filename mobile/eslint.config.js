// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const jestGlobals = Object.fromEntries(
  ['jest', 'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'].map((n) => [n, 'readonly']),
);

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Resolve the "@/..." alias (src/) from jsconfig.json, the same mapping Metro and Jest use.
    // (The resolver is named "typescript" but it simply understands tsconfig/jsconfig path maps; no TypeScript is involved.)
    settings: { 'import/resolver': { typescript: { project: './jsconfig.json' } } },
  },
  {
    files: ['**/__tests__/**', 'src/test-utils/**', 'jest.setup.js'],
    languageOptions: { globals: jestGlobals },
  },
]);
