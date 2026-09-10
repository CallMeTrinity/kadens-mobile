/**
 * Chip — transposition de `.kd-badge` (web).
 *
 * Mono capitales, contour, fond transparent. C'est une **marque de lecture**,
 * pas un contrôle : il ne se tape pas (le web n'en fait pas un bouton non
 * plus). Le jour où un filtre en aura besoin, ce sera un autre composant, avec
 * son plancher tactile — pas une prop `onPress` greffée ici.
 *
 * Deux façons de porter du sens, et elles ne se mélangent pas (règle 2) :
 *
 * - `tone` — un **statut** (fait, prévu, manqué) ou l'accent. Ce sont les seuls
 *   cas où la couleur parle ; `missed` est rouge parce que le rouge dit l'échec.
 * - `rank` — un **rang catégoriel** (activité, région, rôle de bloc), rendu par
 *   un filet gauche dans l'échelle de gris. Jamais une teinte inventée : c'est
 *   ce qui permet de coder cinq activités là où une palette n'en tenait que
 *   deux.
 */

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, space, text, themed, useStyles, variants } from '@/theme';

export type ChipTone = 'neutral' | 'done' | 'planned' | 'missed' | 'accent';
/** Rang dans l'échelle catégorielle, du plus sombre au plus clair. */
export type ChipRank = 1 | 2 | 3 | 4;

export type ChipProps = {
  label: string;
  tone?: ChipTone;
  rank?: ChipRank;
  /** Pastille de couleur devant le libellé (pendant de `.kd-badge__dot`). */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Une teinte de statut, et la couleur de son libellé — qui n'est pas toujours la
 * même (KL-39).
 *
 * `planned` est le cas qui a forcé la distinction : son gris de statut
 * (`--color-status-planned`) plafonne à 3,5:1 sur le papier, en dessous des
 * 4,5:1 que WCAG AA demande à un texte de 11 points. La pastille, elle, est un
 * objet graphique et se contente de 3:1 — elle garde donc la couleur du statut,
 * que le libellé abandonne pour l'encre secondaire. Le sens ne bouge pas : c'est
 * la pastille qui porte le statut, le mot le nomme.
 */
const SKINS = variants((c) => ({
  tones: {
    neutral: {
      label: c.textSecondary,
      dot: c.textSecondary,
      bg: 'transparent',
      border: c.borderPill,
    },
    done: {
      label: c.statusDone,
      dot: c.statusDone,
      bg: 'transparent',
      border: c.borderPill,
    },
    planned: {
      label: c.textSecondary,
      dot: c.statusPlanned,
      bg: 'transparent',
      border: c.borderPill,
    },
    missed: {
      label: c.primaryOnTint,
      dot: c.statusMissed,
      bg: 'transparent',
      border: c.borderPill,
    },
    accent: {
      label: c.onPrimary,
      dot: c.onPrimary,
      bg: c.primary,
      border: c.primary,
    },
  } as Record<ChipTone, { label: string; dot: string; bg: string; border: string }>,

  ranks: {
    1: c.cat1,
    2: c.cat2,
    3: c.cat3,
    4: c.cat4,
  } as Record<ChipRank, string>,
}));

export function Chip({ label, tone = 'neutral', rank, dot = false, style, testID }: ChipProps) {
  const { tones, ranks } = useStyles(SKINS);
  const styles = useStyles(sheets);
  const skin = tones[tone];

  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        { backgroundColor: skin.bg, borderColor: skin.border },
        rank ? { borderLeftWidth: 3, borderLeftColor: ranks[rank] } : null,
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: skin.dot }]} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: skin.label }]}>
        {label}
      </Text>
    </View>
  );
}

const sheets = themed((c) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: layout.hairline,
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    alignSelf: 'flex-start',
  },
  // Le seul rayon non nul de l'app, et il n'en est pas un : une pastille de
  // 6 points est un disque, pas un coin arrondi.
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...text.eyebrow },
}));
