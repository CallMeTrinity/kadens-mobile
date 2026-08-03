/**
 * Chargement des polices embarquées et choix d'une graisse.
 *
 * Les fichiers viennent de `assets/fonts/`, récupérés par `npm run sync:fonts`
 * depuis `public/fonts/` (dépôt kadens). Ils sont chargés au lancement par
 * `useFonts`, et non par le plugin natif d'`expo-font` : le rendu web reste
 * ainsi le même que le natif, et rien ne dépend d'un `expo prebuild` réussi
 * pour itérer sur un composant.
 *
 * **Une graisse = une police enregistrée.** Android ne synthétise pas les
 * graisses d'une famille chargée à l'exécution : demander `fontWeight: '700'`
 * sur « Barlow » y rend du Barlow régulier, silencieusement. On enregistre donc
 * chaque fichier sous son propre nom et on choisit la police par
 * `fontFamily()` — jamais par `fontWeight`, qui ne sert plus qu'à décrire
 * l'intention (et à rendre correctement sur le web).
 */

import { useFonts } from 'expo-font';

import type { FontStack, Weight } from './tokens';

/**
 * Les `require()` sont écrits en toutes lettres et en chemin relatif : Metro
 * résout les assets au build, un chemin construit rendrait `undefined`.
 */
export const fontAssets = {
  'barlow-400': require('../../assets/fonts/barlow-400.ttf'),
  'barlow-500': require('../../assets/fonts/barlow-500.ttf'),
  'barlow-600': require('../../assets/fonts/barlow-600.ttf'),
  'barlow-700': require('../../assets/fonts/barlow-700.ttf'),
  'barlow-condensed-500': require('../../assets/fonts/barlow-condensed-500.ttf'),
  'barlow-condensed-600': require('../../assets/fonts/barlow-condensed-600.ttf'),
  'barlow-condensed-700': require('../../assets/fonts/barlow-condensed-700.ttf'),
  'barlow-condensed-800': require('../../assets/fonts/barlow-condensed-800.ttf'),
  'ibm-plex-mono-400': require('../../assets/fonts/ibm-plex-mono-400.ttf'),
  'ibm-plex-mono-500': require('../../assets/fonts/ibm-plex-mono-500.ttf'),
  'ibm-plex-mono-600': require('../../assets/fonts/ibm-plex-mono-600.ttf'),
} as const;

type FontName = keyof typeof fontAssets;

/**
 * Graisses réellement embarquées, par famille.
 *
 * Toutes les familles n'ont pas toutes les graisses — c'est le tableau
 * `FAMILIES` de `tools/fetch-fonts.sh` qui en décide, côté serveur. Le typage
 * de `fontFamily()` s'appuie sur cette table : demander une graisse absente est
 * une erreur de compilation, pas un repli muet à l'exécution.
 */
const faces = {
  display: {
    '500': 'barlow-condensed-500',
    '600': 'barlow-condensed-600',
    '700': 'barlow-condensed-700',
    '800': 'barlow-condensed-800',
  },
  body: {
    '400': 'barlow-400',
    '500': 'barlow-500',
    '600': 'barlow-600',
    '700': 'barlow-700',
  },
  mono: {
    '400': 'ibm-plex-mono-400',
    '500': 'ibm-plex-mono-500',
    '600': 'ibm-plex-mono-600',
  },
} as const satisfies Record<FontStack, Partial<Record<Weight, FontName>>>;

/** Graisses disponibles pour une famille donnée. */
export type WeightOf<S extends FontStack> = keyof (typeof faces)[S];

/** Nom de la police à passer à `fontFamily` d'un style React Native. */
export function fontFamily<S extends FontStack>(stack: S, fontWeight: WeightOf<S>): FontName {
  return faces[stack][fontWeight] as FontName;
}

/**
 * Charge les onze polices. Rend `[loaded, error]`.
 *
 * Tant que `loaded` est faux, l'app n'affiche rien : l'écran de démarrage tient
 * la place (cf. `src/app/_layout.tsx`). Un premier rendu en police système
 * suivi d'une bascule ferait sauter toute la mise en page.
 */
export function useKadensFonts() {
  return useFonts(fontAssets);
}
