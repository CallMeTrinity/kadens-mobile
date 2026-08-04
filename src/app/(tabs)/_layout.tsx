/**
 * La barre de navigation basse (KL-37).
 *
 * ## Pourquoi trois entrées, et pas les trois du web
 *
 * Le web navigue en **Séances / Plans / Calendrier** : c'est le fil de la
 * planification, et sous 560px sa barre haute devient exactement cette barre-ci
 * (`components.css`, palier 560). Aucune de ces trois destinations n'existe ici,
 * et pour cause : le téléphone ne compose pas, il déroule. Ce qui se transpose
 * est donc la **forme** — trois cibles au pouce, filet d'encre, liséré haut sur
 * l'actif — appliquée aux trois questions que cette app-ci sait traiter :
 * qu'est-ce que je fais maintenant, qu'est-ce que j'ai fait, comment est réglé
 * cet appareil.
 *
 * ## Ce qui n'est pas dans la barre, et pourquoi
 *
 * La séance en cours. Elle vit **au-dessus** de la barre, empilée par le `Stack`
 * racine : une séance se déroule en plein écran, et une barre d'onglets sous le
 * pouce y disputerait la place à la seule cible qui compte, valider une série.
 * En sortir, c'est revenir — pas changer d'onglet.
 *
 * ## Pourquoi `expo-router/ui` et pas `<Tabs>`
 *
 * Le `<Tabs>` classique étend le navigateur de React Navigation, dont la barre
 * se **configure** (teintes actives, libellés, badges) mais ne se dessine pas.
 * L'identité Presse n'est pas une configuration : rayon nul, aucune ombre, un
 * liséré d'encre plutôt qu'une teinte d'accent. Les composants sans style
 * d'`expo-router/ui` rendent la barre telle qu'on la dessine, et c'est la voie
 * documentée pour ça.
 */

import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components';
import { colors, layout, space, text } from '@/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs>
      <TabSlot />
      {/*
        La zone sûre du bas est prise en **rembourrage**, pas en marge : la barre
        peint donc sous la barre gestuelle Android au lieu de laisser un liseré
        de fond dessous, et ses cibles remontent au-dessus d'elle. Même calcul
        que `--kd-navbar-h` côté web, qui compte l'`env(safe-area-inset-bottom)`
        dans la place occupée plutôt que de l'ignorer.
      */}
      <TabList style={[styles.bar, { paddingBottom: insets.bottom }]}>
        <TabTrigger name="today" href="/" asChild>
          <Tab icon="calendar-days" label="Aujourd’hui" />
        </TabTrigger>
        <TabTrigger name="history" href="/history" asChild>
          <Tab icon="history" label="Historique" />
        </TabTrigger>
        <TabTrigger name="settings" href="/settings" asChild>
          <Tab icon="settings-2" label="Réglages" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

/**
 * Une entrée de la barre.
 *
 * `TabTrigger asChild` lui passe l'appui et `isFocused` : d'où les props étalées
 * **en premier**, pour ne rien écraser de ce qui la rend navigable. Le rôle et
 * l'état sélectionné, eux, sont posés ici et par-dessus — un `Pressable` nu
 * s'annonce « bouton » à TalkBack, ce qui ne dit ni qu'il y a trois onglets ni
 * lequel est ouvert.
 */
function Tab({
  icon,
  label,
  isFocused,
  ...rest
}: ComponentProps<typeof Pressable> & {
  icon: IconName;
  label: string;
  isFocused?: boolean;
}) {
  const tint = isFocused ? colors.text : colors.textFaint;

  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [
        styles.tab,
        isFocused && styles.tabActive,
        pressed && !isFocused && styles.tabPressed,
      ]}
    >
      <Icon name={icon} size={19} color={tint} />
      <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    // Un filet d'**encre**, pas de bordure : c'est ce qui pose la barre comme un
    // bord de page dans l'identité Presse, exactement comme `.kd-nav` sous 560px.
    borderTopWidth: layout.hairline,
    borderTopColor: colors.text,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: layout.touchTarget + space[3],
    paddingVertical: space[3],
    // Le liséré de l'onglet actif est **toujours réservé**, en transparent :
    // sans ça, l'activer ajouterait 3 points de hauteur et ferait sauter les
    // trois libellés d'un pixel à chaque changement d'onglet.
    borderTopWidth: 3,
    borderTopColor: 'transparent',
  },
  tabActive: { borderTopColor: colors.text },
  tabPressed: { backgroundColor: colors.fill },
  label: text.tabLabel,
});
