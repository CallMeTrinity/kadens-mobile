import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, EmptyState, Field, Header, Sheet } from '@/components';
import {
  beginWorkout,
  createFreeWorkout,
  dayOffset,
  dayTitle,
  defaultFreeTitle,
  longDate,
  shiftDate,
  useDayStrip,
  useDayWorkouts,
  useRunningWorkout,
  useToday,
  workoutStateLabel,
  type DayWorkout,
} from '@/session';
import { colors, layout, space, text } from '@/theme';

/**
 * Écran « Aujourd'hui » (KL-28) — la porte d'entrée de l'app.
 *
 * Il répond à une seule question, et il doit y répondre barre en main, sans
 * réseau, en moins d'une seconde : **qu'est-ce que je fais maintenant ?**
 *
 * ## Ce qu'il montre, dans cet ordre
 *
 * 1. **La séance en cours**, s'il y en a une, quel que soit son jour. C'est la
 *    reprise après fermeture de l'app : rien n'est mémorisé côté navigation,
 *    l'état vit en base (`started_at` posé, `ended_at` nul), donc une app tuée
 *    puis relancée retrouve exactement la même chose.
 * 2. **Les séances du jour sélectionné**, lues en local.
 * 3. **Une séance libre**, toujours accessible, dans une barre qui ne défile pas.
 *
 * ## Une seule action primaire
 *
 * Règle 2 du design system : le rouge porte du sens, un écran n'a qu'un bouton
 * primaire. Ici c'est **la plus urgente** — reprendre s'il y a une séance
 * ouverte, sinon démarrer la première séance actionnable du jour. Tout le reste
 * est secondaire. Sans cette règle, trois séances programmées le même jour
 * donneraient trois rouges qui ne disent plus rien.
 *
 * ## Ce que l'écran ne peut pas afficher
 *
 * Le nombre d'exercices prévus. Il vit dans `prescribed_snapshot`, le plus gros
 * document de la base, et lister un jour ne doit pas le remonter — c'est
 * l'invariant de `db/schema.ts`. La carte montre donc ce que les colonnes de la
 * séance datée et le réalisé savent déjà dire.
 */
export default function TodayScreen() {
  const today = useToday();
  // La sélection est un **écart**, pas une date. C'est ce qui la garde juste
  // quand minuit passe pendant que l'app dort : `today` bouge (`useToday`), le
  // jour affiché suit, et la sélection ne peut jamais sortir de la bande. Une
  // date absolue aurait demandé de la recaler à la main, donc d'ajouter un état
  // qui décrit ce que celui-ci dit déjà.
  const [offset, setOffset] = useState(0);
  const selected = shiftDate(today, offset);
  const [freeSheetOpen, setFreeSheetOpen] = useState(false);
  const [freeTitle, setFreeTitle] = useState('');

  const strip = useDayStrip(today);
  const workouts = useDayWorkouts(selected);
  const running = useRunningWorkout();

  // La séance en cours ne se montre en bandeau que si elle n'est pas déjà dans
  // la liste affichée : deux fois la même carte ferait douter qu'il s'agit de la
  // même séance.
  const runningElsewhere = running && running.date !== selected ? running : null;

  // L'unique action primaire. Le bandeau de reprise la prend s'il est là ; sinon
  // c'est la première séance du jour qu'on peut ouvrir.
  const primaryUuid = runningElsewhere
    ? null
    : (workouts.find((workout) => workout.running) ?? workouts.find((workout) => !workout.closed))
        ?.uuid;

  function open(uuid: string) {
    if (beginWorkout(uuid)) {
      router.push(`/session/${uuid}`);
    }
  }

  function openFreeSheet() {
    // Le brouillon repart du défaut à chaque ouverture : la feuille est un
    // geste, pas un formulaire qu'on retrouve à moitié rempli trois jours plus
    // tard. Posé ici plutôt que dans un effet de la feuille — c'est l'ouverture
    // qui est l'événement, pas le rendu.
    setFreeTitle(defaultFreeTitle(today));
    setFreeSheetOpen(true);
  }

  function startFree() {
    setFreeSheetOpen(false);
    // Toujours à la date du jour (`createFreeWorkout`) : on ramène donc
    // l'affichage sur aujourd'hui, sinon la séance qu'on vient de créer
    // n'apparaîtrait nulle part.
    setOffset(0);
    router.push(`/session/${createFreeWorkout(freeTitle)}`);
  }

  return (
    <View style={styles.screen}>
      {/* Plus d'action « Réglages » ici depuis KL-37 : c'est une entrée de la
          barre basse. Le même chemin à deux endroits ferait douter qu'il mène au
          même écran — et celui-ci est au pouce. */}
      <Header eyebrow={longDate(selected)} title={dayTitle(selected, today)} />

      <DayStrip cells={strip} selected={selected} onSelect={setOffset} />

      <ScrollView contentContainerStyle={styles.page}>
        {runningElsewhere ? (
          <ResumeBanner
            title={runningElsewhere.title}
            day={dayTitle(runningElsewhere.date, today)}
            offset={dayOffset(runningElsewhere.date, today)}
            onResume={() => open(runningElsewhere.uuid)}
          />
        ) : null}

        {workouts.length > 0 ? (
          workouts.map((workout) => (
            <WorkoutCard
              key={workout.uuid}
              workout={workout}
              primary={workout.uuid === primaryUuid}
              onOpen={() => open(workout.uuid)}
            />
          ))
        ) : (
          // Pas d'`action` ici : « Séance libre » est déjà dans la barre du bas,
          // et la même action à deux endroits ferait douter qu'elle fait la même
          // chose.
          <EmptyState
            title={emptyTitle(selected, today)}
            hint="Une séance libre se démarre sans programme, à la date du jour."
          />
        )}
      </ScrollView>

      {/* La barre d'action ne défile pas : « toujours accessible » veut dire
          atteignable sans remonter une liste, y compris au milieu d'une journée
          chargée. Elle ne compte plus la zone sûre du bas depuis KL-37 : la barre
          d'onglets est en dessous et c'est elle qui la prend — l'ajouter ici
          creuserait deux fois le même dégagement. */}
      <View style={styles.actions}>
        <Button
          label={offset === 0 ? 'Séance libre' : "Séance libre aujourd'hui"}
          variant="secondary"
          block
          onPress={openFreeSheet}
        />
      </View>

      <FreeWorkoutSheet
        visible={freeSheetOpen}
        title={freeTitle}
        placeholder={defaultFreeTitle(today)}
        onChangeTitle={setFreeTitle}
        onClose={() => setFreeSheetOpen(false)}
        onStart={startFree}
      />
    </View>
  );
}

/**
 * La bande des cinq jours, J-2 à J+2.
 *
 * Ce n'est pas un `Chip` : un `Chip` est une marque de lecture et ne se tape pas
 * (règle posée en KL-23). Un jour se choisit au doigt, il lui faut donc son
 * plancher tactile et son état sélectionné — c'est le « autre composant, avec son
 * plancher » que KL-23 annonçait.
 */
function DayStrip({
  cells,
  selected,
  onSelect,
}: {
  cells: { date: string; offset: number; weekday: string; dayOfMonth: string; total: number }[];
  selected: string;
  onSelect: (offset: number) => void;
}) {
  return (
    <View style={styles.strip}>
      {cells.map((cell) => {
        const active = cell.date === selected;

        return (
          <Pressable
            key={cell.date}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${cell.weekday} ${cell.dayOfMonth}`}
            accessibilityHint={cell.total > 0 ? `${cell.total} séance(s)` : 'Aucune séance'}
            onPress={() => onSelect(cell.offset)}
            style={({ pressed }) => [
              styles.day,
              active && styles.dayActive,
              pressed && !active && styles.dayPressed,
            ]}
          >
            <Text style={[styles.dayWeekday, active && styles.dayLabelActive]}>{cell.weekday}</Text>
            <Text style={[styles.dayNumber, active && styles.dayLabelActive]}>
              {cell.dayOfMonth}
            </Text>
            {/* Un point, pas un compteur : à cette taille un chiffre se lit mal,
                et « il y a quelque chose » est la seule information utile pour
                choisir un jour. */}
            <View
              style={[
                styles.dayDot,
                cell.total > 0 && (active ? styles.dayDotOnInk : styles.dayDotFilled),
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Le rappel d'une séance ouverte un autre jour. La reprise passe avant tout le reste. */
function ResumeBanner({
  title,
  day,
  offset,
  onResume,
}: {
  title: string | null;
  day: string;
  offset: number;
  onResume: () => void;
}) {
  return (
    <Card title="Séance en cours" right={<Chip label={day} tone="planned" dot />}>
      <View style={styles.stack}>
        <Text style={styles.name}>{title ?? 'Séance libre'}</Text>
        <Text style={styles.caption}>
          {offset === 0
            ? 'Commencée aujourd’hui, jamais clôturée.'
            : 'Commencée un autre jour, jamais clôturée.'}
        </Text>
        <Button label="Reprendre" onPress={onResume} block />
      </View>
    </Card>
  );
}

/** Une séance du jour. */
function WorkoutCard({
  workout,
  primary,
  onOpen,
}: {
  workout: DayWorkout;
  primary: boolean;
  onOpen: () => void;
}) {
  const state = workoutStateLabel(workout);

  return (
    <Card
      title={workout.plan?.title ?? (workout.freeform ? 'Hors plan' : 'Séance programmée')}
      right={<Chip label={state.label} tone={state.done ? 'done' : 'planned'} dot />}
    >
      <View style={styles.stack}>
        {/* Un nom saisi : Barlow, casse normale (règle 4). Le titre de la carte,
            lui, est un libellé de l'app, donc condensé capitales. */}
        <Text style={styles.name}>{workout.title ?? 'Séance libre'}</Text>

        <View style={styles.marks}>
          {workout.loggedSets > 0 ? (
            <Text style={styles.caption}>
              {workout.loggedSets} série{workout.loggedSets > 1 ? 's' : ''} consignée
              {workout.loggedSets > 1 ? 's' : ''}
            </Text>
          ) : null}
          {/* Ce n'est pas une erreur, donc pas de rouge : la séance est en
              sécurité en base, elle attend juste du réseau. */}
          {workout.pendingSync ? <Chip label="À synchroniser" /> : null}
        </View>

        {workout.closed ? (
          // Pas de reprise après clôture (§2.3 point 5). L'ouvrir reste utile —
          // on relit ce qu'on a fait — mais ce n'est plus une séance à dérouler.
          <Button label="Voir la séance" variant="ghost" onPress={onOpen} />
        ) : (
          <Button
            label={workout.running ? 'Reprendre' : 'Démarrer'}
            variant={primary ? 'primary' : 'secondary'}
            block
            onPress={onOpen}
          />
        )}
      </View>
    </Card>
  );
}

/**
 * La feuille de démarrage d'une séance libre.
 *
 * Un geste explicite, et un titre modifiable : sans elle, un appui malheureux
 * créerait une séance datée que rien ne permet encore de supprimer depuis le
 * téléphone. Le titre est pré-rempli et daté (`defaultFreeTitle`) — trois séances
 * libres du même mois nommées pareil seraient illisibles au calendrier web.
 */
function FreeWorkoutSheet({
  visible,
  title,
  placeholder,
  onChangeTitle,
  onClose,
  onStart,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  onChangeTitle: (title: string) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Séance libre"
      footer={<Button label="Démarrer" onPress={onStart} block />}
    >
      <Text style={styles.body}>
        Une séance sans programme, datée d’aujourd’hui. Elle apparaîtra au calendrier en « hors plan
        » une fois synchronisée.
      </Text>
      <Field
        label="Titre"
        value={title}
        onChangeText={onChangeTitle}
        placeholder={placeholder}
        hint="Modifiable maintenant, pas après."
      />
    </Sheet>
  );
}

/** L'état vide dit *quel* jour est vide : « rien de prévu » sur un écran daté est ambigu. */
function emptyTitle(selected: string, today: string): string {
  switch (dayOffset(selected, today)) {
    case 0:
      return 'Rien de prévu aujourd’hui';
    case -1:
      return 'Rien n’était prévu hier';
    case 1:
      return 'Rien de prévu demain';
    default:
      return 'Rien de prévu ce jour-là';
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  marks: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  name: { ...text.name, color: colors.text },
  caption: { ...text.caption, color: colors.textSecondary },
  body: { ...text.body, color: colors.textSecondary },

  strip: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },
  day: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: layout.touchTarget + space[5],
    paddingVertical: space[4],
    borderRightWidth: layout.hairline,
    borderRightColor: colors.dividerSoft,
  },
  // Le jour choisi s'inverse à l'encre, comme le bouton secondaire pressé : la
  // sélection se lit d'un coup d'œil sans introduire de teinte (règle 2).
  dayActive: { backgroundColor: colors.surfaceInk },
  dayPressed: { backgroundColor: colors.fill },
  dayWeekday: { ...text.eyebrow, color: colors.textSecondary },
  dayNumber: { ...text.numeric, color: colors.text },
  dayLabelActive: { color: colors.onInk },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
  dayDotFilled: { backgroundColor: colors.text },
  dayDotOnInk: { backgroundColor: colors.onInk },

  actions: {
    paddingTop: space[6],
    paddingBottom: space[6],
    paddingHorizontal: space[8],
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
  },
});
