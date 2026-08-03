/**
 * En-tête d'écran — pendant natif de `.kd-header`.
 *
 * Il **porte lui-même la zone sûre du haut** : c'est ce qui lui permet de
 * peindre sous la barre de statut sans qu'un écran ait à choisir entre un
 * `SafeAreaView` (qui laisserait une bande de fond papier) et un double
 * rembourrage. Un écran l'emploie donc à la racine, hors `SafeAreaView`.
 *
 * Le titre est un **libellé d'écran** : condensé capitales. Un nom saisi — nom
 * de séance, d'exercice — ne passe pas par là (règle 4) ; il se rend dans le
 * corps de l'écran, au rôle `name`, ou en `eyebrow` s'il sert de contexte.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, space, text } from '@/theme';

export type HeaderProps = {
  title: string;
  /** Sur-titre en mono capitales : la date, le plan, le contexte. */
  eyebrow?: string;
  /** Rendu comme un retour arrière. Absent = écran de premier niveau. */
  onBack?: () => void;
  /** Actions à droite du titre. */
  right?: ReactNode;
  testID?: string;
};

export function Header({ title, eyebrow, onBack, right, testID }: HeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + space[5] }]} testID={testID}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          {/* Pas d'icône : le projet n'embarque pas encore de jeu de glyphes, et
              en poser un ici obligerait à trancher cette question pour un bouton
              de retour. Le mot est lisible et se lit à voix haute tel quel. */}
          <Text style={styles.backLabel}>Retour</Text>
        </Pressable>
      ) : null}

      <View style={styles.titles}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surfaceRaised,
    paddingBottom: space[6],
    paddingHorizontal: space[8],
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
    gap: space[2],
  },
  back: {
    justifyContent: 'center',
    minHeight: layout.touchTarget,
    // `flex-start` : sans lui, la cible s'étend sur toute la largeur de
    // l'en-tête et un tap n'importe où ferait revenir en arrière.
    alignSelf: 'flex-start',
    paddingRight: space[3],
  },
  backPressed: { opacity: 0.6 },
  backLabel: { ...text.action, color: colors.textSecondary },
  titles: { gap: space[1] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space[4],
  },
  eyebrow: { ...text.eyebrow, color: colors.textFaint },
  title: { ...text.pageTitle, color: colors.text, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
