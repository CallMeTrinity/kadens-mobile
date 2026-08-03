/**
 * État vide — transposition de `.kd-empty` (web).
 *
 * Centré, sobre, à l'encre faible. Un état vide n'est pas une erreur : il ne
 * sort donc **jamais** le rouge (règle 2), au même titre qu'une page 404 côté
 * web. Il dit ce qui manque et, si quelque chose peut être fait, propose une
 * action — une seule.
 */

import { StyleSheet, View, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, space, text } from '@/theme';
import { Button, type ButtonProps } from './Button';

export type EmptyStateProps = {
  /** Ce qui manque, en une phrase. */
  title: string;
  /** Pourquoi, ou quoi faire. Facultatif : un état vide évident se passe de glose. */
  hint?: string;
  /** Action unique. Au-delà d'une, ce n'est plus un état vide mais un écran. */
  action?: Pick<ButtonProps, 'label' | 'onPress' | 'variant'>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function EmptyState({ title, hint, action, style, testID }: EmptyStateProps) {
  return (
    <View style={[styles.empty, style]} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? <Button variant="secondary" {...action} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[12],
    paddingHorizontal: space[8],
  },
  title: { ...text.sectionTitle, color: colors.textSoft, textAlign: 'center' },
  hint: { ...text.caption, color: colors.textFaint, textAlign: 'center' },
  action: { marginTop: space[3] },
});
