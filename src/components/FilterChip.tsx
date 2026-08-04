/**
 * FilterChip — la pilule de facette (KL-34).
 *
 * C'est le « autre composant, avec son plancher tactile » que `Chip` annonçait :
 * un `Chip` est une **marque de lecture** et ne se tape pas, une facette est un
 * contrôle. Greffer un `onPress` sur `Chip` aurait donné un composant qui est
 * parfois un bouton et parfois non — donc parfois au plancher tactile, et
 * parfois non.
 *
 * ## L'état retenu s'inverse à l'encre, il ne rougit pas
 *
 * Le web colore sa pilule active au `--color-primary-tint` (`.kd-libfilter--on`).
 * On ne le transpose pas : ici la sélection se code comme celle de la bande de
 * jours de « Aujourd'hui » — fond encre, libellé sur encre. La règle 2 du design
 * system réserve le rouge à l'action primaire, à l'intensité et à l'échec, et
 * une facette retenue n'est aucun des trois ; l'inversion se lit d'un coup d'œil
 * sans introduire de teinte, ce que l'app a déjà tranché en KL-28.
 *
 * `accessibilityRole` vaut `tab` et non `button` : ces pilules forment un
 * ensemble dont **une seule** est retenue à la fois, et c'est exactement ce que
 * TalkBack annonce d'un onglet. Un bouton laisserait croire qu'on peut les
 * cumuler.
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, layout, space, text } from '@/theme';

export type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  testID?: string;
};

export function FilterChip({
  label,
  selected,
  onPress,
  accessibilityHint,
  testID,
}: FilterChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !selected && styles.chipPressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    justifyContent: 'center',
    // Le plancher tactile, qui est toute la raison d'être de ce composant.
    minHeight: layout.touchTarget,
    paddingHorizontal: space[5],
    borderWidth: layout.hairline,
    borderColor: colors.borderPill,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.text, backgroundColor: colors.surfaceInk },
  chipPressed: { backgroundColor: colors.fill },
  label: { ...text.eyebrow, color: colors.textSecondary },
  labelSelected: { color: colors.onInk },
});
