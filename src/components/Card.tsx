/**
 * Carte — transposition de `.kd-card` (web).
 *
 * Surface haute, filet 1 point, rayon nul, **aucune ombre** : dans l'identité
 * Presse, ce qui se détache le fait par un contour, jamais par une élévation
 * simulée. En-tête optionnel, séparé du corps par un filet — c'est ce filet
 * qui fait la carte, pas un fond différent.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, space, text } from '@/theme';

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.border,
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
    borderBottomColor: colors.divider,
  },
  // `flexShrink` : sans lui, un titre long pousse l'action de droite hors de la
  // carte au lieu de passer à la ligne.
  title: { ...text.sectionTitle, color: colors.text, flexShrink: 1 },
});
