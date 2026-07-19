import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const tsRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  '@typescript-eslint/no-floating-promises': 'off',
}

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', 'dist-electron/**', 'client/**', 'server/**', 'electron/**', '**/* 2.*'] },
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: tsRules,
  },
  {
    files: ['apps/studio/src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module', extraFileExtensions: ['.vue'] },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, vue },
    rules: { ...tsRules, 'vue/no-dupe-keys': 'error', 'vue/no-duplicate-attributes': 'error', 'vue/no-parsing-error': 'error' },
  },
]
