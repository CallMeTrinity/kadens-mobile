/**
 * État vide — transposition de `.kd-empty` (web).
 *
 * Centré, sobre, à l'encre faible. Un état vide n'est pas une erreur : il ne
 * sort donc **jamais** le rouge (règle 2), au même titre qu'une page 404 côté
 * web. Il dit ce qui manque et, si quelque chose peut être fait, propose une
 * action — une seule.
 *
 * ## Deux tailles, un seul dessin (KL-38)
 *
 * Le ticket demande un état vide **par liste**, et toutes les listes ne tiennent
 * pas une page : une section de feuille, une carte, un bloc au milieu d'un écran
 * qui défile. `compact` ne change que les dégagements — même hiérarchie, même
 * encre, même règle d'action. Écrire un second composant pour ça aurait fait
 * diverger les deux au premier ajustement.
 */

import { View, Text, type StyleProp, type ViewStyle } from 'react-native';

import { space, text, themed, useStyles } from '@/theme';
import { Button, type ButtonProps } from './Button';

export type EmptyStateProps = {
  /** Ce qui manque, en une phrase. */
  title: string;
  /** Pourquoi, ou quoi faire. Facultatif : un état vide évident se passe de glose. */
  hint?: string;
  /** Action unique. Au-delà d'une, ce n'est plus un état vide mais un écran. */
  action?: Pick<ButtonProps, 'label' | 'onPress' | 'variant'>;
  /** Pour une liste qui n'occupe pas la page : section, feuille, carte. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function EmptyState({
  title,
  hint,
  action,
  compact = false,
  style,
  testID,
}: EmptyStateProps) {
  const styles = useStyles(sheets);
  return (
    <View style={[styles.empty, compact && styles.compact, style]} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? <Button variant="secondary" {...action} style={styles.action} /> : null}
    </View>
  );
}

const sheets = themed((c) => ({
  empty: {
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[12],
    paddingHorizontal: space[8],
  },
  compact: { paddingVertical: space[6], paddingHorizontal: 0 },
  title: { ...text.sectionTitle, color: c.textSoft, textAlign: 'center' },
  hint: { ...text.caption, color: c.textSecondary, textAlign: 'center' },
  action: { marginTop: space[3] },
}));
