import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { BodySilhouette, TargetArea } from '@/db';
import { colors, space } from '@/theme';

import {
  BODY_PLATES,
  type BodyPlate,
  type BodySide,
  type InertSlug,
  type MuscleSlug,
} from './bodyPaths';

/**
 * La carte des muscles chargés par une séance.
 *
 * **Un dessin, et rien d'autre.** Il reçoit des paliers déjà calculés
 * (`@/session/areas.ts` les tire du réalisé) et ne sait ni compter des séries ni
 * nommer une zone : la légende chiffrée qui l'accompagne appartient à l'écran,
 * qui a le vocabulaire. C'est la même frontière que `units.ts` — décider de ce
 * qui est fait est du domaine, le peindre est du rendu.
 *
 * ## Face et dos ensemble, jamais un onglet
 *
 * Un dos derrière un onglet est un dos qu'on ne regarde pas, et une séance de
 * tirage paraîtrait n'avoir rien travaillé. Les deux planches tiennent côte à
 * côte à hauteur constante, l'écran de clôture se lit d'un coup d'œil, et il n'y
 * a rien à toucher.
 *
 * ## Le rouge est légitime ici, et il ne porte rien tout seul
 *
 * L'intensité est l'un des trois sens autorisés du rouge (identité Presse), donc
 * pas de teinte inventée : trois paliers pris dans les tokens, du plus clair au
 * plus sombre. Mais trois nuances de rouge ne se départagent pas d'un regard, et
 * un daltonien n'y verra pas trois valeurs — **toute information de cette carte
 * est reprise en toutes lettres dans la légende**. C'est ce qui autorise le
 * palier bas à rester pâle, et c'est aussi pourquoi le dessin est marqué
 * décoratif pour le lecteur d'écran : le lui faire lire deux fois n'aiderait
 * personne.
 *
 * ## Une personne, pas une planche d'anatomie
 *
 * Cheveux, tête, cou, mains et pieds sont dessinés (`BodyPlate.inert`) et ne
 * porteront jamais de teinte. Ils ne sont pas décoratifs pour autant : la
 * chevelure est ce qui **distingue les deux silhouettes** d'un coup d'œil, donc
 * ce qui rend le réglage lisible. Ils sont **hors de l'échelle** et le disent :
 * l'encre pour les cheveux, le fond du papier pour le reste, jamais le gris des
 * muscles au repos — un crâne de la même couleur qu'un pectoral inactif se
 * lirait comme une zone qu'on aurait oublié de travailler.
 *
 * Le visage n'existe pas : la source dessine un ovale, pas des yeux. Rien n'est
 * inventé ici, un trait de plus ne viendrait d'aucune référence anatomique.
 */

/** Le palier de teinte d'une zone. 1 = touchée, 3 = le plus chargé de la séance. */
export type BodyLevel = 1 | 2 | 3;

export interface BodyMapProps {
  /** Les zones chargées et leur palier. Une zone absente est simplement au repos. */
  levels: ReadonlyMap<TargetArea, BodyLevel>;
  silhouette: BodySilhouette;
  /** Hauteur d'une planche, en points. La largeur suit le `viewBox`. */
  height?: number;
}

/**
 * La correspondance entre les zones de Kadens et les muscles du jeu de tracés.
 *
 * **Décision produit, donc ici et pas dans le fichier généré.** Elle est
 * bijective sur les seize zones anatomiques : chaque `TargetArea` a exactement un
 * muscle en face, et aucun muscle n'en reçoit deux. `full_body` n'y est pas —
 * elle ne se peint jamais, cf. `areas.ts`.
 *
 * Exportée pour son test de cohérence : TypeScript garantit que les seize zones
 * sont là, pas que les seize `slug` existent encore dans les tracés. Une
 * régénération qui renommerait un muscle laisserait une zone éternellement grise,
 * en silence.
 */
export const AREA_TO_SLUG: Record<Exclude<TargetArea, 'full_body'>, MuscleSlug> = {
  chest: 'chest',
  back: 'upper-back',
  lower_back: 'lower-back',
  traps: 'trapezius',
  shoulders: 'deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  abs: 'abs',
  obliques: 'obliques',
  glutes: 'gluteal',
  quadriceps: 'quadriceps',
  hamstrings: 'hamstring',
  adductors: 'adductors',
  calves: 'calves',
  shins: 'tibialis',
};

/** Les deux planches, dans l'ordre de lecture. */
const SIDES: readonly BodySide[] = ['front', 'back'];

/** Le remplissage d'un muscle, par palier. Du plus clair au plus sombre. */
const FILLS: Record<BodyLevel, string> = {
  1: colors.bodymapLight,
  2: colors.bodymapMedium,
  3: colors.bodymapDark,
};

/** Le remplissage d'un muscle. Sans palier, il est au repos : gris de fond. */
function fillOf(level: BodyLevel | undefined): string {
  return level === undefined ? colors.fill : FILLS[level];
}

/**
 * Le remplissage d'une forme inerte.
 *
 * Les cheveux à l'encre, le reste au fond du papier. Deux valeurs qui ne sont ni
 * l'une ni l'autre le gris des muscles au repos : ce qui n'est pas une zone ne
 * doit pas pouvoir se lire comme une zone vide.
 */
function inertFillOf(slug: InertSlug): string {
  return slug === 'hair' ? colors.textSecondary : colors.surfaceRaised;
}

/**
 * La teinte d'un palier, pour la légende qui accompagne la carte.
 *
 * Exposée plutôt que recopiée : une légende dont les pastilles ne seraient pas
 * exactement les teintes du dessin ne serait pas une légende.
 */
export function bodyLevelColor(level: BodyLevel): string {
  return FILLS[level];
}

export function BodyMap({ levels, silhouette, height = 240 }: BodyMapProps) {
  // Par muscle et non par zone : c'est l'index dont le dessin a besoin, et le
  // refaire pour chacune des vingt-deux formes des deux planches serait vingt-deux
  // parcours de la table pour la même réponse.
  const byMuscle = useMemo(() => {
    const map = new Map<MuscleSlug, BodyLevel>();

    for (const [area, level] of levels) {
      if (area !== 'full_body') {
        map.set(AREA_TO_SLUG[area], level);
      }
    }

    return map;
  }, [levels]);

  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {SIDES.map((side) => (
        <Plate
          key={side}
          plate={BODY_PLATES[`${silhouette}-${side}`]}
          levels={byMuscle}
          height={height}
        />
      ))}
    </View>
  );
}

/** Un corps, vu d'un côté. */
function Plate({
  plate,
  levels,
  height,
}: {
  plate: BodyPlate;
  levels: ReadonlyMap<MuscleSlug, BodyLevel>;
  height: number;
}) {
  // La hauteur est imposée et la largeur suit, jamais l'inverse : les quatre
  // planches n'ont pas le même `viewBox` (le corps féminin de face est plus haut),
  // et deux silhouettes côte à côte doivent s'aligner sur les épaules.
  const [, , boxWidth, boxHeight] = plate.viewBox.split(' ').map(Number);

  return (
    <Svg viewBox={plate.viewBox} height={height} width={(height * boxWidth) / boxHeight}>
      {/* Avant les muscles, et c'est la seule chose à savoir de cet ordre : le
          cou passe SOUS les trapèzes, comme il le doit. Les cheveux, eux, sont
          derniers de leur propre liste et ne rencontrent aucun muscle. */}
      {plate.inert.map((shape) =>
        shape.paths.map((d, index) => (
          <Path
            key={`${shape.slug}-${index}`}
            d={d}
            fill={inertFillOf(shape.slug)}
            stroke={shape.slug === 'hair' ? 'none' : colors.borderStrong}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {plate.muscles.map((muscle) =>
        muscle.paths.map((d, index) => (
          <Path
            key={`${muscle.slug}-${index}`}
            d={d}
            fill={fillOf(levels.get(muscle.slug))}
            stroke={colors.borderStrong}
            strokeWidth={0.75}
            // Sans ça, l'épaisseur suivrait l'échelle : le `viewBox` fait 1448
            // points de haut pour 240 à l'écran, un trait de 1 se rendrait à 0,17.
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      <Path
        d={plate.outline}
        fill="none"
        stroke={colors.textSoft}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[8],
  },
});
