// La configuration Metro par défaut d'Expo, plus l'extension `.sql` : sans elle
// Metro ne considère pas les migrations générées comme du code source et refuse
// de les résoudre. Elle va de pair avec le plugin Babel `inline-import`, qui les
// transforme ensuite en chaînes (cf. `babel.config.js`).
//
// Comme `babel.config.js`, ce fichier n'existait pas avant KL-24 : le créer
// implique de repartir de `getDefaultConfig`, sinon on perd tout ce qu'Expo
// configure (résolution des alias, assets, web).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('sql');

// Le portage web d'`expo-sqlite` s'appuie sur wa-sqlite, dont le `.wasm` est
// importé comme un asset. Sans cette ligne, `npx expo export -p web` échoue à la
// résolution — et c'est notre seule vérification du bundler. L'app ne cible pas
// le web pour autant : le runtime WASM y demanderait des en-têtes serveur qu'on
// ne fournit pas (cf. `src/db/client.ts`).
config.resolver.assetExts.push('wasm');

module.exports = config;
