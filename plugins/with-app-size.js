/**
 * KL-41 — les propriétés Gradle qui décident de la taille de l'APK.
 *
 * L'app pesait **130 Mo** pour ce qu'elle fait : dérouler une séance et écrire
 * des séries. La mesure sur l'APK réel a montré que l'essentiel n'était pas du
 * code de Kadens, mais du transitif jamais exécuté. Ce fichier regroupe ce qui
 * se règle par une propriété Gradle ; le reste du dossier est traité ailleurs et
 * référencé plus bas.
 *
 * `android/gradle.properties` étant régénéré par `expo prebuild`, ces valeurs ne
 * peuvent pas y être écrites à la main — même raison que pour la signature
 * (`with-release-signing.js`).
 *
 * ## Ce qui est posé ici, et ce que ça a coûté ou rapporté (mesuré, arm64)
 *
 * - **R8 (`enableMinifyInReleaseBuilds`) + `shrinkResources`** : le dex tombe de
 *   11,6 à 4,7 Mo, soit **−60 %**. C'est le seul réglage du lot qui porte un
 *   risque d'exécution : une règle ProGuard manquante ne casse pas le build,
 *   elle casse le lancement ou un module natif introuvable. Ne touche que le
 *   type de build `release`, donc jamais le développement.
 * - **`useLegacyPackaging`** : les `.so` sont **compressés** dans l'APK au lieu
 *   d'y être stockés tels quels. **−17,2 Mo au téléchargement**, mais Android
 *   les extrait à l'installation : **+9,2 Mo sur le téléphone**. Choix assumé —
 *   le dépôt auto-hébergé n'a pas de mise à jour différentielle, chaque version
 *   se retélécharge en entier.
 * - **`expo.gif.enabled` / `expo.webp.enabled`** : Fresco embarque les décodeurs
 *   GIF et WebP dans chaque architecture. Kadens n'affiche **aucune image
 *   bitmap** — pas un seul `<Image>` dans `src/`, les icônes sont des SVG et les
 *   visuels du lanceur sont des ressources Android. **−0,8 Mo par architecture**,
 *   sans contrepartie.
 *
 * ## Les deux autres leviers, qui ne sont pas ici
 *
 * - **`@expo/ui` exclu de l'autolinking** (`package.json`, `expo.autolinking.exclude`) :
 *   il tirait tout Jetpack Compose + Material3, soit 35 % du dex, pour un
 *   *toolbar* d'`expo-router` que l'app n'utilise pas. **−6,5 Mo.**
 * - **`reactNativeArchitectures=arm64-v8a`**, passé par le workflow de build et
 *   **non posé ici** : la propriété est globale, elle vaudrait aussi pour le
 *   développement, et un émulateur sur une machine Intel est en x86_64. La
 *   restriction n'a de sens que pour l'APK publié. **−74,7 Mo.**
 */

const { withGradleProperties } = require('expo/config-plugins');

const PROPERTIES = [
  ['android.enableMinifyInReleaseBuilds', 'true'],
  ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
  ['expo.useLegacyPackaging', 'true'],
  ['expo.gif.enabled', 'false'],
  ['expo.webp.enabled', 'false'],
  ['expo.webp.animated', 'false'],
];

/**
 * @param {{ type: string, key?: string, value?: string }[]} properties
 * @returns {{ type: string, key?: string, value?: string }[]}
 */
function applyProperties(properties) {
  const next = [...properties];

  for (const [key, value] of PROPERTIES) {
    const existing = next.find((entry) => entry.type === 'property' && entry.key === key);

    if (existing) {
      existing.value = value;
    } else {
      next.push({ type: 'property', key, value });
    }
  }

  return next;
}

/**
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withAppSize = (config) =>
  withGradleProperties(config, (modConfig) => {
    modConfig.modResults = applyProperties(modConfig.modResults);

    return modConfig;
  });

module.exports = withAppSize;
module.exports.applyProperties = applyProperties;
module.exports.PROPERTIES = PROPERTIES;
