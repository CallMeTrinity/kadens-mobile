/**
 * KL-41 — la `signingConfig` de release, en plugin plutôt qu'à la main.
 *
 * `android/` n'est pas versionné : il est régénéré par `expo prebuild` à chaque
 * build. Une `signingConfig` écrite à la main dans `android/app/build.gradle`
 * survivrait au premier build local et disparaîtrait au suivant, sans bruit —
 * l'APK sortirait alors signé par la clé de **debug**, donc refusé en mise à
 * jour par-dessus une installation existante. Le seul endroit où cette
 * configuration tient, c'est ici.
 *
 * Ce que le plugin injecte lit ses valeurs de l'**environnement** d'abord, d'une
 * propriété Gradle ensuite :
 *
 *   KADENS_RELEASE_STORE_FILE      chemin absolu du .jks
 *   KADENS_RELEASE_STORE_PASSWORD  mot de passe du keystore
 *   KADENS_RELEASE_KEY_ALIAS       alias de la clé (kadens-release)
 *   KADENS_RELEASE_KEY_PASSWORD    mot de passe de la clé — distinct du précédent,
 *                                  c'est ce que le format JKS permet (KL-40)
 *
 * L'environnement passe en premier parce que c'est ce qu'un workflow sait faire
 * sans rien écrire sur disque : un mot de passe posé dans `~/.gradle/gradle.properties`
 * finirait dans le cache Gradle du runner. La propriété Gradle reste comme repli
 * pour un build de release sur le poste.
 *
 * **Sans ces valeurs, le bloc reste vide et la release retombe sur la clé de
 * debug.** C'est délibéré — `npx expo run:android --variant release` doit
 * marcher sans clé — mais ça veut dire qu'un APK non signé ne se voit pas à la
 * sortie de Gradle. C'est le workflow qui le rattrape, en recoupant l'empreinte
 * du certificat de l'APK produit avec celle du certificat de release.
 */

const { withAppBuildGradle } = require('expo/config-plugins');

// Indentation à 8 espaces : on est dans `android { signingConfigs { … } }`.
const SIGNING_CONFIG = `
        // KL-41 — clé de release, injectée par plugins/with-release-signing.js.
        release {
            def kadensStore = System.getenv('KADENS_RELEASE_STORE_FILE') ?: findProperty('KADENS_RELEASE_STORE_FILE')
            if (kadensStore) {
                storeFile file(kadensStore)
                storePassword System.getenv('KADENS_RELEASE_STORE_PASSWORD') ?: findProperty('KADENS_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('KADENS_RELEASE_KEY_ALIAS') ?: findProperty('KADENS_RELEASE_KEY_ALIAS')
                keyPassword System.getenv('KADENS_RELEASE_KEY_PASSWORD') ?: findProperty('KADENS_RELEASE_KEY_PASSWORD')
            }
        }`;

// Le gabarit RN pose `signingConfig signingConfigs.debug` dans **deux** types de
// build. On ne veut que celui de `release`, d'où l'ancrage sur `buildTypes {`
// puis sur le premier `release {` qui suit.
const RELEASE_BUILD_TYPE =
  /(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;

const SIGNING_CONFIGS_BLOCK = /(signingConfigs\s*\{)/;

/**
 * @param {string} gradle contenu de android/app/build.gradle
 * @returns {string}
 */
function patchBuildGradle(gradle) {
  if (gradle.includes('KADENS_RELEASE_STORE_FILE')) {
    return gradle;
  }

  if (!SIGNING_CONFIGS_BLOCK.test(gradle)) {
    throw new Error(
      "with-release-signing : pas de bloc `signingConfigs` dans android/app/build.gradle. Le gabarit React Native a changé, le plugin doit être réécrit — sans quoi l'APK de release sortirait signé en debug.",
    );
  }

  if (!RELEASE_BUILD_TYPE.test(gradle)) {
    throw new Error(
      "with-release-signing : pas de `signingConfig signingConfigs.debug` dans `buildTypes.release`. Le gabarit React Native a changé, le plugin doit être réécrit — sans quoi l'APK de release sortirait signé en debug.",
    );
  }

  return gradle
    .replace(SIGNING_CONFIGS_BLOCK, `$1${SIGNING_CONFIG}`)
    .replace(
      RELEASE_BUILD_TYPE,
      '$1signingConfig signingConfigs.release.storeFile != null ? signingConfigs.release : signingConfigs.debug',
    );
}

/**
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        `with-release-signing : android/app/build.gradle est en ${modConfig.modResults.language}, le plugin ne sait patcher que du Groovy.`,
      );
    }

    modConfig.modResults.contents = patchBuildGradle(modConfig.modResults.contents);

    return modConfig;
  });

module.exports = withReleaseSigning;
module.exports.patchBuildGradle = patchBuildGradle;
