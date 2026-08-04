import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, EmptyState, Header } from '@/components';
import { longDate, useWorkout } from '@/session';
import { colors, space, text } from '@/theme';

/**
 * Écran de séance — **coquille assumée** (KL-28), remplie par KL-29.
 *
 * Elle existe parce que « Démarrer » a besoin d'une destination : sans elle,
 * l'action de l'écran « Aujourd'hui » ne serait pas vérifiable, et le ticket
 * demande précisément qu'une séance se démarre et se reprenne. Même statut que
 * `login.tsx` en KL-25, qui n'était qu'une destination pour le garde de session
 * avant que KL-26 en fasse un écran.
 *
 * Ce qu'elle fait déjà, et qui n'est pas décoratif : elle **montre que la séance
 * est ouverte**. `started_at` a été posé avant la navigation, la lecture est vive,
 * donc revenir ici après avoir tué l'app affiche le même état. C'est la
 * démonstration de la reprise.
 *
 * Ce qu'elle ne fait pas, et que KL-29 apportera : dérouler le prescrit bloc par
 * bloc, cocher les séries, écrire le réalisé. Rien de tout ça n'est esquissé ici
 * — une demi-implémentation du déroulé serait à défaire.
 */
export default function SessionScreen() {
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const workout = useWorkout(uuid);

  // `undefined` = la base n'a pas encore répondu. Ne rien peindre vaut mieux
  // qu'un « séance introuvable » qui clignoterait à chaque ouverture.
  if (workout === undefined) {
    return <View style={styles.screen} />;
  }

  if (workout === null) {
    return (
      <View style={styles.screen}>
        <Header title="Séance" onBack={() => router.back()} />
        <EmptyState
          title="Séance introuvable"
          hint="Elle a pu être supprimée depuis le web, ou sortir de la fenêtre synchronisée."
          action={{ label: 'Retour', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const running = workout.startedAt !== null && workout.endedAt === null;
  const closed = workout.endedAt !== null;

  return (
    <View style={styles.screen}>
      <Header
        eyebrow={longDate(workout.date)}
        title="Séance"
        onBack={() => router.back()}
        right={
          running || closed ? (
            <Chip
              label={running ? 'En cours' : 'Terminée'}
              tone={running ? 'planned' : 'done'}
              dot
            />
          ) : null
        }
      />

      <ScrollView contentContainerStyle={styles.page}>
        <Card title={workout.plan?.title ?? (workout.freeform ? 'Hors plan' : 'Séance programmée')}>
          <Text style={styles.name}>{workout.title ?? 'Séance libre'}</Text>
        </Card>

        <Card title="Déroulé">
          <Text style={styles.body}>
            Le déroulé série par série arrive avec KL-29. La séance est ouverte : son heure de début
            est écrite en base, et elle se retrouvera ici même si l’app est fermée.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  name: { ...text.name, color: colors.text },
  body: { ...text.body, color: colors.textSecondary },
});
