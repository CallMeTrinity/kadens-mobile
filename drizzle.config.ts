import { defineConfig } from 'drizzle-kit';

/**
 * Configuration de `drizzle-kit`, l'outil qui **génère** les migrations locales
 * depuis `src/db/schema.ts` (`npm run db:generate`).
 *
 * `driver: 'expo'` ne change pas le SQL produit — le dialecte reste SQLite — il
 * ajoute un `migrations.js` qui embarque les fichiers `.sql` dans le bundle. Un
 * téléphone n'a pas de système de fichiers à parcourir au démarrage : les
 * migrations doivent voyager avec l'APK.
 *
 * Le dossier de sortie est **versionné et jamais édité à la main**, comme
 * `src/theme/tokens.ts` : une migration retouchée après coup aurait déjà été
 * appliquée sur un téléphone, et le journal de Drizzle ne la rejouerait pas.
 * Toute correction passe par une nouvelle migration.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
});
