// KL-41 — remplaçant de `@expo/ui` côté JS.
//
// `package.json` exclut `@expo/ui` de l'autolinking : le module natif `ExpoUI`
// n'est plus dans l'APK (−6,5 Mo, 35 % du dex). Mais exclure l'autolinking ne
// retire **que le natif** — le paquet npm reste résolvable, et son JS reste
// bundlé. Or `expo-router` le tire par une chaîne de `require` **statique** que
// rien ne conditionne :
//
//   expo-router/build/layouts/Stack.js
//     -> stack-utils/toolbar/StackToolbar
//       -> StackToolbarMenu/native.android, toolbar/native.android, ...
//         -> @expo/ui/jetpack-compose
//           -> colors.ts : requireNativeModule('ExpoUI')  <-- jette ici
//
// `requireNativeModule` (non optionnel) jette **au chargement du module**, pas
// au rendu. Donc `import { Stack } from 'expo-router'` — soit `app/_layout.tsx`,
// soit l'app entière — suffisait à faire tomber le bundle sur
// `Cannot find native module 'ExpoUI'`, sans qu'aucun écran n'ait touché au
// toolbar. Le rebuild qui a suivi KL-41 est le premier où ça se voyait.
//
// Ce stub coupe la chaîne à la résolution (cf. `metro.config.js`) : `@expo/ui`
// n'entre plus dans le bundle, donc `requireNativeModule` n'est jamais atteint.
// L'app ne rend jamais de composant `@expo/ui` — elle dessine sa barre à la main
// (`expo-router/ui` headless, cf. `app/(tabs)/_layout.tsx`) et n'utilise pas
// `Stack.Toolbar`.
//
// ## Pourquoi ce stub ne jette pas
//
// Première version : jeter à l'appel, pour signaler franchement un usage réel.
// Faux — `expo-router` **appelle** `@expo/ui` au chargement d'un module, pas
// seulement au rendu :
//
//   StackToolbarView/native.android.js:10
//     const bottomPlacementModifiers = [(0, modifiers_1.fillMaxHeight)()];
//
// Un modifier construit une fois au niveau du module, hors de tout composant.
// Jeter là revenait à remplacer un crash au démarrage par un autre. Le stub est
// donc **inerte** : tout appel renvoie de quoi continuer, et rien ne casse tant
// que personne ne rend le toolbar pour de bon.
//
// Conséquence à connaître : si un écran se met un jour à rendre `Stack.Toolbar`
// ou un composant `@expo/ui`, **il ne s'affichera pas** — silencieusement, parce
// qu'un composant qui rend `null` est une chose parfaitement normale pour React.
// Il n'y aura pas d'erreur pour te mettre sur la piste, c'est le prix de la
// ligne ci-dessus. Le `console.warn` en dessous est là pour ça, et c'est le seul
// signal. Le correctif est alors de retirer `@expo/ui` de
// `expo.autolinking.exclude` dans `package.json` **et** son alias dans
// `metro.config.js`, puis de reconstruire (`npm run android`) — une
// redéclaration Metro seule ne ramènerait pas le natif.

const MESSAGE =
  "[KL-41] Un composant @expo/ui vient d'être rendu, il ne s'affichera pas : son " +
  "module natif n'est pas dans l'APK et son JS est remplacé par un stub. Pour l'utiliser, " +
  "retire '@expo/ui' de expo.autolinking.exclude dans package.json et son alias dans " +
  'metro.config.js, puis reconstruis (npm run android). Voir stubs/expo-ui.js.';

let warned = false;

// Distinguer un rendu de composant d'un appel de fabrique, pour n'avertir que
// dans le premier cas. React appelle toujours un composant avec un objet de
// props ; les fabriques d'`@expo/ui` prennent des nombres, rien, ou un autre
// résultat de fabrique (`EnterTransition.scaleIn().plus(...)`, qui est une
// fonction du point de vue du proxy, pas un objet simple).
function looksLikeRender(args) {
  const [first] = args;

  return args.length > 0 && typeof first === 'object' && first !== null && !Array.isArray(first);
}

function inert(...args) {
  if (looksLikeRender(args)) {
    if (!warned) {
      warned = true;
      console.warn(MESSAGE);
    }

    // React accepte `null` comme rendu ; lui rendre le proxy le ferait échouer
    // sur un message autrement plus obscur que l'avertissement ci-dessus.
    return null;
  }

  // Tout le reste est une valeur qu'`expo-router` va stocker puis, peut-être,
  // enchaîner. Renvoyer le proxy garde `x().y().z()` navigable.
  return stub;
}

// `get` répond à tout par le proxy lui-même, ce qui couvre aussi bien un
// composant (`jetpackCompose.Host`) qu'une fabrique chaînée sans avoir à suivre
// l'API d'`@expo/ui`. Deux exceptions : `__esModule`, que l'interop Babel lit
// sur tout module, et les symboles (`Symbol.toPrimitive`, `Symbol.iterator`…),
// qu'un proxy-fonction doit laisser à `undefined` sous peine de casser
// sérialisation et coercition.
const stub = new Proxy(inert, {
  get(target, property) {
    if (property === '__esModule') return true;
    if (typeof property === 'symbol') return undefined;
    return stub;
  },
});

module.exports = stub;
