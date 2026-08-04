/**
 * En-tête d'écran — pendant natif de `.kd-header`.
 *
 * Il **porte lui-même la zone sûre du haut** : c'est ce qui lui permet de
 * peindre sous la barre de statut sans qu'un écran ait à choisir entre un
 * `SafeAreaView` (qui laisserait une bande de fond papier) et un double
 * rembourrage. Un écran l'emploie donc à la racine, hors `SafeAreaView`.
 *
 * ## La règle des zones sûres, l'autre bout compris (KL-37)
 *
 * Android dessine **de bord à bord** depuis le SDK 54 : rien n'est réservé, ni
 * en haut ni en bas. Le haut est donc réglé une fois pour toutes, ici. Le bas
 * reste à la charge de l'écran, parce qu'il n'y a pas un seul cas mais deux, et
 * qu'ils ne se rendent pas pareil :
 *
 * - **Une barre peinte au bas de l'écran** (barre d'onglets, barre d'action,
 *   barre de repos) prend l'inset en **rembourrage** : elle peint sous la barre
 *   gestuelle, ses cibles remontent au-dessus. Une marge laisserait un liseré de
 *   fond papier sous une barre qui n'est plus un bord.
 * - **Une page qui défile** l'ajoute à son `paddingBottom` de contenu : le
 *   dernier élément s'arrête au-dessus du trait du système.
 *
 * Ne jamais cumuler les deux : un écran dont la barre porte déjà l'inset ne le
 * réserve pas une seconde fois dans sa page.
 *
 * ## Casse
 *
 * Le titre est un **libellé d'écran** : condensé capitales. Un nom saisi — nom
 * de séance, d'exercice — ne passe pas par là (règle 4) ; il se rend dans le
 * corps de l'écran, au rôle `name`, ou en `eyebrow` s'il sert de contexte.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, space, text } from '@/theme';
import { Icon } from './Icon';

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
          {/* La flèche est arrivée avec le jeu de glyphes de KL-37. Elle
              **accompagne** le mot, elle ne le remplace pas : un chevron seul
              serait une cible muette, et le libellé accessible du bouton est de
              toute façon posé sur le `Pressable`. */}
          <Icon name="arrow-left" size={17} color={colors.textSecondary} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
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
