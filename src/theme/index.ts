/**
 * Point d'entrée du thème.
 *
 * Un composant importe **d'ici**, jamais de `tokens.ts` directement : ça laisse
 * la liberté d'ajouter une adaptation native (un helper, une valeur dérivée)
 * sans toucher au fichier généré. C'est cette liberté qui a permis d'y poser le
 * mode sombre sans réécrire le générateur des composants.
 *
 * Rappels qui tiennent tout le reste :
 * - jamais de couleur ni de police en dur, toujours un token (règle 1) ;
 * - le condensé capitales ne touche pas au contenu saisi (règle 4, cf.
 *   `typography.ts`) ;
 * - **deux jeux de couleurs, une seule source**. Le papier et la nuit sortent du
 *   même `tokens.css`, projeté par le serveur. Aucun composant n'importe `light`
 *   ni `dark` : il déclare ses styles avec `themed()` et les lit avec
 *   `useStyles()`, ce qui les rend justes dans les deux jeux sans y penser. Le
 *   pourquoi de cette API, et ce qu'elle coûte au rendu (rien), sont dans
 *   `theme.tsx`.
 */

export { fontStacks, radius, space, tracking } from './tokens';
export type { ColorSet, ColorToken, FontStack, SpaceToken, ThemeName, Weight } from './tokens';

/**
 * Les deux jeux bruts. **Réservés aux tests de contraste**, qui doivent parcourir
 * les palettes plutôt que d'en habiter une : un composant qui les importerait se
 * figerait dans un papier.
 */
export { palettes } from './tokens';

export {
  resolveTheme,
  setThemePreference,
  themed,
  ThemeProvider,
  useColors,
  useStyles,
  useSystemBackground,
  useTheme,
  variants,
} from './theme';
export type { Themed, ThemePreference } from './theme';

export { layout } from './layout';

export { useReducedMotion } from './motion';

export { fontFamily, useKadensFonts } from './fonts';
export type { WeightOf } from './fonts';

export { letterSpacing, text } from './typography';
export type { TextRole } from './typography';
