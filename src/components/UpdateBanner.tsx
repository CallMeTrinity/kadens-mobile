/**
 * Le bandeau de mise à jour (KL-43).
 *
 * ## Il propose, il n'interrompt pas
 *
 * Une version plus récente existe : c'est une information, pas un incident. Elle
 * s'affiche donc comme le bandeau hors ligne — une bande d'une ligne au-dessus
 * de la barre d'onglets, à l'encre, jamais en rouge (règle 2 : le rouge est
 * l'action primaire, l'intensité, l'échec, et une mise à jour n'est aucun des
 * trois). Elle **pousse** le contenu au lieu de le recouvrir, et rien ne passe
 * dessous.
 *
 * ## Sauf qu'il a une cible, lui
 *
 * C'est la seule différence avec `OfflineBanner`, et elle est voulue : hors
 * réseau il n'y a rien à faire, ici il y a une page à ouvrir. La bande entière
 * est donc tapotable, à la hauteur tactile minimale — un lien de la taille du
 * texte, dans une bande de douze points, ne se vise pas debout avec les mains
 * moites.
 *
 * ## Là où il ne s'affiche pas
 *
 * En séance, et hors réseau. La séance parce que la place sous le pouce
 * appartient à « valider cette série » ; hors réseau parce qu'un lien qui ne peut
 * pas s'ouvrir n'est pas une proposition, c'est du bruit — les deux bandeaux ne
 * se disputent donc jamais la même ligne (`app/(tabs)/_layout.tsx`).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, space, text } from '@/theme';

import { Icon } from './Icon';

export type UpdateBannerProps = {
  /** Le numéro lisible de la version disponible. Nul : le bandeau reste, sans le nommer. */
  versionName: string | null;
  onPress: () => void;
  testID?: string;
};

export function UpdateBanner({ versionName, onPress, testID }: UpdateBannerProps) {
  const detail =
    versionName === null
      ? 'Une version plus récente est publiée.'
      : `La version ${versionName} est publiée.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // `polite` : TalkBack l'annonce quand il a fini sa phrase. Rien ici ne
      // justifie de couper la lecture en cours.
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Mise à jour disponible. ${detail} Ouvrir la page d’installation.`}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.copy}>
        {/* Un libellé de l'app : condensé capitales (règle 4). */}
        <Text style={styles.label}>Mise à jour</Text>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Icon name="external-link" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    // La cible fait la hauteur tactile : c'est ce qui la distingue du bandeau
    // hors ligne, qui n'en est pas une.
    minHeight: layout.touchTarget,
    paddingVertical: space[3],
    paddingHorizontal: space[8],
    backgroundColor: colors.fill,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
  },
  // Pressé, la bande **fonce** au lieu de s'éclaircir : même correction qu'au
  // bouton primaire en KL-39, un appui doit s'enfoncer.
  pressed: { backgroundColor: colors.track },
  copy: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space[3] },
  label: { ...text.eyebrow, color: colors.text },
  detail: { ...text.caption, color: colors.textSecondary, flexShrink: 1 },
});
