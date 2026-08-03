/**
 * Point d'entrée du thème.
 *
 * Un composant importe **d'ici**, jamais de `tokens.ts` directement : ça laisse
 * la liberté d'ajouter une adaptation native (un helper, une valeur dérivée)
 * sans toucher au fichier généré.
 *
 * Rappels qui tiennent tout le reste :
 * - jamais de couleur ni de police en dur, toujours un token (règle 1) ;
 * - le condensé capitales ne touche pas au contenu saisi (règle 4, cf.
 *   `typography.ts`) ;
 * - **pas de thème sombre** : l'identité Presse est papier et encre. Il n'y a
 *   donc qu'un jeu de valeurs, et aucun `useColorScheme` dans l'app.
 */

export { colors, fontStacks, radius, space, tracking } from './tokens';
export type { ColorToken, FontStack, SpaceToken, Weight } from './tokens';

export { fontFamily, useKadensFonts } from './fonts';
export type { WeightOf } from './fonts';

export { letterSpacing, text } from './typography';
export type { TextRole } from './typography';
