import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/api';
import { Button, Header } from '@/components';
import { colors, space, text } from '@/theme';

/**
 * L'écran d'accueil de connexion (KL-26).
 *
 * Trois chemins, dans l'ordre où `docs/feature-live-tracking.md` §0.6 les
 * hiérarchise : « Scanner le QR » en action **primaire** (le geste attendu,
 * répété tous les 90 jours), « Saisir le code » en repli quand la caméra
 * refuse, « Email et mot de passe » en dernier recours — nécessaire aux tests
 * fonctionnels de l'API, jamais mis en avant. Les deux premiers mènent
 * aujourd'hui au même écran (`pairing.tsx`) : rien ne les distingue tant que
 * `expo-camera` n'existe pas (KL-48).
 *
 * **Aucun lien « créer un compte »** : les comptes se créent en console
 * (`app:user:create`), il n'y a pas d'inscription publique.
 */
export default function LoginScreen() {
  const router = useRouter();
  const session = useSession();

  return (
    <View style={styles.screen}>
      <Header eyebrow="Kadens Live" title="Connexion" />

      <View style={styles.page}>
        {session.reason === 'expired' ? (
          <Text style={styles.notice}>
            Ta session a pris fin : le jeton a été révoqué depuis le site, ou il a dépassé ses 90
            jours. Rien n’est perdu, le réalisé déjà consigné attend dans le téléphone.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button label="Scanner le QR" onPress={() => router.push('/pairing')} block />
          <Button
            label="Saisir le code"
            variant="secondary"
            onPress={() => router.push('/pairing')}
            block
          />
          <Button
            label="Email et mot de passe"
            variant="ghost"
            onPress={() => router.push('/login-password')}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, justifyContent: 'center', padding: space[8], gap: space[8] },
  notice: { ...text.body, color: colors.textSecondary },
  actions: { gap: space[4] },
});
