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

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, space, text } from '@/theme';

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

const TONES: Record<ChipTone, { label: string; bg: string; border: string }> = {
  neutral: { label: colors.textSecondary, bg: 'transparent', border: colors.borderPill },
  done: { label: colors.statusDone, bg: 'transparent', border: colors.borderPill },
  planned: { label: colors.statusPlanned, bg: 'transparent', border: colors.borderPill },
  missed: { label: colors.statusMissed, bg: 'transparent', border: colors.borderPill },
  accent: { label: colors.onPrimary, bg: colors.primary, border: colors.primary },
};

const RANKS: Record<ChipRank, string> = {
  1: colors.cat1,
  2: colors.cat2,
  3: colors.cat3,
  4: colors.cat4,
};

export function Chip({ label, tone = 'neutral', rank, dot = false, style, testID }: ChipProps) {
  const skin = TONES[tone];

  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        { backgroundColor: skin.bg, borderColor: skin.border },
        rank ? { borderLeftWidth: 3, borderLeftColor: RANKS[rank] } : null,
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: skin.label }]} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: skin.label }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
