import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, Header, ScaleSelector } from '@/components';
import {
  effortLabel,
  FEELING_MAX,
  feelingLabel,
  longDate,
  rateWorkout,
  SESSION_RPE_MAX,
  useWorkout,
} from '@/session';
import { layout, space, text, themed, useStyles } from '@/theme';

/**
 * Écran « Ressenti » — juste après la clôture, et ensuite à la demande.
 *
 * Deux questions, aux échelles de Garmin : **comment tu t'es senti** (forme 1-5)
 * et **à quel point c'était dur** (difficulté 1-10). Rien d'autre : c'est l'écran
 * qu'on remplit en rangeant ses affaires, il doit tenir en deux gestes.
 *
 * ## Après la clôture, pas à sa place
 *
 * « Clôturer » ferme d'abord la séance, puis ouvre cet écran par-dessus « Séance
 * terminée ». L'ordre compte : une app tuée ici laisse une séance close et
 * poussée, simplement sans note — l'inverse laisserait une séance ouverte parce
 * qu'on n'a pas su dire si c'était dur. Valider ou passer revient donc à l'écran
 * de fin, qui affiche la note et permet d'y revenir.
 *
 * ## Facultatif, modifiable, jamais effacé d'ici
 *
 * « Passer » n'écrit rien. Rouvert plus tard, l'écran part des valeurs
 * enregistrées et n'écrit que ce qui change (`rateWorkout`). Une échelle ne se
 * vide pas : retirer une note est un geste du web, comme le veut le contrat.
 */
export default function SessionRateScreen() {
  const styles = useStyles(sheets);
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const workout = useWorkout(uuid);
  const insets = useSafeAreaInsets();

  // Brouillon : `null` = pas touché, la valeur enregistrée comble. Même schéma
  // que la note de clôture — un effet qui recopierait la base réécrirait
  // l'échelle sous le doigt au prochain pull.
  const [feelingDraft, setFeeling] = useState<number | null>(null);
  const [rpeDraft, setRpe] = useState<number | null>(null);

  if (workout === undefined) {
    return <View style={styles.screen} />;
  }

  // Seule une séance close sur ce téléphone se note ici : c'est la garde de
  // `rateWorkout`, dite à l'écran plutôt que d'échouer en silence.
  if (workout === null || workout.endedAt === null) {
    return (
      <View style={styles.screen}>
        <Header title="Ressenti" onBack={() => router.back()} />
        <EmptyState
          title="Rien à noter"
          hint="Le ressenti se donne une fois la séance clôturée sur ce téléphone. Une séance déclarée faite sur le web se note sur le web."
          action={{ label: 'Retour', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const feeling = feelingDraft ?? workout.feeling;
  const sessionRpe = rpeDraft ?? workout.sessionRpe;
  const editing = workout.feeling !== null || workout.sessionRpe !== null;

  function save() {
    rateWorkout(uuid, { feeling, sessionRpe });
    router.back();
  }

  return (
    <View style={styles.screen}>
      <Header eyebrow={longDate(workout.date)} title="Ressenti" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.head}>
          {/* Un nom saisi : Barlow, casse normale (règle 4). */}
          <Text style={styles.name}>{workout.title ?? 'Séance libre'}</Text>
          <Text style={styles.caption}>
            Facultatif. Il se lit sur le web à côté de la séance, et nourrit les statistiques.
          </Text>
        </View>

        <ScaleSelector
          testID="rate-feeling"
          label="Comment tu t’es senti ?"
          max={FEELING_MAX}
          value={feeling}
          onChange={setFeeling}
          describe={feelingLabel}
          ends={['Très faible', 'Très en forme']}
        />

        <ScaleSelector
          testID="rate-effort"
          label="À quel point c’était dur ?"
          max={SESSION_RPE_MAX}
          value={sessionRpe}
          onChange={setRpe}
          describe={effortLabel}
          tone="primary"
          ends={['Très léger', 'Maximal']}
        />
      </ScrollView>

      {/* Une seule action primaire, en bas, comme dans toute la séance (KL-39). */}
      <View style={[styles.actions, { paddingBottom: space[6] + insets.bottom }]}>
        <Button
          label={editing ? 'Enregistrer' : 'Valider'}
          block
          disabled={feeling === null && sessionRpe === null}
          onPress={save}
        />
        <Button
          label={editing ? 'Annuler' : 'Passer'}
          variant="ghost"
          block
          accessibilityHint={
            editing ? 'Garder le ressenti enregistré' : 'Terminer sans noter la séance'
          }
          onPress={() => router.back()}
        />
      </View>
    </View>
  );
}

const sheets = themed((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: space[8], gap: space[10] },
  head: { gap: space[3] },
  name: { ...text.name, color: c.text },
  caption: { ...text.caption, color: c.textSecondary },
  actions: {
    gap: space[4],
    paddingTop: space[6],
    paddingHorizontal: space[8],
    backgroundColor: c.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: c.border,
  },
}));
