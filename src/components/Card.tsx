/**
 * Carte — transposition de `.kd-card` (web).
 *
 * Surface haute, filet 1 point, rayon nul, **aucune ombre** : dans l'identité
 * Presse, ce qui se détache le fait par un contour, jamais par une élévation
 * simulée. En-tête optionnel, séparé du corps par un filet — c'est ce filet
 * qui fait la carte, pas un fond différent.
 */

import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, space, text, themed, useStyles } from '@/theme';

export type CardProps = {
  /** Titre de section : libellé de l'app, donc condensé capitales (règle 4). */
  title?: string;
  /** Action ou marque posée à droite du titre (bouton, chip). */
  right?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Card({ title, right, children, style, testID }: CardProps) {
  const styles = useStyles(sheets);
  return (
    <View style={[styles.card, style]} testID={testID}>
      {title || right ? (
        <View style={styles.head}>
          {title ? (
            // `accessibilityRole="header"` donne à la carte un point d'entrée
            // dans la navigation par titres de TalkBack.
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          ) : (
            <View />
          )}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const sheets = themed((c) => ({
  card: {
    backgroundColor: c.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: c.border,
    paddingVertical: space[9],
    paddingHorizontal: space[10],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    paddingBottom: space[6],
    marginBottom: space[6],
    borderBottomWidth: layout.hairline,
    borderBottomColor: c.divider,
  },
  // `flexShrink` : sans lui, un titre long pousse l'action de droite hors de la
  // carte au lieu de passer à la ligne.
  title: { ...text.sectionTitle, color: c.text, flexShrink: 1 },
}));
