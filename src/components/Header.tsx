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
 * Le titre est par défaut un **libellé d'écran** : condensé capitales. Un nom
 * saisi ne s'y écrase pas (règle 4) — il se rend au rôle `pageName`, et l'écran
 * le **déclare** avec `titleRole="name"` plutôt que de composer son propre
 * titre à côté. C'est ce que fait la séance en cours, dont le titre est le nom
 * de la séance : « Séance » ne disait rien qu'on ne sache déjà en l'ouvrant.
 */

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space, text, themed, useStyles, useColors } from '@/theme';
import { Icon } from './Icon';

export type HeaderProps = {
  title: string;
  /** Sur-titre en mono capitales : la date, le plan, le contexte. */
  eyebrow?: string;
  /**
   * Ce que le titre **est**, pas la taille qu'il fait : un libellé que l'app
   * écrit (défaut, condensé capitales) ou un nom qu'on a saisi (Barlow, casse
   * normale). C'est la règle 4 rendue explicite plutôt que contournée — passer
   * « Lower w/ renfo » en `label` en ferait « LOWER W/ RENFO ».
   */
  titleRole?: 'label' | 'name';
  /**
   * Rythme vertical resserré, et les actions de droite remontent sur la ligne
   * du retour au lieu de flanquer le titre.
   *
   * C'est l'en-tête de la séance en cours : la hauteur y est la ressource rare
   * — ce que la tête prend, elle le prend à la série qu'on est en train de
   * faire, téléphone posé au sol. Le bouton de retour garde sa cible de 44 :
   * resserrer un rythme n'est pas rétrécir une cible.
   */
  compact?: boolean;
  /** Rendu comme un retour arrière. Absent = écran de premier niveau. */
  onBack?: () => void;
  /** Actions à droite du titre — ou de la ligne de retour, en `compact`. */
  right?: ReactNode;
  testID?: string;
};

export function Header({
  title,
  eyebrow,
  titleRole = 'label',
  compact = false,
  onBack,
  right,
  testID,
}: HeaderProps) {
  const styles = useStyles(sheets);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const back = onBack ? (
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
  ) : null;

  const actions = right ? <View style={styles.right}>{right}</View> : null;

  return (
    <View
      style={[
        styles.header,
        compact && styles.headerCompact,
        { paddingTop: insets.top + (compact ? space[2] : space[5]) },
      ]}
      testID={testID}
    >
      {/* En `compact`, les actions occupent le vide à droite du retour — cette
          ligne fait déjà 44 de haut pour la cible, autant qu'elle porte les
          pastilles plutôt qu'une seconde ligne les porte plus bas. */}
      {compact ? (
        <View style={styles.topRow}>
          {back ?? <View />}
          {actions}
        </View>
      ) : (
        back
      )}

      <View style={styles.titles}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[styles.title, titleRole === 'name' ? styles.titleName : styles.titleLabel]}
          >
            {title}
          </Text>
          {compact ? null : actions}
        </View>
      </View>
    </View>
  );
}

const sheets = themed((c) => ({
  header: {
    backgroundColor: c.surfaceRaised,
    paddingBottom: space[6],
    paddingHorizontal: space[8],
    borderBottomWidth: layout.hairline,
    borderBottomColor: c.border,
    gap: space[2],
  },
  headerCompact: { paddingBottom: space[4], gap: space[1] },
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
  backLabel: { ...text.action, color: c.textSecondary },
  titles: { gap: space[1] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space[4],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
  },
  eyebrow: { ...text.eyebrow, color: c.textSecondary },
  title: { color: c.text, flexShrink: 1 },
  // Deux styles entiers plutôt qu'un style de base surchargé : `pageTitle`
  // porte `textTransform` et un interlettrage que le rôle « nom » n'a pas, et
  // qu'une fusion laisserait derrière lui.
  titleLabel: text.pageTitle,
  titleName: text.pageName,
  right: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
}));
