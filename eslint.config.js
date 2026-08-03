// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  // En dernier : neutralise les règles de style qui entreraient en conflit avec
  // Prettier, et fait remonter les écarts de formatage comme des erreurs ESLint.
  prettierRecommended,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'expo-env.d.ts'],
  },
]);
