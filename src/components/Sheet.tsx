/**
 * Feuille — transposition de `kd-libsheet` (web, sous 900px).
 *
 * Un calque qui monte du bas, sur un voile. C'est la forme que prend au doigt
 * ce qui est un volet latéral sur grand écran : choisir un exercice, régler un
 * repos, confirmer une clôture.
 *
 * Ce qui n'est pas décoratif ici :
 *
 * - **Le contour encre.** Aucune ombre dans l'identité Presse : ce qui flotte
 *   se détache par un filet, comme les menus et les modales du web.
 * - **La hauteur bornée à 78 %.** Une feuille qui remplit l'écran cesse d'être
 *   un calque et devient une page — on ne sait plus qu'il y a un dessous.
 * - **Le contenu défile, la feuille non.** Le `flex: 1` + `minHeight: 0` du web
 *   se transpose en `flexShrink` sur le corps : sans lui, un contenu long
 *   pousse l'en-tête hors de l'écran au lieu de défiler sous lui.
 * - **Le dégagement bas suit la barre gestuelle** (`insets.bottom`), sinon le
 *   dernier élément de la liste se retrouve sous elle.
 *
 * ## Le clavier ne recouvre jamais la feuille (KL-39)
 *
 * Une feuille est ancrée en bas, un clavier s'ouvre en bas : sans rien, on
 * remplit un champ qu'on ne voit pas. La feuille entière remonte donc du
 * recouvrement mesuré (`useKeyboardOverlap`), et la zone sûre du bas cesse de
 * s'ajouter tant qu'il est là — le clavier couvre déjà la barre gestuelle,
 * compter les deux creuserait un vide sous le bouton de validation.
 *
 * Deux réglages du corps défilant vont avec, et ils valent surtout pour le
 * sélecteur d'exercice, dont le champ prend le focus à l'ouverture :
 * `keyboardShouldPersistTaps` (sans lui, le premier appui sur un résultat ne
 * fait que fermer le clavier — deux appuis pour un choix, en salle) et
 * `keyboardDismissMode` (faire défiler la liste range le clavier).
 */

import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, space, text, useReducedMotion } from '@/theme';

import { useKeyboardOverlap } from './keyboard';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Titre de la feuille. Écrit par l'app : condensé capitales (règle 4). */
  title?: string;
  children?: ReactNode;
  /** Barre d'actions posée sous le contenu, hors de la zone défilante. */
  footer?: ReactNode;
  testID?: string;
};

export function Sheet({ visible, onClose, title, children, footer, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap();
  const reducedMotion = useReducedMotion();
  // Le clavier recouvre déjà la barre gestuelle : ne compter que l'un des deux.
  const safeBottom = keyboard.overlap > 0 ? 0 : insets.bottom;

  return (
    <Modal
      visible={visible}
      transparent
      // Le réglage système « supprimer les animations » vaut ici comme
      // `prefers-reduced-motion` sur le web : la feuille apparaît au lieu de
      // monter (KL-39).
      animationType={reducedMotion ? 'none' : 'slide'}
      // Le bouton retour d'Android ferme la feuille : c'est le geste attendu, et
      // sans lui il quitterait l'écran qui l'a ouverte.
      onRequestClose={onClose}
      statusBarTranslucent
      testID={testID}
    >
      <View onLayout={keyboard.onLayout} style={[styles.host, { paddingBottom: keyboard.overlap }]}>
        {/* Le voile est une cible de fermeture, pas un décor : taper à côté
            referme, comme le clic extérieur du web. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          style={styles.scrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.head}>
            {title ? (
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            >
              <Text style={styles.closeLabel}>Fermer</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={[
              styles.bodyContent,
              { paddingBottom: space[8] + (footer ? 0 : safeBottom) },
            ]}
            // Arrivé en bout de liste, le geste ne repart pas sur l'écran
            // derrière (pendant de l'`overscroll-behavior: contain` du web).
            overScrollMode="never"
            // Un appui sur un résultat le choisit du premier coup, clavier
            // ouvert : sans ça, le premier appui ne fait que le refermer.
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {children}
          </ScrollView>

          {footer ? (
            <View style={[styles.footer, { paddingBottom: space[8] + safeBottom }]}>{footer}</View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: layout.sheetMaxHeight,
    backgroundColor: colors.surface,
    // Le bas est hors écran : un filet y ferait une ligne flottante au ras de
    // la barre gestuelle.
    borderTopWidth: layout.hairline,
    borderLeftWidth: layout.hairline,
    borderRightWidth: layout.hairline,
    borderColor: colors.text,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    paddingVertical: space[5],
    paddingHorizontal: space[8],
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },
  title: { ...text.sectionTitle, color: colors.text, flexShrink: 1 },
  close: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: layout.touchTarget,
    minWidth: layout.touchTarget,
    paddingHorizontal: space[3],
  },
  closePressed: { backgroundColor: colors.fill },
  closeLabel: { ...text.action, color: colors.textSecondary },
  // `flexShrink` et pas `flex: 1` : une feuille courte reste courte, elle ne
  // s'étire pas jusqu'aux 78 %.
  body: { flexShrink: 1 },
  bodyContent: { padding: space[8], gap: space[6] },
  footer: {
    paddingTop: space[6],
    paddingHorizontal: space[8],
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
    gap: space[4],
  },
});
