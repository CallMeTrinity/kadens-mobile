/**
 * Jest (KL-36).
 *
 * `jest-expo/android` plutôt que `jest-expo` tout court : le dépôt ne vise
 * qu'Android (pas de ticket iOS, aucun build iOS vérifié), et le préréglage de
 * plateforme est ce qui donne la bonne résolution d'extensions (`.android.ts`
 * avant `.ts`) et le bon `Platform.OS`. Le préréglage universel ferait tourner
 * chaque test trois fois, dont deux sur des cibles qu'on ne livre pas.
 *
 * Le reste vient du préréglage : l'environnement Node, la transformation Babel
 * (donc `babel-plugin-inline-import`, sans lequel les migrations `.sql` ne se
 * chargeraient pas), et le `moduleNameMapper` dérivé des `paths` de
 * `tsconfig.json` — `@/` n'a donc pas à être redéclaré ici.
 *
 * Ce qui n'est **pas** dans le préréglage et que ce fichier ajoute :
 *
 * - `setupFilesAfterEnv` : le socle commun des tests (`src/test/setup.ts`).
 * - `testPathIgnorePatterns` : `src/test/` porte des utilitaires, pas des
 *   suites — sans ça, `jest` s'y plaindrait de fichiers sans test.
 *
 * Le double de la base vit dans `__mocks__/expo-sqlite.ts`, à côté de
 * `node_modules` : Jest l'applique **automatiquement** à tout ce qui importe
 * `expo-sqlite`, sans `jest.mock()` dans les suites.
 */
module.exports = {
  preset: 'jest-expo/android',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/test/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/test/**'],
};
