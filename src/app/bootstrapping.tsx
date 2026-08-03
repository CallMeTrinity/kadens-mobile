import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { bootstrap, completeFirstSync, describeError } from '@/api';
import { Button } from '@/components';
import { colors, space, text } from '@/theme';

/**
 * L'écran de premier bootstrap (KL-26).
 *
 * Retenu par `_layout.tsx` juste après un `login` ou un `pair` réussis : la base
 * locale est vide, et un « Aujourd'hui » sans rien dedans mentirait sur l'état
 * de l'app. Un `GET /api/bootstrap` (sans `since`, le premier pull complet) part
 * donc ici, avec un message honnête plutôt qu'un chargement muet.
 *
 * **La réponse n'est volontairement pas appliquée à la base locale.** L'écrire
 * en transaction et tenir `sync_state` (fenêtre, `lastPulledAt`) est le rôle du
 * moteur de synchronisation (KL-27), qui en fera **le** seul écrivain — le
 * dupliquer ici referait ce travail en dehors de ses garanties transactionnelles.
 * Cet écran ne fait que valider que le serveur répond avant de laisser entrer
 * dans l'app, et referme le garde (`completeFirstSync`) dans tous les cas :
 * succès, ou abandon volontaire depuis l'échec.
 */
export default function BootstrappingScreen() {
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await bootstrap();

        if (!cancelled) {
          completeFirstSync();
        }
      } catch (cause) {
        if (!cancelled) {
          setError(describeError(cause));
          setPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setPending(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        {pending ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.title}>Récupération de tes séances</Text>
            <Text style={styles.hint}>Ça ne prend qu’un instant.</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Serveur injoignable</Text>
            <Text style={styles.error}>{error}</Text>
            <View style={styles.actions}>
              <Button label="Réessayer" onPress={retry} block />
              <Button
                label="Continuer sans mes séances"
                variant="ghost"
                onPress={completeFirstSync}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  center: { alignItems: 'center', gap: space[4], paddingHorizontal: space[8] },
  title: { ...text.sectionTitle, color: colors.text, textAlign: 'center' },
  hint: { ...text.caption, color: colors.textFaint, textAlign: 'center' },
  // Le rouge dit l'échec, et rien d'autre (§5 règle 2).
  error: { ...text.body, color: colors.primary, textAlign: 'center' },
  actions: { marginTop: space[4], gap: space[3], alignSelf: 'stretch' },
});
