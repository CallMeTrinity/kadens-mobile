/**
 * Le bandeau hors ligne (KL-38).
 *
 * ## Il informe, il n'alerte pas
 *
 * Hors réseau est l'**état nominal** de cette app : le sous-sol d'une salle de
 * sport est le cas d'usage du chantier, tout s'écrit en local et repart plus
 * tard. Un bandeau rouge y mentirait deux fois — en annonçant une panne là où
 * il n'y en a pas, et en usant la seule couleur de l'identité sur un état qui
 * dure des heures (règle 2 : le rouge est l'action primaire, l'intensité,
 * l'échec). D'où l'encre faible, la hauteur d'une ligne, aucune cible tactile et
 * aucune action : il n'y a rien à faire, c'est précisément ce qu'il dit.
 *
 * ## Il ne bloque rien
 *
 * Ni modale, ni superposition, ni écran qui attend. C'est une bande peinte dans
 * le flux, au-dessus de la barre d'onglets : elle **pousse** le contenu de
 * quelques points au lieu de le recouvrir, donc aucune cible ne passe dessous.
 * Elle ne porte pas non plus la zone sûre du bas — la barre d'onglets est en
 * dessous et c'est elle qui la prend (voir `components/Header.tsx`).
 *
 * ## Il distingue les deux façons d'être hors ligne
 *
 * Sans réseau du tout, ou avec du réseau et un serveur qui ne répond pas : la
 * seconde se corrige (mauvais serveur appairé, portail captif à valider), la
 * première s'attend. Les confondre ferait chercher la panne du mauvais côté.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, layout, space, text } from '@/theme';

export type OfflineBannerProps = {
  /** `false` = du réseau, mais le serveur n'a pas répondu au dernier cycle. */
  disconnected: boolean;
  /** Séances écrites ici et pas encore envoyées. */
  pending: number;
  testID?: string;
};

export function OfflineBanner({ disconnected, pending, testID }: OfflineBannerProps) {
  const label = disconnected ? 'Hors réseau' : 'Serveur injoignable';
  const detail =
    pending === 0
      ? 'Tout est écrit sur cet appareil.'
      : pending === 1
        ? '1 séance repartira au retour du réseau.'
        : `${pending} séances repartiront au retour du réseau.`;

  return (
    <View
      // `polite` et non `assertive` : TalkBack l'annonce quand il a fini ce
      // qu'il disait, il ne coupe pas la lecture d'une série en cours. Et pas de
      // rôle `alert`, qui promettrait une urgence que ce bandeau n'a pas.
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={`${label}. ${detail}`}
      style={styles.banner}
      testID={testID}
    >
      {/* Un libellé de l'app : condensé capitales (règle 4). */}
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.detail} numberOfLines={2}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[8],
    backgroundColor: colors.fill,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
  },
  label: { ...text.eyebrow, color: colors.textSecondary },
  detail: { ...text.caption, color: colors.textFaint, flexShrink: 1 },
});
