/**
 * Figure — le bonhomme de la forme ressentie, de 1 (avachi) à 5 (bras en l'air).
 *
 * Le pendant de `Icon` pour les seuls dessins qui ne sont pas Lucide. Même règle
 * de provenance : le serveur fige ces cinq dessins dans
 * `assets/icons/kadens/feeling-{1..5}.svg` (lus par `ux_icon('kadens:feeling-4')`),
 * et les tracés ci-dessous en sont **recopiés tels quels**. Un `git grep
 * 'M24 25l-8 6 3 7'` dans les deux dépôts doit tomber sur le même bras levé.
 *
 * ## Une posture par cran, pas un visage qui change
 *
 * Cinq smileys se ressemblent à 40 points : seule la bouche change, et c'est elle
 * qu'on lit le moins bien debout, à bout de bras. Une **silhouette** se lit d'un
 * coup d'œil — affalé, bras ballants, bras ouverts, un bras levé, les deux levés.
 * Le visage reste, mais il confirme ; c'est la posture qui dit le cran.
 *
 * ## Un trait, une couleur
 *
 * Tout est tracé dans la même encre (`color`), y compris les yeux et la bouche
 * ouverte du cinq, qui se **remplissent** de cette même encre. Le choix de
 * l'encre revient à l'appelant : `text` pour le cran retenu, `textSoft` pour les
 * autres — jamais `textFaint`, puisque le chiffre qui l'accompagne est du texte.
 */

import Svg, { Circle, Path } from 'react-native-svg';

/** Un trait du dessin. `fill` et `strokeWidth` ne sont posés que là où ils changent. */
type Stroke =
  | { d: string; strokeWidth?: number; filled?: boolean }
  | { cx: number; cy: number; r: number; filled?: boolean };

export type FeelingLevel = 1 | 2 | 3 | 4 | 5;

const EYES: Stroke[] = [
  { cx: 21.5, cy: 11, r: 1, filled: true },
  { cx: 26.5, cy: 11, r: 1, filled: true },
];

const FIGURES: Record<FeelingLevel, Stroke[]> = {
  /** Très faible : affalé, tête basse, yeux fermés. */
  1: [
    { cx: 28, cy: 18, r: 7 },
    { d: 'M25 18h2.5M30 18h2.5' },
    { d: 'M26 23q2-1.5 4 0', strokeWidth: 1.6 },
    { d: 'M26 25q-5 9-2 19' },
    { d: 'M25 30l-5 13M25 30l5 13' },
    { d: 'M24 44l-7 7 3 9M24 44l7 7-3 9' },
  ],
  /** Faible : debout, bras le long du corps, moue. */
  2: [
    { cx: 24, cy: 12, r: 7 },
    ...EYES,
    { d: 'M21.5 15.5q2.5-1.5 5 0', strokeWidth: 1.6 },
    { d: 'M24 19v23' },
    { d: 'M24 25l-5 15M24 25l5 15' },
    { d: 'M24 42l-5 18M24 42l5 18' },
  ],
  /** Normal : bras ouverts, bouche droite. */
  3: [
    { cx: 24, cy: 12, r: 7 },
    ...EYES,
    { d: 'M21.5 15h5', strokeWidth: 1.6 },
    { d: 'M24 19v23' },
    { d: 'M24 25l-10 11M24 25l10 11' },
    { d: 'M24 42l-6 18M24 42l6 18' },
  ],
  /** En forme : un bras levé, sourire. */
  4: [
    { cx: 24, cy: 12, r: 7 },
    ...EYES,
    { d: 'M21 14.5q3 2.5 6 0', strokeWidth: 1.6 },
    { d: 'M24 19v23' },
    { d: 'M24 25l-8 6 3 7M24 25l9-6 3-12' },
    { d: 'M24 42l-7 18M24 42l7 18' },
  ],
  /** Très en forme : les deux bras en l'air, bouche ouverte. */
  5: [
    { cx: 24, cy: 14, r: 7 },
    { d: 'M20.5 13q1.5-2 3 0M24.5 13q1.5-2 3 0', strokeWidth: 1.6 },
    { d: 'M21 16.5h6q0 3.5-3 3.5t-3-3.5z', strokeWidth: 1.4, filled: true },
    { d: 'M24 21v21' },
    { d: 'M24 26L12 10M24 26l12-16' },
    { d: 'M24 42l-10 16M24 42l10 16' },
  ],
};

/** Le rapport du dessin : 48 de large pour 64 de haut. */
const RATIO = 64 / 48;

export type FigureProps = {
  level: FeelingLevel;
  /** Largeur en points ; la hauteur suit le rapport 3:4 du dessin. */
  width: number;
  /** Toujours un token (règle 1). Trait et remplissages ensemble. */
  color: string;
};

/** Un cran hors échelle n'a pas de bonhomme : l'appelant le teste avant. */
export function isFeelingLevel(value: number | null | undefined): value is FeelingLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function Figure({ level, width, color }: FigureProps) {
  return (
    <Svg
      width={width}
      height={width * RATIO}
      viewBox="0 0 48 64"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Le libellé du cran est toujours écrit ou lu à côté (« 4 · En forme ») :
      // le dessin le double, il ne le remplace pas. Hors de l'arbre de TalkBack.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {FIGURES[level].map((stroke, index) => {
        const fill = stroke.filled ? color : undefined;

        if ('d' in stroke) {
          return <Path key={index} d={stroke.d} strokeWidth={stroke.strokeWidth} fill={fill} />;
        }

        return <Circle key={index} cx={stroke.cx} cy={stroke.cy} r={stroke.r} fill={fill} />;
      })}
    </Svg>
  );
}
