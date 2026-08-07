import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * KL-41 — les deux numéros de version viennent du build, pas du dépôt.
 *
 * `app.json` reste la configuration : tout y est, sauf ce qui ne peut pas y
 * être. `versionCode` et `version` en font partie — un numéro incrémenté à la
 * main dans un fichier versionné se rate une fois sur deux, et Android ne
 * pardonne pas un `versionCode` qui ne monte pas (l'installation par-dessus est
 * refusée, sans message utile).
 *
 *   KADENS_VERSION_CODE  entier ≥ 1, dérivé de `github.run_number` (monotone,
 *                        propre au fichier de workflow — le renommer le remet
 *                        à zéro, et c'est le seul moyen de casser la règle)
 *   KADENS_VERSION_NAME  le tag `v1.2.0`, dont on retire le `v`
 *
 * Absentes, les valeurs d'`app.json` s'appliquent : un build local reste un
 * build local, il ne prétend pas être une version publiée.
 *
 * **Ce fichier est relu deux fois, et les deux comptent.** Au `prebuild`, pour
 * écrire le `versionCode` d'Android dans `build.gradle` ; puis à **chaque** build
 * Gradle, par `expo-constants`, qui regénère le manifeste embarqué
 * (`assets/app.config`) — celui que `Constants.expoConfig` rend sur le téléphone,
 * et donc celui que compare `src/sync/version.ts`. Les deux variables doivent
 * être posées sur les deux étapes du workflow : ne les poser qu'au prebuild donne
 * un APK correctement versionné pour Android mais qui s'annonce en `1` à
 * lui-même, jusqu'à se croire sous le plancher du serveur et se bloquer. C'était
 * le cas de la 1.0.0.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // `name` et `slug` sont obligatoires côté type ; ils viennent d'app.json, et
  // les redéclarer ici en ferait une deuxième source de vérité.
  name: config.name ?? 'Kadens',
  slug: config.slug ?? 'kadens',
  version: versionName(process.env.KADENS_VERSION_NAME, config.version),
  android: {
    ...config.android,
    versionCode: versionCode(process.env.KADENS_VERSION_CODE, config.android?.versionCode),
  },
});

/**
 * Le `v` d'un tag git n'est pas dans le numéro de version : `v1.2.0` s'affiche
 * `1.2.0` dans les réglages Android comme dans l'index du dépôt.
 */
function versionName(raw: string | undefined, fallback: string | undefined): string {
  const trimmed = raw?.trim();

  return trimmed ? trimmed.replace(/^v/, '') : (fallback ?? '1.0.0');
}

/**
 * Une valeur mal formée **échoue le build**. Retomber en silence sur `1`
 * produirait un APK que rien ne pourrait mettre à jour, et le défaut ne se
 * verrait qu'au moment d'installer la version suivante.
 */
function versionCode(raw: string | undefined, fallback: number | undefined): number {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return fallback ?? 1;
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`KADENS_VERSION_CODE doit être un entier ≥ 1, reçu « ${raw} ».`);
  }

  return parsed;
}
