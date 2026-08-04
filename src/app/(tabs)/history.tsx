import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, EmptyState, Header } from '@/components';
import { longDate, usePastWorkouts, workoutStateLabel, type DayWorkout } from '@/session';
import { colors, space, text } from '@/theme';

/**
 * Écran « Historique » (KL-37) — la deuxième entrée de la barre basse.
 *
 * Il répond à la question que la bande de jours ne peut pas porter : **qu'est-ce
 * que j'ai fait ces dernières semaines ?** L'écran « Aujourd'hui » s'arrête à
 * J-2, parce qu'au-delà ce n'est plus « aujourd'hui » ; au-delà commence ici.
 *
 * ## Sa portée est celle de la base locale, et il le dit
 *
 * La fenêtre du serveur (J-30 → J+14) fait autorité et remplace en entier ce
 * qu'elle couvre : l'app n'a tout simplement pas de trente-et-unième jour à
 * montrer. Plutôt qu'un écran qui s'arrête sans prévenir, le sur-titre annonce
 * la portée et le pied renvoie au web, où l'historique est complet.
 *
 * ## Ce qu'il n'est pas
 *
 * Un tableau de bord. Aucun total, aucune courbe, aucun cumul de tonnage : ces
 * lectures-là sont des pages web (KL-49, KL-50), elles supposent le serveur et
 * une vue d'ensemble qu'un téléphone en salle n'a pas à porter. Ici, une séance
 * = une ligne, et on l'ouvre pour relire ce qu'on y a fait.
 *
 * ## Une séance close s'ouvre, elle ne se reprend pas
 *
 * §2.3 point 5 : la clôture est terminale. Le bouton dit donc « Voir la séance »
 * et la navigation passe par un `push` direct, **sans `beginWorkout`** — celui
 * de l'écran « Aujourd'hui » n'est là que pour poser `started_at` sur une séance
 * qu'on commence, et il refuserait de toute façon celle-ci.
 */
export default function HistoryScreen() {
  const workouts = usePastWorkouts();

  return (
    <View style={styles.screen}>
      <Header eyebrow="30 derniers jours" title="Historique" />

      <ScrollView contentContainerStyle={styles.page}>
        {workouts.length > 0 ? (
          <>
            {workouts.map((workout) => (
              <PastCard key={workout.uuid} workout={workout} />
            ))}
            {/* Le rappel vient après la liste, pas avant : il explique une
                absence qu'on ne constate qu'en arrivant au bout. */}
            <Text style={styles.reach}>
              Cet appareil garde les trente derniers jours. L’historique complet reste sur le site.
            </Text>
          </>
        ) : (
          <EmptyState
            title="Rien derrière toi"
            hint="Une séance apparaît ici une fois clôturée, ou une fois marquée faite depuis le site."
          />
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Une séance passée.
 *
 * Aucun bouton primaire : relire n'est jamais urgent, et un écran de rouges qui
 * se répètent ne dirait plus rien (règle 2). C'est la même carte que celle de
 * l'écran « Aujourd'hui », à l'action près — d'où le titre en date : ici la date
 * est l'information qui distingue deux lignes, pas le plan.
 */
function PastCard({ workout }: { workout: DayWorkout }) {
  const state = workoutStateLabel(workout);
  // La teinte se lit sur le **statut**, pas sur `state.done` : une séance que le
  // serveur donne pour faite mais qu'on vient de rouvrir ici s'annonce « En
  // cours », et le rouge de l'échec n'a rien à y faire (règle 2).
  const tone = state.done ? 'done' : workout.status === 'missed' ? 'missed' : 'planned';

  return (
    <Card title={longDate(workout.date)} right={<Chip label={state.label} tone={tone} dot />}>
      <View style={styles.stack}>
        {/* Un nom saisi : Barlow, casse normale (règle 4). */}
        <Text style={styles.name}>{workout.title ?? 'Séance libre'}</Text>

        <View style={styles.marks}>
          {workout.loggedSets > 0 ? (
            <Text style={styles.caption}>
              {workout.loggedSets} série{workout.loggedSets > 1 ? 's' : ''} consignée
              {workout.loggedSets > 1 ? 's' : ''}
            </Text>
          ) : (
            // Une sortie course ou vélo n'a pas de séries : le réalisé du cardio
            // se résume à son statut (§0.2). L'absence se dit, elle ne se laisse
            // pas lire comme un oubli.
            <Text style={styles.caption}>Aucune série consignée</Text>
          )}
          {workout.pendingSync ? <Chip label="À synchroniser" /> : null}
        </View>

        <Button
          label="Voir la séance"
          variant="ghost"
          onPress={() => router.push(`/session/${workout.uuid}`)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Pas de dégagement pour la barre basse : `TabSlot` rend l'écran **au-dessus**
  // d'elle, elle ne le recouvre pas. C'est la différence avec le web, où la
  // barre est `fixed` et où `.kd-page` doit lui réserver sa hauteur.
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  marks: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  name: { ...text.name, color: colors.text },
  caption: { ...text.caption, color: colors.textFaint },
  reach: { ...text.caption, color: colors.textFaint, textAlign: 'center' },
});
