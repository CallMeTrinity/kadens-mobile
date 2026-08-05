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

// KL-41 — `@expo/ui` est exclu de l'autolinking, donc son module natif n'est pas
// dans l'APK. Son JS, lui, reste résolvable et `expo-router` l'importe
// statiquement depuis `Stack` : sans cet alias, le bundle tombe au démarrage sur
// `Cannot find native module 'ExpoUI'`. Le raisonnement complet et la marche à
// suivre pour revenir en arrière sont dans `stubs/expo-ui.js`.
//
// L'alias couvre tous les sous-chemins (`/jetpack-compose`, `/swift-ui`,
// `/jetpack-compose/modifiers`…) : les fichiers `.android` et `.ios` d'expo-router
// n'importent pas les mêmes, et Metro résout les deux quand il bundle pour le web.
const expoUiStub = require.resolve('./stubs/expo-ui.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@expo/ui' || moduleName.startsWith('@expo/ui/')) {
    return { type: 'sourceFile', filePath: expoUiStub };
  }

  // `context.resolveRequest` reste le résolveur par défaut de Metro à
  // l'intérieur du nôtre — l'appeler ici n'est pas une récursion.
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
