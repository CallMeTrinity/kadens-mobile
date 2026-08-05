/**
 * Le rapport de contraste WCAG entre deux couleurs (KL-39).
 *
 * Vit dans les aides de test et non dans `@/theme` : l'app ne calcule jamais de
 * contraste à l'exécution — elle pose des tokens, et c'est la suite qui vérifie
 * que les couples posés tiennent. Du code qui n'aurait servi qu'à ça dans le
 * paquet livré serait du poids mort.
 *
 * Formule de `WCAG 2.1 §1.4.3` : luminance relative sRGB, et le rapport
 * `(clair + 0,05) / (sombre + 0,05)`. Les seuils vont avec la taille du texte —
 * 4,5:1 en corps courant, 3:1 dès 24 points, ou 18,66 en gras.
 */

/** Seuil AA d'un texte courant. */
export const AA_TEXT = 4.5;
/** Seuil AA d'un grand texte, et d'un objet graphique (`§1.4.11`). */
export const AA_LARGE = 3;

function channel(value: number): number {
  const ratio = value / 255;

  return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
}

/** Luminance relative d'un `#rrggbb`. Aucune autre notation n'est attendue ici. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);

  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Couleur non comparable : « ${hex} ». Attendu #rrggbb.`);
  }

  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];

  return (light + 0.05) / (dark + 0.05);
}

/**
 * Un texte de cette taille et de cette graisse est-il « grand » au sens WCAG ?
 *
 * Les tailles de React Native sont en points de densité, comparables aux pixels
 * CSS : 24 points, ou 18,66 en gras (14 points typographiques).
 */
export function isLargeText(fontSize: number, fontWeight: string): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && Number.parseInt(fontWeight, 10) >= 700);
}
