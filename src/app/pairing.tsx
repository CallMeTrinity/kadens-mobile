import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError, signInWithPairingCode, signInWithPairingQr } from '@/api';
import { Button, Card, Field, Header, useKeyboardOverlap } from '@/components';
import { patchSyncState } from '@/db';
import { colors, layout, space, text } from '@/theme';

/** Longueur du code de secours affiché sous le QR (`docs/api-mobile.md`). */
const CODE_LENGTH = 8;

/**
 * L'écran d'appairage (KL-26, complété par KL-48).
 *
 * Deux chemins vers le même échange : la caméra lit le QR et pose l'URL du
 * serveur au passage (§0.6 — c'est ce qui règle l'IP LAN en développement sans
 * rien saisir), la saisie manuelle du code de 8 caractères reste le **repli**
 * quand la caméra refuse ou que le QR est illisible. Les deux appellent la
 * même API d'échange et partagent le même état de chargement / d'erreur — le
 * serveur ne distingue pas leur origine.
 */
export default function PairingScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap();
  const [error, setError] = useState<string | null>(null);
  // Empêche de traiter deux fois le même cadre pendant qu'un scan est en cours
  // de vérification côté serveur ; remis à `false` après échec pour permettre
  // de rescanner.
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const canSubmit = code.trim().length === CODE_LENGTH && !pending;

  async function submitManualCode() {
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

  async function handleBarcodeScanned({ data }: BarcodeScanningResult) {
    if (scanned || pending) {
      return;
    }

    setScanned(true);
    setError(null);
    setPending(true);

    try {
      const { apiUrl } = await signInWithPairingQr(data);
      // Seul écrivain d'`apiUrl` (`src/db/syncState.ts`) : persisté seulement
      // après un échange réussi, pour qu'un QR mal lu ne remplace jamais le
      // serveur appairé par un précédent appairage.
      await patchSyncState({ apiUrl });
      // Session basculée : le garde retire l'écran, pas besoin de démonter le
      // scan nous-mêmes.
    } catch (cause) {
      setError(describeError(cause));
      setScanned(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <View onLayout={keyboard.onLayout} style={styles.screen}>
      <Header eyebrow="Kadens Live" title="Appairage" onBack={() => router.back()} />

      {/* La zone sûre du bas (KL-37) : sans elle, la fin de page s'arrête au
          bord de l'écran et passe sous la barre gestuelle Android. Et ce que le
          clavier recouvre (KL-39), pour que le champ de code et son bouton
          restent atteignables — le clavier prend alors la place de la zone
          sûre, il la recouvre déjà. */}
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingBottom: space[8] + (keyboard.overlap || insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Un seul emplacement pour l'erreur : elle peut venir du scan comme de
            la saisie manuelle, et le serveur ne distingue pas leur origine. */}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Card title="Scanner le QR">{renderCamera()}</Card>

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
                  void submitManualCode();
                }
              }}
            />
            <Button
              label={pending ? 'Vérification…' : 'Valider'}
              onPress={() => void submitManualCode()}
              disabled={!canSubmit}
              block
            />
          </View>
        </Card>
      </ScrollView>
    </View>
  );

  function renderCamera() {
    // État transitoire, avant que le module ait répondu sur la permission
    // déjà accordée ou non : rien à montrer plutôt qu'un flash de contenu.
    if (!permission) {
      return null;
    }

    if (!permission.granted) {
      return (
        <View style={styles.stack}>
          <Text style={styles.hint}>
            Kadens a besoin de l’appareil photo pour lire le QR affiché sur l’écran de connexion du
            site. Rien d’autre n’est ni capturé ni enregistré.
          </Text>
          {permission.canAskAgain ? (
            <Button label="Activer la caméra" onPress={() => void requestPermission()} block />
          ) : (
            <>
              <Text style={styles.hint}>
                L’accès a été refusé. Autorise l’appareil photo dans les réglages Android pour
                scanner le QR — la saisie manuelle ci-dessous reste disponible en attendant.
              </Text>
              <Button
                label="Ouvrir les réglages"
                variant="secondary"
                onPress={() => void Linking.openSettings()}
                block
              />
            </>
          )}
        </View>
      );
    }

    return (
      <View style={styles.stack}>
        <View style={styles.cameraFrame}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => void handleBarcodeScanned(result)}
          />
        </View>
        <Text style={styles.hint}>
          {pending
            ? 'Vérification du code…'
            : 'Vise le QR affiché sous « Connecter un téléphone » sur le site.'}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  hint: { ...text.body, color: colors.textSecondary },
  // Le rouge dit l'échec — un de ses trois emplois (règle 2 du design system).
  error: { ...text.body, color: colors.primaryOnTint },
  cameraFrame: {
    aspectRatio: 1,
    width: '100%',
    borderWidth: layout.hairline,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surfaceInk,
  },
});
