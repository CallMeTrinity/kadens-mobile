import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { completeFirstSync } from '@/api';
import { Button } from '@/components';
import { syncNow } from '@/sync';
import { colors, space, text } from '@/theme';

/**
 * L'écran de premier bootstrap (KL-26, complété par KL-27).
 *
 * Retenu par `_layout.tsx` juste après un `login` ou un `pair` réussis : la base
 * locale est vide, et un « Aujourd'hui » sans rien dedans mentirait sur l'état
 * de l'app. Le premier pull part donc ici, avec un message honnête plutôt qu'un
 * chargement muet.
 *
 * **Il passe par le moteur de synchronisation, pas par un appel direct.** KL-26
 * appelait `GET /api/bootstrap` sans rien en faire, faute de moteur : la base
 * restait vide jusqu'au déclencheur suivant. C'est réparé — `syncNow` applique la
 * réponse en transaction et tient `sync_state`, et il reste le seul écrivain de
 * cette table (le dupliquer ici referait ce travail hors de ses garanties). La
 * file est vide à ce stade, le push qui précède le pull ne fait donc rien, et
 * l'ordre « push avant pull » reste vrai sans cas particulier.
 *
 * Un échec n'enferme personne : « Réessayer » relance, « Continuer sans mes
 * séances » referme le garde quand même — la base reste vide jusqu'au prochain
 * pull, mais l'app reste utilisable.
 */
export default function BootstrappingScreen() {
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // `syncNow` ne lève jamais : son échec se lit dans le rapport (`engine.ts`),
      // parce que ses autres appelants sont des déclencheurs sans personne pour
      // attraper une exception.
      const outcome = await syncNow('first-sync');

      if (cancelled) {
        return;
      }

      if (outcome.ok) {
        completeFirstSync();

        return;
      }

      setError(outcome.error);
      setPending(false);
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
            {/* Plus « Serveur injoignable » : l'échec peut aussi venir du serveur
                lui-même, et le message précis est juste en dessous. */}
            <Text style={styles.title}>Récupération impossible</Text>
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
