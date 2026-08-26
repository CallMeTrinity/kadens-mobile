/**
 * Échelle typographique native.
 *
 * Elle n'est **pas** générée : côté web l'échelle vit en dur dans
 * `components.css` (en `clamp()`, donc fluide avec la largeur de fenêtre), rien
 * ne la porte dans `tokens.css`. Ce fichier en est la transposition à une seule
 * largeur — celle d'un téléphone — et la référence est
 * `docs/design-system.md §3`.
 *
 * Deux familles de rôles, et la frontière est la **règle 4** du design system :
 *
 * - **Structure** (`hero`, `pageTitle`, `sectionTitle`, `blockRole`, `action`,
 *   `eyebrow`) : Barlow Condensed ou mono, capitales. Ce sont des libellés que
 *   l'app écrit elle-même.
 * - **Contenu** (`pageName`, `name`, `body`, `bodyStrong`, `caption`,
 *   `numeric`) : Barlow, casse normale. Tout ce qui a été **saisi** — nom
 *   d'exercice, de séance, note — passe par là. Barlow Condensed en capitales
 *   sur un nom propre devient illisible.
 *
 * Un rôle ne porte jamais de couleur : elle vient de `colors`, au point
 * d'usage.
 */

import type { TextStyle } from 'react-native';

import { fontFamily, type WeightOf } from './fonts';
import { type FontStack, tracking } from './tokens';

/**
 * Convertit un interlettrage en **em** (comme le web l'écrit) vers les points
 * qu'attend React Native. `letterSpacing` y est absolu : une valeur figée
 * serait juste à une seule taille de police.
 */
export function letterSpacing(em: number, fontSize: number): number {
  return Number((em * fontSize).toFixed(2));
}

type Role<S extends FontStack> = {
  stack: S;
  weight: WeightOf<S>;
  size: number;
  /**
   * Multiplicateur d'interligne. **Plancher à 1** : Android rogne le haut des
   * lettres dès que `lineHeight` passe sous la taille de police, là où le web
   * se contente de resserrer les lignes. Les valeurs très serrées des titres
   * web (`.88`, `.92`) ne se transposent donc pas telles quelles.
   */
  leading?: number;
  tracking?: number;
  uppercase?: boolean;
  /** Chiffres de largeur fixe : sans ça, une valeur qui change fait sauter la mise en page. */
  tabular?: boolean;
};

function role<S extends FontStack>({
  stack,
  weight,
  size,
  leading = 1.3,
  tracking: em = 0,
  uppercase = false,
  tabular = false,
}: Role<S>): TextStyle {
  return {
    fontFamily: fontFamily(stack, weight),
    // La police porte déjà sa graisse (cf. fonts.ts) ; `fontWeight` ne fait que
    // décrire l'intention, et sert au rendu web.
    fontWeight: weight as TextStyle['fontWeight'],
    fontSize: size,
    lineHeight: Math.round(size * Math.max(leading, 1)),
    ...(em !== 0 ? { letterSpacing: letterSpacing(em, size) } : null),
    ...(uppercase ? { textTransform: 'uppercase' as const } : null),
    ...(tabular ? { fontVariant: ['tabular-nums' as const] } : null),
  };
}

export const text = {
  /* --- Structure ---------------------------------------------------------- */

  /** Titre de séance, en tête d'écran. Le plus gros pas de l'échelle. */
  hero: role({
    stack: 'display',
    weight: '800',
    size: 40,
    leading: 1,
    tracking: tracking.display,
    uppercase: true,
  }),

  /** Titre d'écran. */
  pageTitle: role({
    stack: 'display',
    weight: '800',
    size: 30,
    leading: 1,
    tracking: tracking.display,
    uppercase: true,
  }),

  /**
   * Titre de carte ou de section. Le web écrit `.04em` ici ; aucun token ne
   * porte cette valeur, on retient l'eyebrow plutôt que d'introduire un
   * sixième interlettrage.
   */
  sectionTitle: role({
    stack: 'display',
    weight: '700',
    size: 19,
    leading: 1.15,
    tracking: tracking.eyebrow,
    uppercase: true,
  }),

  /** Rôle de bloc : échauffement, principal, retour au calme. */
  blockRole: role({
    stack: 'display',
    weight: '700',
    size: 22,
    leading: 1.1,
    tracking: tracking.eyebrow,
    uppercase: true,
  }),

  /** Bouton, onglet. */
  action: role({
    stack: 'display',
    weight: '700',
    size: 15,
    leading: 1.2,
    tracking: tracking.action,
    uppercase: true,
  }),

  /**
   * Entrée de la barre de navigation basse (KL-37).
   *
   * Le web descend `.kd-nav__link` de 15 à 11 points sous 560px, sans changer
   * de famille : c'est la même transposition ici. Un cran d'interlettrage de
   * moins que `action`, parce qu'à cette taille le `.1em` de l'action écarterait
   * « Aujourd'hui » au-delà du tiers d'écran qui lui revient.
   */
  tabLabel: role({
    stack: 'display',
    weight: '600',
    size: 11,
    leading: 1.2,
    tracking: tracking.eyebrow,
    uppercase: true,
  }),

  /** Sur-titre et libellé de champ, en mono capitales. */
  eyebrow: role({
    stack: 'mono',
    weight: '600',
    size: 11,
    leading: 1.4,
    tracking: tracking.eyebrowLg,
    uppercase: true,
  }),

  /** Grand chiffre : tonnage, séries, minutes. */
  kpi: role({ stack: 'display', weight: '800', size: 40, leading: 1, tabular: true }),

  /* --- Contenu ------------------------------------------------------------ */

  /**
   * Titre d'écran qui est un **nom saisi** : le nom de la séance, en tête de
   * l'écran de séance. `pageTitle` en écrirait « LOWER W/ RENFO » — règle 4 :
   * un nom propre en condensé capitales ne se lit plus. Un cran au-dessus de
   * `name` parce qu'il tient le rôle de titre, un gros cran sous `pageTitle`
   * parce qu'en séance la hauteur prise en tête est prise à la série en cours.
   */
  pageName: role({ stack: 'body', weight: '600', size: 22, leading: 1.15 }),

  /** Nom saisi : exercice, séance, plan, athlète. Jamais de capitales forcées. */
  name: role({ stack: 'body', weight: '600', size: 17, leading: 1.25 }),

  /** Corps de texte. */
  body: role({ stack: 'body', weight: '400', size: 15 }),

  /** Corps de texte accentué. */
  bodyStrong: role({ stack: 'body', weight: '600', size: 15 }),

  /** Mention secondaire, aide, horodatage en clair. */
  caption: role({ stack: 'body', weight: '400', size: 13, leading: 1.35 }),

  /**
   * Valeur chiffrée saisie ou relue en séance (charge, répétitions, repos).
   * En mono, parce qu'une colonne de charges se lit en colonne.
   */
  numeric: role({ stack: 'mono', weight: '500', size: 16, leading: 1.2, tabular: true }),

  /**
   * Ce qui **accompagne** un nombre sans être le nombre : son unité (« reps »,
   * « kg ») et la valeur qu'il remplace, barrée sous lui. Même filet mono que
   * `numeric`, un pas en dessous — ce qu'on lit d'une série est le chiffre en
   * cours ; l'unité dit de quoi il parle, la valeur barrée d'où il vient.
   *
   * Reste bien au-dessus du plancher de lecture (11, `eyebrow`) : plus petit,
   * ça ne se lit plus le téléphone posé au sol entre deux séries.
   */
  numericMinor: role({ stack: 'mono', weight: '500', size: 13, leading: 1.2, tabular: true }),

  /**
   * Valeur au centre d'un `NumberStepper`. Même famille que `numeric`, deux
   * pas au-dessus : elle se lit **à bout de bras**, barre en main, et c'est
   * elle qu'on vérifie avant de valider une série. Un rôle plutôt qu'une taille
   * écrite dans le composant — l'échelle reste au même endroit.
   */
  inputValue: role({ stack: 'mono', weight: '500', size: 22, leading: 1.2, tabular: true }),
} as const;

export type TextRole = keyof typeof text;
