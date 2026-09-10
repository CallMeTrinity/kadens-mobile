/**
 * Le thème : deux papiers, une seule source, rien de calculé au rendu.
 *
 * L'identité Presse a longtemps tenu en un seul jeu de valeurs — « papier et
 * encre », et c'était écrit ici même. Elle en a deux depuis qu'un écran de séance
 * reste allumé une heure dans une salle mal éclairée. Ce qui n'a pas changé, en
 * revanche, c'est **d'où ils viennent** : `assets/styles/tokens.css` côté
 * serveur, projeté par `app:tokens:export`, traduit par `npm run sync:tokens`.
 * Une valeur écrite à la main ici serait une troisième identité.
 *
 * ## Deux fois au chargement, zéro fois au rendu
 *
 * C'est la contrainte qui a dessiné toute l'API. `themed()` appelle sa fabrique
 * **deux fois, à l'import du module**, et rend deux `StyleSheet.create` figés ;
 * `useStyles()` n'est qu'une lecture de contexte suivie d'un accès de propriété.
 *
 * L'alternative évidente — `useMemo(() => StyleSheet.create({…}), [colors])` —
 * aurait reconstruit une feuille par composant à chaque changement de thème,
 * ce qui est rare, mais surtout aurait mis une allocation sur le chemin de rendu
 * d'un écran de 3 400 lignes dont on vient justement de retirer un re-rendu par
 * seconde. Le mode sombre ne doit pas rendre à la batterie ce que le minuteur de
 * repos lui a laissé.
 *
 * Corollaire à ne pas oublier en écrivant une fabrique : elle est appelée
 * **deux fois**, donc elle ne doit avoir aucun effet de bord — pas de `Date.now()`,
 * pas d'aléatoire, rien qui compte les appels.
 *
 * ## Deux fabriques, parce qu'il y a deux natures
 *
 * `themed()` passe par `StyleSheet.create` : c'est pour des styles. `variants()`
 * ne le fait pas : c'est pour les tables de peaux (`SKINS`, `TONES`, les pastilles
 * de type de série), qui sont des tables de chaînes lues en prop, pas des styles.
 * Un `StyleSheet.create` sur `{ bg, border, label }` ne veut rien dire.
 *
 * Les deux rendent la même paire, donc `useStyles()` lit les deux.
 *
 * ## Ce que le fournisseur publie, et pourquoi c'est une chaîne
 *
 * `ThemeProvider` croise deux entrées — la préférence (`preference.theme`) et le
 * schéma du système — et ne publie que le résultat : `'light'` ou `'dark'`. Sans
 * lui, chaque composant referait le croisement, et surtout la règle de repli et
 * le contournement de migration se retrouveraient recopiés vingt-cinq fois.
 *
 * ## Pas de clignotement au lancement, et c'est une décision de lecture
 *
 * La préférence se lit **synchroniquement** (`getPreferences()`), pas par
 * `usePreferences()`. Ce dernier est une requête vive : son premier rendu retombe
 * sur les défauts, donc sur `'system'`, indiscernable d'un vrai choix « système ».
 * Chez quelqu'un qui a forcé le clair sur un téléphone en sombre, ça ferait un
 * flash à **chaque** montage, pas seulement au lancement.
 *
 * C'est la différence avec `useReducedMotion()`, qui a le droit de se corriger au
 * premier rendu : une animation de trop se pardonne, un écran qui change de
 * couleur sous les yeux non.
 *
 * ## Pourquoi ce module lit la base, alors que le reste du thème est inerte
 *
 * `@/theme` ne dépendait de rien. Il dépend maintenant de `@/db`, le temps de
 * deux appels : lire et écrire la préférence. C'est assumé — le thème **est** un
 * réglage persisté, au même titre que la silhouette, et le déporter dans
 * `@/session` mettrait le fournisseur de l'app dans le module qui sait ce qu'est
 * une série. Ce qui reste vrai : rien ici ne parle au réseau, et le type de la
 * colonne se déclare dans `@/db`, pas ici.
 */

import { createContext, use, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ColorSchemeName,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getPreferences, patchPreferences, type ThemePreference } from '@/db';

import { dark, light, type ColorSet, type ThemeName } from './tokens';

export type { ThemePreference };

/** Une valeur déclinée dans les deux jeux. */
export type Themed<T> = { light: T; dark: T };

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Une feuille de styles par jeu, figée au chargement du module.
 *
 * S'écrit exactement là où vivait le `StyleSheet.create` d'avant — en bas de
 * fichier — et se lit par `useStyles()` dans chaque composant qui s'en sert.
 */
export function themed<T extends NamedStyles>(build: (c: ColorSet) => T): Themed<T> {
  return {
    light: StyleSheet.create(build(light)),
    dark: StyleSheet.create(build(dark)),
  };
}

/**
 * Le pendant de `themed()` pour ce qui n'est pas un style : une table de peaux,
 * une table de teintes, tout ce qui se lit en prop plutôt qu'en `style`.
 */
export function variants<T>(build: (c: ColorSet) => T): Themed<T> {
  return { light: build(light), dark: build(dark) };
}

const ThemeContext = createContext<ThemeName>('light');

/** Le jeu en vigueur, par son nom. */
export function useTheme(): ThemeName {
  return use(ThemeContext);
}

/** L'un des deux, selon le jeu en vigueur. Un accès de propriété, rien de plus. */
export function useStyles<T>(pair: Themed<T>): T {
  return pair[use(ThemeContext)];
}

/** Le jeu de couleurs en vigueur, pour ce qui se lit en JSX — une prop, un `fill`. */
export function useColors(): ColorSet {
  return use(ThemeContext) === 'dark' ? dark : light;
}

/**
 * Ce que la préférence donne, croisé avec ce que le système dit.
 *
 * Trois façons de ne rien dire, et elles se valent : « unspecified », `null`,
 * `undefined`. Le hook n'en rend qu'une aujourd'hui, mais `Appearance` en donne
 * les trois selon le chemin — et `app.json` peut bâillonner le système
 * entièrement. L'identité est du papier : c'est elle, le défaut.
 *
 * Pure et exportée pour être éprouvée sans rendu.
 */
export function resolveTheme(
  preference: ThemePreference,
  system: ColorSchemeName | null | undefined,
): ThemeName {
  if (preference !== 'system') {
    return preference;
  }

  // `ColorSchemeName` porte une troisième valeur, « unspecified », qui veut dire
  // la même chose qu'une absence : le système ne se prononce pas.
  return system === 'dark' || system === 'light' ? system : 'light';
}

/* --------------------------------------------------------------------------
   Le magasin de la préférence

   Un magasin de module plutôt qu'un état d'écran, pour la raison donnée en tête
   de fichier : la lecture doit être synchrone au tout premier rendu. Même patron
   que `session/rest.ts`.
   -------------------------------------------------------------------------- */

let preference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  if (preference === null) {
    try {
      preference = getPreferences().theme;
    } catch {
      // Le fournisseur est monté **au-dessus** du garde de migrations : sur une
      // base qui n'a pas encore migré, la colonne n'existe pas. On retombe sur
      // le téléphone — le seul écran concerné est celui qui annonce la panne, et
      // il n'y a pas de réglage à respecter quand il n'y a pas de réglages.
      preference = 'system';
    }
  }

  return preference;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Change le thème, et le dit.
 *
 * Passe **ici** et non par `patchPreferences` directement : le magasin doit être
 * notifié, sans quoi l'app garderait son papier jusqu'au prochain lancement.
 */
export function setThemePreference(next: ThemePreference): void {
  patchPreferences({ theme: next });
  preference = next;
  listeners.forEach((listener) => listener());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, readPreference, readPreference);
  const system = useColorScheme();

  return <ThemeContext value={resolveTheme(stored, system)}>{children}</ThemeContext>;
}

/**
 * Peint le fond de **fenêtre**, sous la vue React.
 *
 * Ce que ça règle se voit une frame à la fois : la trame avant le premier rendu,
 * une rotation, un débordement de défilement. Sans ça, une app sombre laisse
 * apparaître une gouttière blanche à ces moments-là — le système ne devine pas
 * la couleur d'un arbre qu'il ne rend pas.
 *
 * Un hook et non un appel au montage : le fond suit la bascule de thème.
 */
export function useSystemBackground(): void {
  const colors = useColors();
  const [ui, setUi] = useState<typeof import('expo-system-ui') | null>(null);

  useEffect(() => {
    // Chargé à la demande : le module est une dépendance transitive d'Expo, et
    // rien d'autre dans l'app ne l'importe.
    void import('expo-system-ui').then(setUi);
  }, []);

  useEffect(() => {
    void ui?.setBackgroundColorAsync(colors.bg);
  }, [ui, colors.bg]);
}
