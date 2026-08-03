import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { describeError, getApiBaseUrl, signInWithPassword, useSession } from '@/api';
import { Button, Card, Field, Header } from '@/components';
import { colors, space, text } from '@/theme';

/**
 * L'écran de connexion — **version minimale de KL-25**.
 *
 * Il existe parce que « un 401 renvoie vers l'écran de connexion » a besoin
 * d'une destination : sans route `login`, le garde de `_layout.tsx` n'aurait
 * nulle part où retomber et la purge du jeton ne se verrait pas. Il porte donc
 * le seul chemin dont le client dispose aujourd'hui, le mot de passe.
 *
 * **KL-26 le remplace**, et l'ordre y sera l'inverse de celui-ci : « Scanner le
 * QR » en action primaire (KL-48), la saisie du code de 8 caractères en
 * secondaire, le mot de passe en dernier repli — plus la restauration de session
 * et le premier bootstrap avec son état de chargement. Rien de ce qui est ici
 * n'anticipe ces décisions.
 *
 * Ce qui, en revanche, est déjà vrai et le restera : **aucun lien « créer un
 * compte »**. Les comptes se créent en console (`app:user:create`), il n'y a pas
 * d'inscription publique.
 */
export default function LoginScreen() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = getApiBaseUrl();
  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;

  async function submit() {
    setPending(true);
    setError(null);

    try {
      await signInWithPassword({ email, password });
      // Rien à faire de plus : la session bascule, le garde de `_layout.tsx`
      // retire cet écran de la pile et rend celui de derrière.
      setPassword('');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Header eyebrow="Kadens Live" title="Connexion" />

      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {session.reason === 'expired' ? (
          <Text style={styles.notice}>
            Ta session a pris fin : le jeton a été révoqué depuis le site, ou il a dépassé ses 90
            jours. Rien n’est perdu, le réalisé déjà consigné attend dans le téléphone.
          </Text>
        ) : null}

        <Card title="Mot de passe">
          <View style={styles.stack}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              placeholder="toi@exemple.fr"
            />
            <Field
              label="Mot de passe"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry
              onSubmitEditing={() => {
                if (canSubmit) {
                  void submit();
                }
              }}
              error={error ?? undefined}
            />
            <Button
              label={pending ? 'Connexion…' : 'Se connecter'}
              onPress={() => void submit()}
              disabled={!canSubmit}
              block
            />
          </View>
        </Card>

        <Card title="Serveur">
          <Text style={styles.value}>{baseUrl ?? 'aucune URL (QR ou .env)'}</Text>
          <Text style={styles.hint}>
            L’URL vient du QR d’appairage. En développement, c’est EXPO_PUBLIC_API_URL qui la
            fournit — l’IP LAN de la machine, jamais localhost.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  notice: { ...text.body, color: colors.textSecondary },
  value: { ...text.numeric, color: colors.text },
  hint: { ...text.caption, color: colors.textFaint, marginTop: space[3] },
});
