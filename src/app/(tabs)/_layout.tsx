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
 * qu'est-ce que j'ai fait, qu'est-ce que je fais maintenant, comment est réglé
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
import { Linking, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, OfflineBanner, UpdateBanner, type IconName } from '@/components';
import { useAppVersion, useOfflineNotice } from '@/sync';
import { layout, space, text, themed, useStyles, useColors } from '@/theme';

export default function TabsLayout() {
  const styles = useStyles(sheets);
  const insets = useSafeAreaInsets();
  const notice = useOfflineNotice();
  const version = useAppVersion();
  // L'URL à ouvrir, ou rien à proposer. Une seule expression, pour que la
  // condition d'affichage et ce que le bandeau ouvre ne puissent pas diverger.
  const updateUrl = version.status === 'update' && !notice.offline ? version.installUrl : null;

  return (
    <Tabs>
      <TabSlot />
      {/*
        Le bandeau hors ligne (KL-38), **une fois pour les trois destinations**
        plutôt que trois fois dans trois écrans. Il est ici et pas dans la séance
        en cours, qui est un écran de pile : hors réseau y est l'état nominal, et
        la place sous le pouce y appartient à « valider cette série ».

        Juste au-dessus de la barre, pas sous l'en-tête : en haut il aurait
        décalé le titre de chaque écran à chaque bascule de réseau, et l'en-tête
        porte déjà la zone sûre. Ici il pousse la barre de quelques points, ce que
        rien ne recouvre.
      */}
      {notice.offline ? (
        <OfflineBanner disconnected={notice.disconnected} pending={notice.pending} />
      ) : null}
      {/*
        Le bandeau de mise à jour (KL-43), au même endroit et **jamais en même
        temps** que le précédent : hors réseau, la page d'installation ne
        s'ouvrira pas, et proposer ce qui ne peut pas aboutir n'aide personne.
        L'état hors ligne passe donc devant — il dure des heures, la mise à jour
        peut attendre le retour du réseau.
      */}
      {updateUrl !== null ? (
        <UpdateBanner
          versionName={version.latestVersionName}
          onPress={() => void Linking.openURL(updateUrl)}
        />
      ) : null}
      {/*
        La zone sûre du bas est prise en **rembourrage**, pas en marge : la barre
        peint donc sous la barre gestuelle Android au lieu de laisser un liseré
        de fond dessous, et ses cibles remontent au-dessus d'elle. Même calcul
        que `--kd-navbar-h` côté web, qui compte l'`env(safe-area-inset-bottom)`
        dans la place occupée plutôt que de l'ignorer.
      */}
      {/* L'ordre est **chronologique**, pas hiérarchique : ce qui a été fait à
          gauche, ce qui se fait maintenant au centre, le réglage de l'appareil à
          droite. Le centre est la position la plus sûre au pouce d'une barre de
          trois, et c'est la destination par défaut de l'app — mettre « Aujourd'hui »
          en tête l'aurait posée là où le pouce dérape. */}
      <TabList style={[styles.bar, { paddingBottom: insets.bottom }]}>
        <TabTrigger name="history" href="/history" asChild>
          <Tab icon="history" label="Historique" />
        </TabTrigger>
        <TabTrigger name="today" href="/" asChild>
          <Tab icon="calendar-days" label="Aujourd’hui" />
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
  const styles = useStyles(sheets);
  const colors = useColors();
  const tint = isFocused ? colors.text : colors.textSecondary;

  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      // Explicite plutôt que composé à partir des enfants : l'apostrophe
      // typographique d'« Aujourd'hui » se lit, l'icône est déjà masquée, et une
      // entrée de navigation ne doit pas dépendre de ce qu'elle contient.
      accessibilityLabel={label}
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

const sheets = themed((c) => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: c.surfaceRaised,
    // Un filet d'**encre**, pas de bordure : c'est ce qui pose la barre comme un
    // bord de page dans l'identité Presse, exactement comme `.kd-nav` sous 560px.
    borderTopWidth: layout.hairline,
    borderTopColor: c.text,
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
  tabActive: { borderTopColor: c.text },
  tabPressed: { backgroundColor: c.fill },
  label: text.tabLabel,
}));
