import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { describeError, signInWithPairingCode } from '@/api';
import { Button, Card, Field, Header } from '@/components';
import { colors, space, text } from '@/theme';

/** Longueur du code de secours affiché sous le QR (`docs/api-mobile.md`). */
const CODE_LENGTH = 8;

/**
 * L'écran d'appairage par code (KL-26).
 *
 * Aujourd'hui, c'est la **seule** façon d'échanger un code contre un jeton
 * depuis le téléphone : la saisie manuelle du code de 8 caractères affiché sous
 * le QR. « Scanner le QR » et « Saisir le code », sur l'écran de connexion,
 * mènent tous les deux ici — il n'y a rien d'autre à distinguer tant que la
 * caméra n'existe pas.
 *
 * **KL-48 complète cet écran**, il ne le remplace pas : `expo-camera` s'y
 * ajoute pour lire le QR directement, ce champ restant le repli quand la
 * caméra refuse.
 */
export default function PairingScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.trim().length === CODE_LENGTH && !pending;

  async function submit() {
    setPending(true);
    setError(null);

    try {
      await signInWithPairingCode(code);
      // Rien à faire de plus : la session bascule, le garde de `_layout.tsx`
      // retire cet écran de la pile.
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Header eyebrow="Kadens Live" title="Code d'appairage" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Card title="Depuis le site">
          <View style={styles.stack}>
            <Text style={styles.hint}>
              Ouvre « Connecter un téléphone » dans les réglages de ton compte sur le web, et saisis
              le code de secours affiché sous le QR.
            </Text>
            <Field
              label="Code"
              value={code}
              onChangeText={(value) => setCode(value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              placeholder="XXXXXXXX"
              onSubmitEditing={() => {
                if (canSubmit) {
                  void submit();
                }
              }}
              error={error ?? undefined}
            />
            <Button
              label={pending ? 'Vérification…' : 'Valider'}
              onPress={() => void submit()}
              disabled={!canSubmit}
              block
            />
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  hint: { ...text.body, color: colors.textSecondary },
});
