import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError, getApiBaseUrl, signInWithPassword } from '@/api';
import { Button, Card, Field, Header, useKeyboardOverlap } from '@/components';
import { space, text, themed, useStyles } from '@/theme';

/**
 * Le repli mot de passe (KL-26).
 *
 * Dernier recours après « Scanner le QR » et « Saisir le code » sur l'écran de
 * connexion : nécessaire aux tests fonctionnels de l'API (§0.6 point 5 de
 * `docs/feature-live-tracking.md`), mais ce n'est plus le chemin par défaut. Le
 * contenu reprend tel quel la version KL-25 du champ, déplacée de `login.tsx`.
 */
export default function LoginPasswordScreen() {
  const styles = useStyles(sheets);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap();
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
    <View onLayout={keyboard.onLayout} style={styles.screen}>
      <Header eyebrow="Kadens Live" title="Email et mot de passe" onBack={() => router.back()} />

      {/* La zone sûre du bas (KL-37) : sans elle, la fin de page s'arrête au
          bord de l'écran et passe sous la barre gestuelle Android. Et ce que le
          clavier recouvre (KL-39), pour que le bouton reste atteignable en
          faisant défiler — le clavier prenant alors la place de la zone sûre. */}
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingBottom: space[8] + (keyboard.overlap || insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
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

const sheets = themed((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  value: { ...text.numeric, color: c.text },
  hint: { ...text.caption, color: c.textSecondary, marginTop: space[3] },
}));
