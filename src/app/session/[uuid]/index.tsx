import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Chip,
  duration,
  EmptyState,
  Field,
  FilterChip,
  Header,
  NumberStepper,
  setEffort,
  Sheet,
  weight,
  type ChipRank,
} from '@/components';
import {
  activityLabel,
  addExercise,
  addSet,
  adjustRest,
  beginWorkout,
  blockRoleLabel,
  canReplaceExercise,
  checkSet,
  dayOffset,
  deleteSet,
  exerciseIdOf,
  findExercise,
  findSetLine,
  longDate,
  removeExercise,
  replaceExercise,
  REST_STEP,
  setCardioDone,
  setDeviates,
  setExerciseState,
  setTypeLabel,
  setTypeLetter,
  shortDate,
  targetAreaLabel,
  startRestAfterSet,
  stopRest,
  uncheckSet,
  updateSet,
  useExerciseLibrary,
  useKeepScreenAwake,
  useRestTimer,
  useSessionHistory,
  useSessionProgram,
  useToday,
  useWorkout,
  useWorkoutPendingSync,
  type ExerciseRef,
  type LoggedSetValues,
  type RestState,
  type SessionBlock,
  type SessionExercise,
  type SessionGroup,
  type SessionSetLine,
} from '@/session';
import { colors, layout, space, text } from '@/theme';
import type {
  ActivityType,
  ExerciseHistoryRow,
  PerformanceBest,
  PerformanceSession,
  SetType,
  TargetArea,
} from '@/db';

/**
 * Écran « Séance en cours » (KL-29, déviations en KL-30) — l'écran pour lequel
 * toute l'app existe.
 *
 * Il se tient à bout de bras, barre en main, dans un sous-sol sans réseau. Trois
 * conséquences qui expliquent tout ce qui suit :
 *
 * 1. **Aucun appel réseau, jamais.** Tout vient de la base locale, en lectures
 *    vives. Une coupure ne change rien à ce que l'écran fait, un retour au premier
 *    plan non plus : il n'y a pas d'état de séance en mémoire à reconstruire — ce
 *    qui est vrai est en base, et l'app tuée puis relancée retrouve exactement la
 *    même chose.
 * 2. **Un geste, une écriture, une transaction.** Cocher une série écrit son
 *    `logged_set` **et** empile la mutation de la séance dans la même transaction
 *    (`@/session`, `log.ts` et `deviations.ts`). Rien n'est mis de côté pour être
 *    écrit « à la fin ».
 * 3. **Une seule mutation par séance.** La file est coalescée par uuid et ne porte
 *    que l'uuid, le document se relisant au push : trente séries cochées ne font
 *    qu'un envoi.
 *
 * ## Les deux gestes, et pourquoi ils sont distincts (KL-30)
 *
 * Une ligne **non cochée** se coche d'un appui n'importe où : c'est le geste
 * nominal en salle, on fait ce qui est écrit. Une fois **cochée**, la ligne
 * devient un objet qu'on corrige : sa zone de valeurs ouvre la feuille
 * d'ajustement, sa case reste le décochage. Deux cibles dans une ligne plutôt
 * qu'un appui long, qui n'est visible nulle part et se découvre par accident.
 *
 * Corollaire du modèle, pas de l'écran : **on ne dévie que sur ce qui a été
 * fait**. Le prescrit ne bouge jamais (§0.3) et n'a aucun endroit où accueillir
 * « la série 3 se fera à 82,5 kg ». On coche aux valeurs prescrites, puis on
 * corrige.
 *
 * ## Le repos et la veille (KL-31)
 *
 * Cocher une série **démarre le repos** : c'est le geste qui marque la fin de la
 * série, il n'y a rien de plus à demander. Le décompte vit dans `@/session`, pas
 * ici — il doit survivre à la feuille d'ajustement qu'on ouvre par-dessus, et à
 * l'écran qu'on quitte pour regarder demain. L'écran n'en peint que la barre, en
 * bas, au pouce.
 *
 * L'écran reste **allumé tant que la séance est en cours**, et seulement dans ce
 * cas : relire une séance close n'a pas à vider la batterie.
 *
 * ## L'historique, sous le nom de l'exercice (KL-32)
 *
 * « La dernière fois, j'avais fait quoi ? » et « c'est quoi mon record ? » se
 * posent **avant** de charger la barre, pas après la séance : les deux lignes sont
 * donc placées entre le nom de l'exercice et ses séries, au moment où elles
 * servent. Elles sont lues en local (`useSessionHistory`), donc disponibles hors
 * réseau, et rien ne s'affiche quand il n'y a rien à dire — pas de « — », pas de
 * cadre vide.
 *
 * ## La clôture n'est pas ici (KL-33)
 *
 * Elle a son écran, `./close`, et cet écran-ci n'en porte que la **porte** : un
 * bouton en fin de déroulé, là où on arrive quand la dernière série est cochée.
 * Rien d'autre — le résumé, la note et le geste irréversible vivent à côté,
 * parce qu'on ne clôture pas sans avoir lu ce qu'on clôture, et qu'un écran qui
 * sert barre en main ne doit pas porter d'action qui ne se défait pas.
 *
 * Une séance close reste ouvrable ici, en lecture : c'est ce qu'on a fait, et
 * « pas de reprise » ne veut pas dire « plus rien à lire ». Le bouton devient
 * alors « Voir le résumé ».
 *
 * ## Pourquoi tout tient dans un seul fichier
 *
 * Parce qu'`expo-router` charge **tout** fichier de `src/app/` comme une route
 * (son `require.context` n'exclut que `+html`, `+api` et `+middleware`) : un
 * voisin `_parts.tsx` deviendrait une route fantôme, rendue par `expo export`.
 * Les feuilles de cet écran restent donc chez lui, comme la carte de séance reste
 * dans « Aujourd'hui ». Le sélecteur d'exercice est le seul candidat à monter
 * dans `@/components` — le jour où KL-34 (séance vierge) l'emploiera à son tour.
 */
export default function SessionScreen() {
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const workout = useWorkout(uuid);
  const program = useSessionProgram(uuid);
  const pendingSync = useWorkoutPendingSync(uuid);
  const history = useSessionHistory(program);
  // Le repère des dates d'historique : le vrai jour, pas celui de la séance
  // affichée. Relire une séance d'il y a trois jours ne doit pas faire dire
  // « aujourd'hui » à une performance qui date d'il y a trois jours.
  const today = useToday();

  // Les trois feuilles retiennent une **clé**, jamais l'objet : chaque écriture
  // republie le déroulé, et un exercice figé dans un état de composant décrirait
  // la séance telle qu'elle était avant le dernier appui.
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [openExercise, setOpenExercise] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  // Mesurée, pas devinée : c'est ce qui dégage le bas de la page (voir plus bas).
  const [restHeight, setRestHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const running = workout ? workout.startedAt !== null && workout.endedAt === null : false;
  const rest = useRestTimer();

  // L'écran ne s'éteint pas pendant une séance en cours (KL-31). Conditionné, et
  // non `useKeepAwake()` : cet écran se monte aussi pour relire une séance close.
  useKeepScreenAwake(running);

  // On ne consigne que dans une séance ouverte. Une séance close est close
  // (§2.3 point 5) ; une séance jamais commencée n'a pas d'heure de début, et un
  // réalisé sans borne de départ serait une séance qu'on n'a pas faite.
  //
  // Cocher **démarre le repos**, décocher l'arrête : la série qu'on annule n'a
  // pas eu lieu, le repos qui la suivait non plus.
  const onCheck = useCallback(
    (exercise: SessionExercise, line: SessionSetLine) => {
      if (line.actionable) {
        if (checkSet(uuid, exercise, line)) {
          startRestAfterSet(exercise);
        }
      } else if (line.undoable) {
        if (uncheckSet(uuid, exercise, line)) {
          stopRest();
        }
      }
    },
    [uuid],
  );

  const onCardio = useCallback(
    (exercise: SessionExercise) => setCardioDone(uuid, exercise, exercise.logged === null),
    [uuid],
  );

  // Ajouter une série et en saisir les valeurs sont **un seul geste** : la série
  // naît pré-remplie par la précédente, sa feuille s'ouvre dans la foulée. Le
  // repos part quand même : une série ajoutée est une série faite, et corriger
  // ses valeurs par-dessus n'est pas une raison de repartir sans décompte.
  const onAddSet = useCallback(
    (exercise: SessionExercise) => {
      const created = addSet(uuid, exercise);

      if (created) {
        setOpenSet(created);
        startRestAfterSet(exercise);
      }
    },
    [uuid],
  );

  const onPick = useCallback(
    (target: PickerTarget, reference: ExerciseRef) => {
      if (target.mode === 'add') {
        addExercise(uuid, reference, program.prescribedCount);
      } else {
        const exercise = findExercise(program, target.exerciseKey);

        if (exercise) {
          replaceExercise(uuid, exercise, reference);
        }
      }

      setPicker(null);
    },
    [uuid, program],
  );

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

  const closed = workout.endedAt !== null;
  const sheetSet = openSet === null ? null : findSetLine(program, openSet);
  const sheetExercise = openExercise === null ? null : findExercise(program, openExercise);

  return (
    <View style={styles.screen}>
      <Header
        eyebrow={longDate(workout.date)}
        title={closed ? 'Séance terminée' : 'Séance'}
        onBack={() => router.back()}
        right={
          closed ? (
            <Chip label="Terminée" tone="done" dot />
          ) : running ? (
            <Chip label="En cours" tone="planned" dot />
          ) : null
        }
      />

      {/* La bande de tête ne défile pas : la progression doit rester lisible au
          milieu du douzième exercice, c'est tout l'intérêt de l'afficher. */}
      <View style={styles.summary}>
        <View style={styles.summaryHead}>
          {/* Un nom saisi : Barlow, casse normale (règle 4). */}
          <Text style={styles.name} numberOfLines={2}>
            {workout.title ?? 'Séance libre'}
          </Text>
          {pendingSync ? <Chip label="À synchroniser" /> : null}
        </View>
        {workout.plan ? <Text style={styles.caption}>{workout.plan.title}</Text> : null}
        {/* Rien à mesurer sur une séance sans programme : « 0 / 0 » n'est pas une
            progression, c'est une case vide de plus. */}
        {program.total > 0 ? <Progress done={program.done} total={program.total} /> : null}
      </View>

      {/*
        Le dégagement sous la page est la hauteur **mesurée** de la barre de
        repos, pas une valeur devinée : elle change avec la longueur du nom
        d'exercice et avec la taille de police du système, et un nombre écrit à la
        main finirait par masquer la dernière série cochée — c'est-à-dire
        exactement celle qu'on vient de faire.

        Hors repos, c'est la barre gestuelle Android qu'il faut dégager (KL-37) :
        cet écran est empilé par-dessus la barre d'onglets, rien ne le protège du
        bord. Pendant le repos, en revanche, la mesure **contient déjà** la zone
        sûre, que la barre prend en rembourrage — l'ajouter ici la compterait deux
        fois.
      */}
      <ScrollView
        contentContainerStyle={[
          styles.page,
          rest !== null
            ? { paddingBottom: restHeight + space[13] }
            : { paddingBottom: space[13] + insets.bottom },
        ]}
      >
        {!running && !closed ? (
          <View style={styles.notice}>
            <Text style={styles.body}>
              Cette séance n’est pas commencée. Rien ne se consigne tant qu’elle ne l’est pas.
            </Text>
            <Button label="Démarrer" onPress={() => beginWorkout(uuid)} block />
          </View>
        ) : null}

        {program.blocks.map((block) => (
          <BlockSection
            key={block.key}
            block={block}
            editable={running}
            history={history}
            today={today}
            onCheck={onCheck}
            onCardio={onCardio}
            onAdjustSet={setOpenSet}
            onAddSet={onAddSet}
            onOpenExercise={setOpenExercise}
          />
        ))}

        {/* Le réalisé qu'aucune ligne du programme ne réclame : ce que KL-30 y
            ajoute, et ce que le pull peut en descendre. Du réalisé invisible
            serait la pire trahison de « rien n'est jamais perdu ».

            Dans une séance vierge (KL-34), il n'y a **que** ça — il n'existe
            aucun programme dont on puisse être « hors ». L'en-tête dit donc
            simplement ce que c'est, sinon la séance entière se lirait comme une
            longue déviation. */}
        {program.extras.length > 0 ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <Text accessibilityRole="header" style={styles.blockRole}>
                {workout.freeform && program.blocks.length === 0 ? 'Exercices' : 'Hors programme'}
              </Text>
            </View>
            {program.extras.map((exercise) => (
              <ExerciseSection
                key={exercise.key}
                exercise={exercise}
                editable={running}
                history={history}
                today={today}
                onCheck={onCheck}
                onCardio={onCardio}
                onAdjustSet={setOpenSet}
                onAddSet={onAddSet}
                onOpenExercise={setOpenExercise}
              />
            ))}
          </View>
        ) : null}

        {program.blocks.length === 0 && program.extras.length === 0 ? (
          <EmptyState
            title={workout.freeform ? 'Séance libre, sans programme' : 'Aucun programme'}
            hint={
              workout.freeform
                ? 'Ajoute les exercices au fur et à mesure, ils partiront avec la séance.'
                : 'Le programme de cette séance n’est pas descendu. Une synchronisation le rapportera.'
            }
          />
        ) : null}

        {running ? (
          <Button
            label="Ajouter un exercice"
            variant="secondary"
            block
            onPress={() => setPicker({ mode: 'add' })}
          />
        ) : null}

        {/* La porte de la clôture (KL-33), en fin de déroulé : c'est là qu'on
            arrive une fois la dernière série cochée. Le geste lui-même, son
            résumé et sa note vivent sur l'écran suivant. */}
        {running || closed ? (
          <Button
            label={closed ? 'Voir le résumé' : 'Terminer la séance'}
            variant={closed ? 'secondary' : 'primary'}
            block
            accessibilityHint={
              closed
                ? 'Relire ce qui a été fait'
                : 'Voir le résumé avant de la déclarer terminée. Rien n’est clôturé tant qu’on ne le confirme pas'
            }
            onPress={() => router.push(`/session/${uuid}/close`)}
          />
        ) : null}
      </ScrollView>

      {rest ? <RestBar rest={rest} onHeight={setRestHeight} /> : null}

      {sheetSet ? (
        <SetSheet
          scheduledUuid={uuid}
          exercise={sheetSet.exercise}
          line={sheetSet.line}
          onClose={() => setOpenSet(null)}
        />
      ) : null}

      {sheetExercise ? (
        <ExerciseSheet
          scheduledUuid={uuid}
          exercise={sheetExercise}
          onClose={() => setOpenExercise(null)}
          onReplace={(key) => {
            setOpenExercise(null);
            setPicker({ mode: 'replace', exerciseKey: key });
          }}
        />
      ) : null}

      {picker ? (
        <ExercisePicker
          title={picker.mode === 'add' ? 'Ajouter un exercice' : 'Remplacer par'}
          onPick={(reference) => onPick(picker, reference)}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </View>
  );
}

/** Ce que le sélecteur d'exercice sert à faire : garnir la séance, ou substituer. */
type PickerTarget = { mode: 'add' } | { mode: 'replace'; exerciseKey: string };

/**
 * Séries faites sur séries prévues.
 *
 * **Compte des gestes, pas du volume.** L'échauffement entre donc dans le total,
 * contrairement au tonnage et aux records où il est exclu partout : ce qui se lit
 * ici, c'est ce qu'il reste à faire, et un échauffement reste à faire. Un exercice
 * cardio compte pour une unité — il n'a qu'une chose à dire, fait ou pas fait — et
 * un exercice sauté sort du compte, puisqu'il est réglé. Un exercice **hors
 * programme** n'y entre pas non plus : il ne réclame rien.
 */
function Progress({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? done / total : 0;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
      style={styles.progress}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        {done} / {total} série{total > 1 ? 's' : ''}
      </Text>
    </View>
  );
}

/**
 * La barre de repos (KL-31).
 *
 * **En bas de l'écran, et c'est le point** : c'est là que le pouce arrive quand
 * on tient le téléphone d'une main, et le ticket suivant (KL-39) en fait une
 * règle. Elle ne défile pas, elle recouvre — d'où le rembourrage supplémentaire
 * de la page tant qu'elle est là, sinon elle masquerait la dernière ligne de la
 * séance, c'est-à-dire précisément la série qu'on vient de cocher.
 *
 * Trois choses à portée : ajouter du repos, en retirer, passer. « Passer » ferme
 * la barre sans rien consigner — le repos n'est pas du réalisé, l'écourter ne se
 * raconte nulle part.
 *
 * **Le décompte n'est pas une zone vive pour TalkBack.** Un nombre qui change
 * chaque seconde et s'annonce à chaque fois rendrait l'écran inutilisable au
 * lecteur d'écran ; la barre s'annonce une fois, à son apparition, et se relit à
 * la demande.
 */
function RestBar({ rest, onHeight }: { rest: RestState; onHeight: (height: number) => void }) {
  const over = rest.remaining === 0;
  const ratio = rest.totalSeconds > 0 ? rest.remaining / rest.totalSeconds : 0;
  // La zone sûre du bas en **rembourrage** (KL-37) : la barre peint sous la barre
  // gestuelle Android au lieu de s'arrêter au-dessus, et ses trois boutons
  // remontent d'autant. Sans ça, « Passer » tombait sous le trait du système —
  // limite relevée en livrant KL-31. La hauteur mesurée par `onLayout` inclut ce
  // rembourrage, donc le dégagement de la page suit tout seul.
  const insets = useSafeAreaInsets();

  return (
    <View onLayout={(event) => onHeight(event.nativeEvent.layout.height)} style={styles.rest}>
      {/* La jauge se vide : ce qui reste de la barre est ce qui reste du repos. */}
      <View style={styles.restTrack}>
        <View style={[styles.restFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>

      <View style={styles.restBody}>
        <View style={styles.restLabels}>
          <Text style={styles.restTitle}>{over ? 'Repos terminé' : 'Repos'}</Text>
          {rest.exerciseName ? (
            <Text style={styles.caption} numberOfLines={1}>
              {rest.exerciseName}
            </Text>
          ) : null}
        </View>

        <Text
          accessibilityLabel={
            over ? 'Repos terminé' : `Repos, ${rest.remaining} secondes restantes`
          }
          style={[styles.restClock, over && styles.restClockOver]}
        >
          {duration(rest.remaining)}
        </Text>
      </View>

      <View style={[styles.restActions, { paddingBottom: space[6] + insets.bottom }]}>
        <Button
          label={`− ${REST_STEP} s`}
          variant="secondary"
          accessibilityLabel={`Retirer ${REST_STEP} secondes de repos`}
          onPress={() => adjustRest(-REST_STEP)}
        />
        <Button
          label={`+ ${REST_STEP} s`}
          variant="secondary"
          accessibilityLabel={`Ajouter ${REST_STEP} secondes de repos`}
          onPress={() => adjustRest(REST_STEP)}
        />
        <View style={styles.spacer} />
        <Button
          label={over ? 'Fermer' : 'Passer'}
          variant="ghost"
          accessibilityHint="Le repos ne se consigne pas, l’écourter ne change rien à la séance"
          onPress={stopRest}
        />
      </View>
    </View>
  );
}

/** Ce que chaque section d'exercice reçoit, et ce qu'elle sait faire remonter. */
type SectionHandlers = {
  editable: boolean;
  /**
   * La dernière performance et le record, indexés par identifiant d'exercice
   * (KL-32). Le déroulé entier en reçoit **une seule** copie : une lecture par
   * exercice aurait monté autant de requêtes vives qu'il y a de lignes.
   */
  history: Map<number, ExerciseHistoryRow>;
  /** Le jour réel, repère des dates d'historique. */
  today: string;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
  onAdjustSet: (setUuid: string) => void;
  onAddSet: (exercise: SessionExercise) => void;
  onOpenExercise: (key: string) => void;
};

/** Une section de la séance. Le bloc est une section, jamais un superset. */
function BlockSection({ block, ...handlers }: { block: SessionBlock } & SectionHandlers) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Text style={styles.blockNumber}>{String(block.number).padStart(2, '0')}</Text>
        <Text accessibilityRole="header" style={styles.blockRole}>
          {blockRoleLabel(block.block.role)}
        </Text>
        {block.block.label ? <Text style={styles.blockLabel}>{block.block.label}</Text> : null}
        {/* Les tours sont ceux du bloc entier (circuit), jamais d'un groupe. */}
        {block.block.rounds !== null && block.block.rounds > 1 ? (
          <Text style={styles.blockLabel}>× {block.block.rounds} tours</Text>
        ) : null}
        <View style={styles.spacer} />
        <Text style={styles.blockCount}>
          {block.done}/{block.total}
        </Text>
      </View>

      {block.groups.map((group) => (
        <GroupSection key={group.key} group={group} {...handlers} />
      ))}
    </View>
  );
}

/**
 * Un exercice isolé, ou un groupe lié.
 *
 * Le groupe se dessine **au rail de gauche**, comme le compositeur web : il n'a
 * pas de conteneur propre dans le modèle, et lui en donner un ici laisserait
 * croire qu'il en a un. Ni tours ni repos propres non plus — le nombre de tours
 * est déjà dans les séries de chaque exercice.
 */
function GroupSection({ group, ...handlers }: { group: SessionGroup } & SectionHandlers) {
  const body = group.exercises.map((exercise) => (
    <ExerciseSection key={exercise.key} exercise={exercise} {...handlers} />
  ));

  if (group.label === null) {
    return <>{body}</>;
  }

  return (
    <View style={styles.group}>
      <Text style={styles.groupHead}>Superset {group.label} · enchaîné sans repos</Text>
      {body}
    </View>
  );
}

/** Un exercice de la séance : son en-tête, sa consigne, ses séries, ses déviations. */
function ExerciseSection({
  exercise,
  editable,
  history,
  today,
  onCheck,
  onCardio,
  onAdjustSet,
  onAddSet,
  onOpenExercise,
}: { exercise: SessionExercise } & SectionHandlers) {
  const { prescribed, lines } = exercise;
  const exerciseId = exerciseIdOf(exercise);
  const past = exerciseId === null ? null : (history.get(exerciseId) ?? null);
  // « Ajouter une série » n'a de sens qu'une fois le prescrit épuisé : tant qu'une
  // ligne de travail attend, cocher la suivante **est** le geste, et proposer les
  // deux ferait deux chemins pour un même fait.
  const canAddSet =
    editable &&
    !exercise.skipped &&
    lines !== null &&
    lines.every((line) => line.planned === null || line.type === 'warmup' || line.logged !== null);

  return (
    <View style={styles.exercise}>
      <View style={styles.exerciseHead}>
        {prescribed?.groupLabel ? <Text style={styles.rank}>{prescribed.groupLabel}</Text> : null}
        <Text style={styles.name}>{exercise.name}</Text>
        <View style={styles.spacer} />
        {exercise.skipped ? (
          <Chip label="Sauté" />
        ) : exercise.total > 0 ? (
          <Text style={styles.exerciseCount}>
            {exercise.done}/{exercise.total}
          </Text>
        ) : null}
        {editable ? (
          <Button
            label="Ajuster"
            variant="ghost"
            size="sm"
            accessibilityHint={`Sauter, remplacer ou annoter ${exercise.name}`}
            onPress={() => onOpenExercise(exercise.key)}
          />
        ) : null}
      </View>

      {/* Le prescrit reste visible à côté du fait, même quand ce n'est plus le
          même exercice : sans lui, l'écart disparaît de la séance. */}
      {exercise.substituted && prescribed?.name ? (
        <Text style={styles.caption}>Prévu : {prescribed.name}</Text>
      ) : null}

      <View style={styles.marks}>
        {prescribed?.rpe != null ? <Text style={styles.caption}>RPE {prescribed.rpe}</Text> : null}
        {prescribed?.restSeconds != null && prescribed.restSeconds > 0 ? (
          <Text style={styles.caption}>repos {prescribed.restSeconds} s</Text>
        ) : null}
      </View>

      {/* La consigne du programme, adressée à celui qui exécute. */}
      {prescribed?.notes ? <Text style={styles.notes}>{prescribed.notes}</Text> : null}

      {/* Ce qu'on cherche avant de charger la barre : la dernière fois, et le
          record. Au-dessus des séries, parce que c'est là qu'on décide. */}
      {past ? <ExerciseHistory entry={past} today={today} /> : null}

      {lines === null ? (
        <CardioRow
          exercise={exercise}
          editable={editable && !exercise.skipped}
          onPress={() => onCardio(exercise)}
        />
      ) : (
        lines.map((line) => (
          <SetRow
            key={line.key}
            line={line}
            editable={editable && !exercise.skipped}
            onToggle={() => onCheck(exercise, line)}
            onAdjust={() => line.logged && onAdjustSet(line.logged.uuid)}
          />
        ))
      )}

      {canAddSet ? (
        <Button
          label="+ Série"
          variant="ghost"
          block
          accessibilityHint="Consigner une série de plus que prévu"
          onPress={() => onAddSet(exercise)}
        />
      ) : null}

      {/* Ce que l'athlète a écrit à la salle. Rien à voir avec la consigne. */}
      {exercise.logged?.notes ? <Text style={styles.logNotes}>{exercise.logged.notes}</Text> : null}
    </View>
  );
}

/**
 * La dernière performance et le record d'un exercice (KL-32).
 *
 * **Deux lignes au plus, et souvent une seule.** Un exercice jamais fait n'a pas
 * d'entrée du tout et ce composant n'est pas monté ; un exercice fait au poids du
 * corps a une dernière fois mais pas de record (il n'y a pas de record sans
 * kilos, `docs/api-mobile.md §6.6`), et la ligne manquante ne laisse pas de trou :
 * elle n'est pas rendue. C'est la troisième case du ticket — pas de case vide.
 *
 * **Ça ne ressemble pas à une série**, volontairement : ni filet, ni fond, ni
 * case. Une ligne d'historique posée sous les séries prescrites avec la même peau
 * s'appuierait du pouce par erreur, à bout de bras, entre deux séries.
 *
 * Le **type** de la série record (à l'échec, drop set) n'est pas affiché : ce sont
 * deux lignes qu'on lit en levant les yeux, et la charge est ce qui s'y compare.
 * La nuance vit sur la fiche d'exercice, quand KL-50 la posera.
 */
function ExerciseHistory({ entry, today }: { entry: ExerciseHistoryRow; today: string }) {
  const { last, best } = entry;

  // Une ligne d'historique sans dernière performance ni record ne devrait pas
  // exister — le serveur n'en descend pas — mais la table est un cache, et un
  // cadre vide serait exactement ce que le ticket refuse.
  if (last === null && best === null) {
    return null;
  }

  return (
    <View style={styles.history}>
      {last ? (
        <HistoryRow
          label="Dernière fois"
          value={performanceSummary(last)}
          date={performanceDate(last.date, today)}
        />
      ) : null}
      {best ? (
        <HistoryRow
          label="Record"
          value={bestSummary(best)}
          date={performanceDate(best.date, today)}
        />
      ) : null}
    </View>
  );
}

/**
 * Une ligne d'historique : ce que c'est, ce que c'était, quand.
 *
 * Le groupe s'annonce **d'un bloc** à TalkBack (`accessible`) : trois arrêts pour
 * lire « Record », puis « 8 reps, 85 kg », puis « 12 juillet » feraient trois fois
 * plus de gestes pour la même phrase.
 */
function HistoryRow({ label, value, date }: { label: string; value: string; date: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${date}, ${value}`} style={styles.historyRow}>
      <Text style={styles.historyLabel}>{label}</Text>
      <Text style={styles.historyValue} numberOfLines={1}>
        {value}
      </Text>
      <View style={styles.spacer} />
      <Text style={styles.historyDate}>{date}</Text>
    </View>
  );
}

/**
 * Ce qui a été fait la dernière fois, en **une ligne**.
 *
 * Les séries arrivent déjà condensées par le serveur (les consécutives identiques
 * fusionnent, `count`), donc trois séries de 8 à 80 kg tiennent en un segment. La
 * charge se factorise quand elle est la même partout — le cas courant — et rejoint
 * la fin de la ligne : « 2 × 8 reps, 1 × 6 reps · 80 kg » plutôt que la répéter
 * deux fois. Quand elle varie, chaque segment porte la sienne.
 *
 * L'échauffement n'y est pas : le serveur ne compte que les séries de travail
 * (`PerformanceHistory`), ici comme dans le tonnage et les records.
 */
function performanceSummary(session: PerformanceSession): string {
  if (session.sets.length === 0) {
    // Ne devrait pas arriver — une performance sans série n'en est pas une — mais
    // le nombre de séries de travail est toujours là et se lit tout seul.
    return `${session.workingSets} série${session.workingSets > 1 ? 's' : ''}`;
  }

  const loads = new Set(session.sets.map((group) => group.weightKg));
  const shared = loads.size === 1 ? session.sets[0].weightKg : null;
  const segments = session.sets.map((group) => {
    const effort = setEffort(group.reps, group.durationSeconds) ?? 'série';
    const repeated = group.count > 1 ? `${group.count} × ${effort}` : effort;

    return shared === null && group.weightKg !== null
      ? `${repeated} · ${weight(group.weightKg)}`
      : repeated;
  });
  const body = segments.join(', ');

  return shared !== null ? `${body} · ${weight(shared)}` : body;
}

/** Le record : la série la plus lourde. Il a toujours des kilos, par définition. */
function bestSummary(best: PerformanceBest): string {
  const effort = setEffort(best.reps, best.durationSeconds);

  return effort === null ? weight(best.weightKg) : `${effort} · ${weight(best.weightKg)}`;
}

/**
 * La date d'un point d'historique, relative aux deux jours qui comptent.
 *
 * « Aujourd'hui » lève l'ambiguïté du seul cas trompeur : une séance poussée puis
 * redescendue dans la journée fait de « la dernière fois » ce qu'on vient de
 * faire. Au-delà d'hier, le quantième est plus parlant qu'un décompte de jours —
 * on se souvient d'un jeudi, pas d'un « il y a 9 jours ».
 */
function performanceDate(date: string, today: string): string {
  switch (dayOffset(date, today)) {
    case 0:
      return "aujourd'hui";
    case -1:
      return 'hier';
    default:
      return shortDate(date);
  }
}

/**
 * La pastille de type de série, sur les deux axes du design system : **encre ou
 * rouge**, **plein ou contour**. L'encre pour ce qui structure la série
 * (échauffement, dégressive), le rouge pour ce qui la pousse (échec, drop set) ;
 * plein pour le travail effectif, contour sinon. `normal` n'a pas de pastille —
 * une série de travail ordinaire est la référence, la marquer reviendrait à
 * marquer tout le tableau.
 */
const SET_BADGES: Record<SetType, { ink: string; tint: string }> = {
  warmup: { ink: colors.setWarmup, tint: colors.setWarmupTint },
  normal: { ink: colors.text, tint: 'transparent' },
  degressive: { ink: colors.setDegressive, tint: colors.setDegressiveTint },
  to_failure: { ink: colors.setFailure, tint: colors.setFailureTint },
  drop_set: { ink: colors.setDropset, tint: colors.setDropsetTint },
};

/**
 * Une série : une ligne, une case.
 *
 * **Deux états, deux gestes** (KL-30). Tant qu'elle n'est pas faite, la ligne
 * entière coche : on la vise avec un pouce moite, à bout de bras, entre deux
 * séries. Une fois faite, elle se scinde en deux cibles — la zone de valeurs
 * ouvre l'ajustement, la case décoche — chacune au plancher tactile. C'est ce qui
 * évite l'appui long, qui ne se voit nulle part.
 *
 * **Pas de glyphe** : le projet n'embarque pas de jeu d'icônes (KL-23), et un « ✓ »
 * dépendrait de ce que Barlow contient. Une case pleine à l'encre dit la même
 * chose et ne peut pas manquer.
 */
function SetRow({
  line,
  editable,
  onToggle,
  onAdjust,
}: {
  line: SessionSetLine;
  editable: boolean;
  onToggle: () => void;
  onAdjust: () => void;
}) {
  const checked = line.logged !== null;
  const values = line.logged ?? line.planned;
  const effort = values ? setEffort(values.reps, values.durationSeconds) : null;
  const load = values?.weightKg ?? null;
  const actionable = editable && (line.actionable || line.undoable);

  const body = (
    <>
      <Text style={[styles.setRank, checked && styles.setRankChecked]}>
        {String(line.index).padStart(2, '0')}
      </Text>

      {/* Le sigle du type, dans une gouttière de largeur fixe : les lignes
          restent alignées qu'elles soient qualifiées ou non. */}
      <View style={styles.setBadgeSlot}>
        <SetBadge type={line.type} />
      </View>

      <Text style={[styles.setEffort, !checked && !actionable && styles.setFaint]}>
        {effort ?? '—'}
      </Text>
      {/* Le prévu reste à côté du saisi dès qu'ils divergent : c'est l'écart, et
          c'est la seule chose que la ligne ne peut pas se permettre de taire. */}
      {setDeviates(line, 'reps') || setDeviates(line, 'durationSeconds') ? (
        <Text style={styles.setPlanned}>
          {setEffort(line.planned?.reps ?? null, line.planned?.durationSeconds ?? null)}
        </Text>
      ) : null}

      <View style={styles.spacer} />

      <Text style={[styles.setLoad, !checked && !actionable && styles.setFaint]}>
        {load !== null ? weight(load) : ''}
      </Text>
      {setDeviates(line, 'weightKg') ? (
        <Text style={styles.setPlanned}>{weight(line.planned?.weightKg ?? 0)}</Text>
      ) : null}
    </>
  );

  // Ligne faite : deux cibles. La zone de valeurs ajuste, la case décoche — et
  // elle ne décoche que la dernière de sa file (l'appariement par rang, KL-29).
  if (checked) {
    return (
      <View style={[styles.setRow, styles.setRowChecked]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${setRowLabel(line, effort, load)}. Ajuster`}
          accessibilityHint="Corriger les valeurs, ou supprimer cette série"
          disabled={!editable}
          onPress={onAdjust}
          style={({ pressed }) => [styles.setValues, pressed && editable && styles.setRowPressed]}
        >
          {body}
        </Pressable>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: true, disabled: !actionable }}
          accessibilityLabel="Annuler cette série"
          accessibilityHint={
            actionable ? undefined : 'Seule la dernière série faite peut être annulée'
          }
          disabled={!actionable}
          onPress={onToggle}
          style={({ pressed }) => [styles.boxTarget, pressed && actionable && styles.setRowPressed]}
        >
          <View style={[styles.box, styles.boxChecked]} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: false, disabled: !actionable }}
      accessibilityLabel={setRowLabel(line, effort, load)}
      accessibilityHint={
        actionable
          ? 'Consigner cette série'
          : // Dire *pourquoi* la ligne ne répond pas : sans ça, un appui sans
            // effet passe pour un écran figé.
            'La série précédente n’est pas encore faite'
      }
      disabled={!actionable}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.setRow,
        styles.setRowPadded,
        pressed && actionable && styles.setRowPressed,
      ]}
    >
      {body}
      <View style={[styles.box, !actionable && styles.boxIdle]} />
    </Pressable>
  );
}

/** Le sigle W / D / F / DS. Rien pour une série de travail ordinaire. */
function SetBadge({ type }: { type: SetType }) {
  const letter = setTypeLetter(type);
  const skin = SET_BADGES[type];

  if (!letter) {
    return null;
  }

  return (
    <View style={[styles.setBadge, { borderColor: skin.ink, backgroundColor: skin.tint }]}>
      <Text style={[styles.setBadgeText, { color: skin.ink }]}>{letter}</Text>
    </View>
  );
}

/**
 * Un exercice cardio : lecture seule, coché fait ou pas fait.
 *
 * Pas de saisie de distance, d'allure ni de durée — règle verrouillée, Strava
 * couvre le cardio. Ce qui s'affiche est `summary`, la seule chaîne pré-formatée
 * de l'API : on la peint, on ne la relit pas.
 */
function CardioRow({
  exercise,
  editable,
  onPress,
}: {
  exercise: SessionExercise;
  editable: boolean;
  onPress: () => void;
}) {
  const checked = exercise.logged !== null;
  const summary = exercise.prescribed?.summary ?? exercise.name;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !editable }}
      accessibilityLabel={`${summary}. ${checked ? 'Fait' : 'Pas encore fait'}`}
      disabled={!editable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.setRow,
        styles.setRowPadded,
        checked && styles.setRowChecked,
        pressed && editable && styles.setRowPressed,
      ]}
    >
      <Text style={[styles.setEffort, !checked && !editable && styles.setFaint]}>{summary}</Text>
      <View style={styles.spacer} />
      <Text style={styles.caption}>{checked ? 'Fait' : 'À faire'}</Text>
      <View style={[styles.box, checked && styles.boxChecked, !editable && styles.boxIdle]} />
    </Pressable>
  );
}

/**
 * La feuille d'ajustement d'une série (KL-30).
 *
 * Le prescrit est en tête, jamais remplacé par ce qu'on saisit : c'est la
 * dernière case du ticket, et c'est la seule façon de voir l'écart au moment où
 * on le crée.
 *
 * **Zéro veut dire « rien à dire », pas « zéro »**. Le compteur ne sait pas
 * représenter l'absence, et une série au poids du corps n'a pas de charge — la
 * distinction se perdrait dans un champ vide. Une série à 0 répétition n'existe
 * pas de toute façon : elle se supprime.
 *
 * **Le type de série ne s'édite pas** : il décide de la file d'appariement, le
 * changer déplacerait le rang de toutes les suivantes (`deviations.ts`).
 */
function SetSheet({
  scheduledUuid,
  exercise,
  line,
  onClose,
}: {
  scheduledUuid: string;
  exercise: SessionExercise;
  line: SessionSetLine;
  onClose: () => void;
}) {
  const logged = line.logged;
  // La feuille s'ouvre sur ce qui est consigné et n'écoute plus la base ensuite :
  // une saisie en cours ne doit pas être réécrite sous les doigts. Elle est
  // rendue par une clé (`openSet`), donc remontée si la série change d'identité.
  const [values, setValues] = useState<LoggedSetValues>(() => ({
    reps: logged?.reps ?? null,
    weightKg: logged?.weightKg ?? null,
    durationSeconds: logged?.durationSeconds ?? null,
    rpe: logged?.rpe ?? null,
  }));

  // Reps ou durée : ce que la série porte, à défaut ce que le prescrit demandait.
  // Jamais les deux — un exercice se compte en répétitions ou en secondes.
  const timed =
    (logged?.durationSeconds ?? line.planned?.durationSeconds ?? null) !== null &&
    (logged?.reps ?? line.planned?.reps ?? null) === null;

  const patch = (part: Partial<LoggedSetValues>) =>
    setValues((current) => ({ ...current, ...part }));
  const zeroToNull = (value: number) => (value > 0 ? value : null);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Série ${String(line.index).padStart(2, '0')}`}
      footer={
        <View style={styles.sheetActions}>
          <Button
            label="Supprimer"
            variant="ghost"
            accessibilityHint="Cette série n’a finalement pas été faite"
            onPress={() => {
              deleteSet(scheduledUuid, exercise, line);
              onClose();
            }}
          />
          <View style={styles.spacer} />
          <Button
            label="Valider"
            onPress={() => {
              updateSet(scheduledUuid, line, values);
              onClose();
            }}
          />
        </View>
      }
    >
      <Text style={styles.caption}>
        {exercise.name}
        {' · '}
        {line.planned
          ? `prévu ${plannedSummary(line, exercise)}`
          : 'série hors programme, rien à comparer'}
      </Text>

      {timed ? (
        <NumberStepper
          label="Durée"
          value={values.durationSeconds ?? 0}
          onChange={(next) => patch({ durationSeconds: zeroToNull(next) })}
          step={5}
          max={86_400}
          unit="s"
        />
      ) : (
        <NumberStepper
          label="Répétitions"
          value={values.reps ?? 0}
          onChange={(next) => patch({ reps: zeroToNull(next) })}
          step={1}
          max={200}
          unit="reps"
        />
      )}

      <NumberStepper
        label="Charge"
        value={values.weightKg ?? 0}
        onChange={(next) => patch({ weightKg: zeroToNull(next) })}
        max={1000}
        unit="kg"
      />

      <NumberStepper
        label="RPE ressenti"
        value={values.rpe ?? 0}
        onChange={(next) => patch({ rpe: zeroToNull(next) })}
        step={1}
        max={10}
      />
      <Text style={styles.caption}>RPE à 0 : non renseigné. Le prescrit garde le sien.</Text>
    </Sheet>
  );
}

/**
 * La feuille d'un exercice : sauter, annoter, remplacer, retirer (KL-30).
 *
 * Sauter et annoter sont **un seul enregistrement** — le modèle n'a qu'un champ
 * `notes`, qui sert de raison quand l'exercice est sauté. Deux boutons de
 * validation pour deux champs de la même ligne auraient produit deux mutations
 * pour un seul geste.
 */
function ExerciseSheet({
  scheduledUuid,
  exercise,
  onClose,
  onReplace,
}: {
  scheduledUuid: string;
  exercise: SessionExercise;
  onClose: () => void;
  onReplace: (key: string) => void;
}) {
  const [skipped, setSkipped] = useState(exercise.skipped);
  const [notes, setNotes] = useState(exercise.logged?.notes ?? '');
  const replaceable = canReplaceExercise(exercise);
  const removable = exercise.prescribed === null;

  const apply = () => setExerciseState(scheduledUuid, exercise, { skipped, notes });

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Ajuster l’exercice"
      footer={
        <Button
          label="Valider"
          block
          onPress={() => {
            apply();
            onClose();
          }}
        />
      }
    >
      <Text style={styles.name}>{exercise.name}</Text>

      <Button
        label={skipped ? 'Ne plus sauter' : 'Sauter cet exercice'}
        variant="secondary"
        block
        accessibilityHint={
          skipped
            ? 'Le remettre dans la séance'
            : 'Il est déclaré non fait, avec sa raison si tu en donnes une'
        }
        onPress={() => setSkipped((current) => !current)}
      />

      <Field
        label={skipped ? 'Raison' : 'Note'}
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder={
          skipped ? 'Machine occupée, douleur…' : 'Ce qu’il faut retenir de cet exercice'
        }
        hint="Elle part avec la séance et se lit sur le web."
      />

      <Button
        label="Remplacer par un autre exercice"
        variant="secondary"
        block
        disabled={!replaceable}
        accessibilityHint={
          replaceable
            ? 'Choisir dans la bibliothèque, le lien au programme est conservé'
            : 'Impossible : des séries sont déjà consignées ici'
        }
        onPress={() => {
          // L'état en cours est enregistré avant de partir : la note tapée juste
          // avant ne doit pas se perdre au passage d'une feuille à l'autre.
          apply();
          onReplace(exercise.key);
        }}
      />

      {!replaceable && exercise.prescribed !== null ? (
        <Text style={styles.caption}>
          Des séries sont déjà consignées sur cet exercice : elles ont été faites ici. Pour
          continuer sur une autre machine, saute celui-ci et ajoute l’autre hors programme.
        </Text>
      ) : null}

      {removable ? (
        <Button
          label="Retirer cet exercice"
          variant="ghost"
          block
          onPress={() =>
            Alert.alert(
              'Retirer cet exercice ?',
              'Ses séries consignées seront supprimées de la séance.',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Retirer',
                  style: 'destructive',
                  onPress: () => {
                    removeExercise(scheduledUuid, exercise);
                    onClose();
                  },
                },
              ],
            )
          }
        />
      ) : null}
    </Sheet>
  );
}

/**
 * Le sélecteur d'exercice de la bibliothèque locale (KL-30, facettes en KL-34).
 *
 * **Local, comme tout le reste** : la bibliothèque est descendue par le bootstrap,
 * choisir un exercice ne demande pas de réseau. La recherche replie les accents
 * (`session/library.ts`) — « developpe » doit trouver « Développé couché », et le
 * `LIKE` de SQLite ne le ferait pas.
 *
 * ## Deux rangées de facettes, et pourquoi elles défilent
 *
 * KL-34 les demande parce que la séance vierge pose une autre question que la
 * séance programmée : là on cherche un exercice précis, ici on cherche **quoi
 * faire**. Le champ répond à la première, les facettes à la seconde.
 *
 * Elles défilent horizontalement plutôt que de passer à la ligne. Dix-sept zones
 * enroulées, au plancher tactile de 44 points, mangeraient quatre lignes de
 * feuille — donc la liste de résultats, qui est ce qu'on est venu voir. Le prix
 * est connu : ce qui dépasse à droite ne se voit pas. Il est payable parce que
 * les rangées sont **ordonnées** (`library.ts`) et **réduites à ce que la
 * bibliothèque porte vraiment**, donc courtes en pratique.
 *
 * La rangée des zones ne se rend qu'à partir de deux : une facette qui n'offre
 * qu'un choix ne filtre rien, elle occupe la place.
 */
function ExercisePicker({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (reference: ExerciseRef) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [area, setArea] = useState<TargetArea | null>(null);
  const { results, activities, areas } = useExerciseLibrary(term, activity, area);

  // Changer d'activité **relâche toujours la zone**. Une zone survit rarement au
  // changement — la rangée est cadrée sur l'activité retenue (`hooks.ts`), et
  // « Pectoraux » n'existe pas en course à pied. La garder quand elle disparaît
  // de la rangée laisserait un filtre actif que plus rien ne permet de défaire,
  // devant une liste vide sans raison visible. La relâcher au cas par cas
  // demanderait de connaître les zones de l'activité *suivante*, que le rendu en
  // cours n'a pas encore : mieux vaut une règle qu'on peut énoncer.
  const chooseActivity = (next: ActivityType | null) => {
    setActivity(next);
    setArea(null);
  };

  const filtered = activity !== null || area !== null;

  return (
    <Sheet visible onClose={onClose} title={title}>
      <Field
        label="Chercher"
        value={term}
        onChangeText={setTerm}
        autoFocus
        autoCorrect={false}
        placeholder="Développé, squat, tirage…"
      />

      {activities.length > 1 ? (
        <FacetRow label="Activité">
          <FilterChip
            label="Toutes"
            selected={activity === null}
            accessibilityHint="Ne pas filtrer par activité"
            onPress={() => chooseActivity(null)}
          />
          {activities.map((value) => (
            <FilterChip
              key={value}
              label={activityLabel(value)}
              selected={activity === value}
              onPress={() => chooseActivity(activity === value ? null : value)}
            />
          ))}
        </FacetRow>
      ) : null}

      {areas.length > 1 ? (
        <FacetRow label="Zone">
          <FilterChip
            label="Toutes"
            selected={area === null}
            accessibilityHint="Ne pas filtrer par zone travaillée"
            onPress={() => setArea(null)}
          />
          {areas.map((value) => (
            <FilterChip
              key={value}
              label={targetAreaLabel(value)}
              selected={area === value}
              onPress={() => setArea(area === value ? null : value)}
            />
          ))}
        </FacetRow>
      ) : null}

      {results.length === 0 ? (
        // Distinguer les deux vides : une facette trop serrée se desserre, une
        // bibliothèque incomplète attend une synchronisation. Sans ça, on cherche
        // la panne du mauvais côté. Et quand ce sont les facettes, l'état vide
        // porte le geste qui en sort — les relâcher demanderait sinon de
        // retrouver deux puces actives dans deux rangées qui défilent (KL-38).
        <EmptyState
          compact
          title="Aucun exercice"
          hint={
            filtered
              ? 'Rien ne correspond à ces filtres. Élargis l’activité ou la zone.'
              : 'Rien ne correspond à cette recherche. La bibliothèque du téléphone est celle du dernier bootstrap.'
          }
          action={
            filtered
              ? {
                  label: 'Relâcher les filtres',
                  onPress: () => {
                    setActivity(null);
                    setArea(null);
                  },
                }
              : undefined
          }
        />
      ) : (
        results.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={`${option.name}, ${activityLabel(option.activity)}`}
            onPress={() => onPick({ id: option.id, name: option.name })}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.name}>{option.name}</Text>
            <View style={styles.spacer} />
            {option.global ? null : <Chip label="Perso" />}
            {/* L'activité est une **catégorie** : elle se code par son rang dans
                l'échelle de gris, jamais par une teinte (règle 2). Elle se lit
                surtout quand on parcourt la liste sans avoir rien tapé. */}
            <Chip label={activityLabel(option.activity)} rank={ACTIVITY_RANKS[option.activity]} />
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

/**
 * Le rang catégoriel d'une activité, transposé de `_activity.html.twig` et de
 * `--color-activity-*` : course 1, muscu 2, natation et vélo 3, mobilité 4.
 *
 * « Autre » n'en a pas — le web non plus (son modificateur y est vide) : c'est
 * l'absence de catégorie, la marquer d'un rang lui en inventerait une.
 */
const ACTIVITY_RANKS: Record<ActivityType, ChipRank | undefined> = {
  running: 1,
  gym: 2,
  swimming: 3,
  cycling: 3,
  mobility: 4,
  other: undefined,
};

/** Une rangée de facettes : son intitulé, et ses pilules qui défilent (KL-34). */
function FacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.facets}>
      <Text style={styles.facetLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Sans lui, la rangée mange le geste vertical de la feuille dès qu'elle
        // est arrivée en bout de course.
        overScrollMode="never"
        contentContainerStyle={styles.facetRow}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** « 8 reps × 80 kg », tel que le prescrit le demandait. */
function plannedSummary(line: SessionSetLine, exercise: SessionExercise): string {
  const planned = line.planned;

  if (planned === null) {
    return exercise.name;
  }

  const effort =
    setEffort(planned.reps, planned.durationSeconds) ??
    (planned.durationSeconds !== null ? duration(planned.durationSeconds) : 'série');

  return planned.weightKg !== null ? `${effort} × ${weight(planned.weightKg)}` : effort;
}

/** Ce que TalkBack annonce sur une ligne de série. Le rang d'abord : c'est le repère. */
function setRowLabel(line: SessionSetLine, effort: string | null, load: number | null): string {
  const parts = [`Série ${line.index}`];
  const type = setTypeLabel(line.type);

  if (type) {
    parts.push(type);
  }
  if (effort) {
    parts.push(effort);
  }
  if (load !== null) {
    parts.push(weight(load));
  }

  return parts.join(', ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8], paddingBottom: space[13] },
  spacer: { flex: 1 },

  name: { ...text.name, color: colors.text, flexShrink: 1 },
  body: { ...text.body, color: colors.textSecondary },
  caption: { ...text.caption, color: colors.textFaint },
  notes: { ...text.caption, color: colors.textSecondary, marginBottom: space[3] },
  // La note de la salle se distingue de la consigne par un filet, pas par une
  // couleur : il n'y a qu'une couleur dans cette identité, et elle est prise.
  logNotes: {
    ...text.caption,
    color: colors.textSecondary,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: space[4],
    marginTop: space[4],
  },

  summary: {
    gap: space[3],
    paddingHorizontal: space[8],
    paddingVertical: space[6],
    backgroundColor: colors.surfaceRaised,
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },

  progress: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  progressTrack: { flex: 1, height: 4, backgroundColor: colors.track },
  // Encre et non rouge : le rouge dit l'action à faire et l'échec, pas l'avancement.
  progressFill: { height: 4, backgroundColor: colors.text },
  progressLabel: { ...text.numeric, color: colors.textSecondary },

  notice: {
    gap: space[6],
    padding: space[8],
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.border,
  },

  block: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.border,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[7],
    paddingVertical: space[5],
    backgroundColor: colors.fill,
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },
  blockNumber: { ...text.numeric, color: colors.textFaint },
  blockRole: { ...text.sectionTitle, color: colors.text },
  blockLabel: { ...text.caption, color: colors.textFaint, flexShrink: 1 },
  blockCount: { ...text.numeric, color: colors.textSecondary },

  // Le groupe se marque au rail, pas au conteneur : il n'en a pas dans le modèle.
  group: {
    borderLeftWidth: 3,
    borderLeftColor: colors.cat1,
    marginLeft: space[7],
    marginVertical: space[4],
    paddingLeft: space[5],
  },
  groupHead: { ...text.eyebrow, color: colors.textFaint, paddingVertical: space[3] },

  exercise: { paddingHorizontal: space[7], paddingVertical: space[6] },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  exerciseCount: { ...text.numeric, color: colors.textSecondary },
  // Le rang dans le superset, en mono : il se compare, il ne se lit pas.
  rank: { ...text.eyebrow, color: colors.text },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[2] },

  // L'historique (KL-32) : deux lignes de texte, sans peau propre. Un fond ou un
  // filet en ferait une ligne de série de plus, à un endroit où on appuie.
  history: { gap: space[1], marginTop: space[4] },
  // `center` et non `baseline`, comme partout ailleurs dans cet écran : la ligne
  // porte un séparateur souple, et une vue sans contenu n'a pas de ligne de base.
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  historyLabel: { ...text.eyebrow, color: colors.textFaint },
  // En mono comme les charges de la séance : c'est la même grandeur, lue au même
  // moment, et elle doit se comparer d'un coup d'œil à la ligne d'en dessous.
  historyValue: { ...text.numeric, color: colors.textSecondary, flexShrink: 1 },
  historyDate: { ...text.caption, color: colors.textFaint },

  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.touchTarget,
    marginTop: space[3],
    borderWidth: layout.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Une ligne non cochée est une seule cible : le rembourrage est sur elle. Une
  // ligne cochée en porte deux, chacune avec le sien (§ deux gestes).
  setRowPadded: { gap: space[4], paddingHorizontal: space[4] },
  // Une série faite se pose sur un fond appuyé et garde son filet : elle ne
  // disparaît pas, elle se range.
  setRowChecked: { backgroundColor: colors.fill, borderColor: colors.borderStrong },
  setRowPressed: { backgroundColor: colors.surfaceHover },
  setValues: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: layout.touchTarget,
    paddingLeft: space[4],
    paddingRight: space[3],
  },
  setRank: { ...text.numeric, color: colors.textFaint, width: 24 },
  setRankChecked: { color: colors.textSecondary },
  setEffort: { ...text.numeric, color: colors.text },
  setLoad: { ...text.numeric, color: colors.text },
  setFaint: { color: colors.textFaint },
  // Le prévu, à côté du saisi. Atténué et plus petit : il est le repère, pas la
  // valeur — celle qui compte est ce qui a été fait.
  setPlanned: { ...text.caption, color: colors.textFaint },

  setBadgeSlot: { width: 22, alignItems: 'center' },
  // Couleur et fond viennent du type (`SET_BADGES`) : ici la forme seulement.
  setBadge: { borderWidth: layout.hairline, paddingHorizontal: space[1] },
  setBadgeText: { ...text.eyebrow },

  // La case d'une ligne cochée est une cible à part entière : elle porte donc son
  // propre plancher tactile, pas seulement la taille du carré dessiné.
  boxTarget: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
  },
  boxChecked: { borderColor: colors.text, backgroundColor: colors.text },
  boxIdle: { borderColor: colors.borderMuted },

  // La barre de repos : posée sur le bas de l'écran, filet en tête, fond appuyé.
  // Elle ne flotte pas (aucune ombre dans cette identité), elle s'ancre.
  rest: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.borderStrong,
  },
  restTrack: { height: 4, backgroundColor: colors.track },
  restFill: { height: 4, backgroundColor: colors.text },
  restBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[8],
    paddingTop: space[5],
  },
  restLabels: { flex: 1, gap: space[1] },
  restTitle: { ...text.sectionTitle, color: colors.text },
  // Le chrono en grand, tabulaire : il se lit posé sur le banc, à un mètre.
  restClock: { ...text.kpi, color: colors.text },
  // Le rouge à l'échéance seulement, et c'est bien son emploi : ce n'est pas une
  // catégorie qu'on colore, c'est l'appel à reprendre la série (§5 règle 2).
  restClockOver: { color: colors.primary },
  // `paddingBottom` posé au point d'usage : il compte la zone sûre du bas.
  restActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[8],
  },

  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: space[4] },

  // Les facettes du sélecteur (KL-34). Le `gap` de la feuille sépare déjà les
  // deux rangées : ici seulement l'intitulé et ses pilules.
  facets: { gap: space[2] },
  facetLabel: { ...text.eyebrow, color: colors.textFaint },
  // Sur le `contentContainerStyle` et non sur le `ScrollView` : un `gap` posé
  // sur le conteneur défilant lui-même ne s'applique pas à son contenu.
  facetRow: { flexDirection: 'row', gap: space[3], paddingRight: space[8] },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: layout.touchTarget,
    paddingHorizontal: space[5],
    borderWidth: layout.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionPressed: { backgroundColor: colors.fill },
});
