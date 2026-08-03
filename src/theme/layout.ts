/**
 * Constantes de mise en page qui ne sont pas des tokens.
 *
 * Elles n'existent pas dans `tokens.css` — le web les porte dans `base.css`
 * (cible tactile) ou en `vh` dans `components.css` (hauteur de feuille), donc
 * l'export de KL-20 ne les voit pas. Les écrire ici plutôt que dans chaque
 * composant évite qu'un `44` se transforme en `40` par distraction dans le
 * huitième fichier.
 */

export const layout = {
  /**
   * Plancher de cible tactile, en points. Reprend le `44×44` que `base.css`
   * impose sous `@media (pointer: coarse)` — sauf qu'ici **tout** est tactile :
   * ce n'est plus une media query mais un minimum absolu.
   */
  touchTarget: 44,

  /**
   * Épaisseur d'un filet. **Pas `StyleSheet.hairlineWidth`** : il vaut moins
   * d'un point sur la plupart des écrans Android, et l'identité Presse tient
   * précisément par ses filets — les affiner, c'est la dissoudre.
   */
  hairline: 1,

  /**
   * Hauteur maximale d'une feuille, en fraction de l'écran. Transposition du
   * `max-height: 78vh` du web : au-delà, la feuille cesse de se lire comme un
   * calque posé sur l'écran.
   */
  sheetMaxHeight: '78%',
} as const;
