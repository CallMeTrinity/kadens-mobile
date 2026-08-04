import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, EmptyState, Header, setEffort, weight } from '@/components';
import {
  beginWorkout,
  blockRoleLabel,
  checkSet,
  longDate,
  setCardioDone,
  setTypeLabel,
  setTypeLetter,
  uncheckSet,
  useSessionProgram,
  useWorkout,
  useWorkoutPendingSync,
  type SessionBlock,
  type SessionExercise,
  type SessionExtra,
  type SessionGroup,
  type SessionSetLine,
} from '@/session';
import { colors, layout, space, text } from '@/theme';
import type { SetType } from '@/db';

/**
 * Écran « Séance en cours » (KL-29) — l'écran pour lequel toute l'app existe.
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
 *    (`@/session`, `log.ts`). Rien n'est mis de côté pour être écrit « à la fin ».
 * 3. **Une seule mutation par séance.** La file est coalescée par uuid et ne porte
 *    que l'uuid, le document se relisant au push : trente séries cochées ne font
 *    qu'un envoi.
 *
 * ## Ce que l'écran ne fait pas, et à quel ticket ça revient
 *
 * Corriger un poids, ajouter ou retirer une série, sauter ou remplacer un
 * exercice : **KL-30**. Le timer de repos et la veille écran : **KL-31**. La
 * dernière perf et le record sous chaque exercice : **KL-32**. Clôturer :
 * **KL-33**. Rien de tout ça n'est esquissé — une demi-implémentation serait à
 * défaire.
 *
 * ## Cocher est séquentiel, et ce n'est pas une contrainte d'écran
 *
 * Seule la prochaine série de sa file est cochable, seule la dernière cochée se
 * décoche. La raison est dans le contrat, pas dans l'ergonomie : rien ne relie une
 * série réalisée à une ligne prescrite, l'appariement se fait au rang, et un
 * « trou » ne survivrait pas à un aller-retour serveur. Le raisonnement complet
 * est dans `session/program.ts`.
 */
export default function SessionScreen() {
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const workout = useWorkout(uuid);
  const program = useSessionProgram(uuid);
  const pendingSync = useWorkoutPendingSync(uuid);

  const running = workout ? workout.startedAt !== null && workout.endedAt === null : false;

  // On ne consigne que dans une séance ouverte. Une séance close est close
  // (§2.3 point 5) ; une séance jamais commencée n'a pas d'heure de début, et un
  // réalisé sans borne de départ serait une séance qu'on n'a pas faite.
  const onCheck = useCallback(
    (exercise: SessionExercise, line: SessionSetLine) => {
      if (line.actionable) {
        checkSet(uuid, exercise, line);
      } else if (line.undoable) {
        uncheckSet(uuid, exercise, line);
      }
    },
    [uuid],
  );

  const onCardio = useCallback(
    (exercise: SessionExercise) => setCardioDone(uuid, exercise, exercise.logged === null),
    [uuid],
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

      <ScrollView contentContainerStyle={styles.page}>
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
            onCheck={onCheck}
            onCardio={onCardio}
          />
        ))}

        {/* Du réalisé qu'aucune ligne du programme ne réclame. KL-29 n'en crée
            pas ; le pull, lui, peut en descendre, et du réalisé invisible serait
            la pire trahison de « rien n'est jamais perdu ». */}
        {program.extras.map((extra) => (
          <ExtraSection key={`x${extra.logged.id}`} extra={extra} />
        ))}

        {program.blocks.length === 0 ? (
          <EmptyState
            title={workout.freeform ? 'Séance libre, sans programme' : 'Aucun programme'}
            hint={
              workout.freeform
                ? 'Choisir des exercices au fil de la séance arrive avec un prochain lot.'
                : 'Le programme de cette séance n’est pas descendu. Une synchronisation le rapportera.'
            }
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Séries faites sur séries prévues.
 *
 * **Compte des gestes, pas du volume.** L'échauffement entre donc dans le total,
 * contrairement au tonnage et aux records où il est exclu partout : ce qui se lit
 * ici, c'est ce qu'il reste à faire, et un échauffement reste à faire. Un exercice
 * cardio compte pour une unité — il n'a qu'une chose à dire, fait ou pas fait — et
 * un exercice sauté sort du compte, puisqu'il est réglé.
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

/** Une section de la séance. Le bloc est une section, jamais un superset. */
function BlockSection({
  block,
  editable,
  onCheck,
  onCardio,
}: {
  block: SessionBlock;
  editable: boolean;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
}) {
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
        <GroupSection
          key={group.key}
          group={group}
          editable={editable}
          onCheck={onCheck}
          onCardio={onCardio}
        />
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
function GroupSection({
  group,
  editable,
  onCheck,
  onCardio,
}: {
  group: SessionGroup;
  editable: boolean;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
}) {
  const body = group.exercises.map((exercise) => (
    <ExerciseSection
      key={`e${exercise.prescribed.prescribedId}`}
      exercise={exercise}
      editable={editable}
      onCheck={onCheck}
      onCardio={onCardio}
    />
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

/** Un exercice du programme : son en-tête, sa consigne, ses séries. */
function ExerciseSection({
  exercise,
  editable,
  onCheck,
  onCardio,
}: {
  exercise: SessionExercise;
  editable: boolean;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
}) {
  const { prescribed } = exercise;

  return (
    <View style={styles.exercise}>
      <View style={styles.exerciseHead}>
        {prescribed.groupLabel ? <Text style={styles.rank}>{prescribed.groupLabel}</Text> : null}
        <Text style={styles.name}>{prescribed.name ?? 'Exercice retiré de la bibliothèque'}</Text>
        <View style={styles.spacer} />
        {exercise.skipped ? (
          <Chip label="Sauté" />
        ) : exercise.total > 0 ? (
          <Text style={styles.exerciseCount}>
            {exercise.done}/{exercise.total}
          </Text>
        ) : null}
      </View>

      <View style={styles.marks}>
        {prescribed.rpe !== null ? <Text style={styles.caption}>RPE {prescribed.rpe}</Text> : null}
        {prescribed.restSeconds !== null && prescribed.restSeconds > 0 ? (
          <Text style={styles.caption}>repos {prescribed.restSeconds} s</Text>
        ) : null}
      </View>

      {/* La consigne du programme, adressée à celui qui exécute. */}
      {prescribed.notes ? <Text style={styles.notes}>{prescribed.notes}</Text> : null}

      {exercise.lines === null ? (
        <CardioRow
          exercise={exercise}
          editable={editable && !exercise.skipped}
          onPress={() => onCardio(exercise)}
        />
      ) : (
        exercise.lines.map((line) => (
          <SetRow
            key={line.key}
            line={line}
            editable={editable && !exercise.skipped}
            onPress={() => onCheck(exercise, line)}
          />
        ))
      )}

      {/* Ce que l'athlète a écrit à la salle. Rien à voir avec la consigne. */}
      {exercise.logged?.notes ? <Text style={styles.logNotes}>{exercise.logged.notes}</Text> : null}
    </View>
  );
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
 * La ligne entière est la cible tactile (pas la seule case) : on la vise avec un
 * pouce moite, à bout de bras, entre deux séries. La case reste dessinée à droite
 * parce que c'est là qu'on la cherche.
 *
 * **Pas de glyphe** : le projet n'embarque pas de jeu d'icônes (KL-23), et un « ✓ »
 * dépendrait de ce que Barlow contient. Une case pleine à l'encre dit la même
 * chose et ne peut pas manquer.
 */
function SetRow({
  line,
  editable,
  onPress,
}: {
  line: SessionSetLine;
  editable: boolean;
  onPress: () => void;
}) {
  const checked = line.logged !== null;
  const values = line.logged ?? line.planned;
  const effort = values ? setEffort(values.reps, values.durationSeconds) : null;
  const load = values?.weightKg ?? null;
  const letter = setTypeLetter(line.type);
  const skin = SET_BADGES[line.type];
  const actionable = editable && (line.actionable || line.undoable);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !actionable }}
      accessibilityLabel={setRowLabel(line, effort, load)}
      accessibilityHint={
        actionable
          ? checked
            ? 'Annuler cette série'
            : 'Consigner cette série'
          : // Dire *pourquoi* la ligne ne répond pas : sans ça, un appui sans
            // effet passe pour un écran figé.
            checked
            ? 'Seule la dernière série faite peut être annulée'
            : 'La série précédente n’est pas encore faite'
      }
      disabled={!actionable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.setRow,
        checked && styles.setRowChecked,
        pressed && actionable && styles.setRowPressed,
      ]}
    >
      <Text style={[styles.setRank, checked && styles.setRankChecked]}>
        {String(line.index).padStart(2, '0')}
      </Text>

      {/* Le sigle du type, dans une gouttière de largeur fixe : les lignes
          restent alignées qu'elles soient qualifiées ou non. */}
      <View style={styles.setBadgeSlot}>
        {letter ? (
          <View style={[styles.setBadge, { borderColor: skin.ink, backgroundColor: skin.tint }]}>
            <Text style={[styles.setBadgeText, { color: skin.ink }]}>{letter}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.setEffort, !checked && !actionable && styles.setFaint]}>
        {effort ?? '—'}
      </Text>
      <View style={styles.spacer} />
      <Text style={[styles.setLoad, !checked && !actionable && styles.setFaint]}>
        {load !== null ? weight(load) : ''}
      </Text>

      <View
        style={[
          styles.box,
          checked && styles.boxChecked,
          !checked && !actionable && styles.boxIdle,
        ]}
      />
    </Pressable>
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

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !editable }}
      accessibilityLabel={`${exercise.prescribed.summary}. ${checked ? 'Fait' : 'Pas encore fait'}`}
      disabled={!editable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.setRow,
        checked && styles.setRowChecked,
        pressed && editable && styles.setRowPressed,
      ]}
    >
      <Text style={[styles.setEffort, !checked && !editable && styles.setFaint]}>
        {exercise.prescribed.summary}
      </Text>
      <View style={styles.spacer} />
      <Text style={styles.caption}>{checked ? 'Fait' : 'À faire'}</Text>
      <View style={[styles.box, checked && styles.boxChecked, !editable && styles.boxIdle]} />
    </Pressable>
  );
}

/**
 * Un exercice réalisé sans ligne du programme en face.
 *
 * En lecture stricte : le modifier depuis ici demanderait de savoir le
 * reconstruire, ce qui est le sujet de KL-30. L'afficher suffit à tenir « rien
 * n'est jamais perdu ».
 */
function ExtraSection({ extra }: { extra: SessionExtra }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Text accessibilityRole="header" style={styles.blockRole}>
          Hors programme
        </Text>
      </View>

      <View style={styles.exercise}>
        <View style={styles.exerciseHead}>
          <Text style={styles.name}>{extra.logged.exerciseName}</Text>
          <View style={styles.spacer} />
          {extra.logged.skipped ? <Chip label="Sauté" /> : null}
        </View>

        {extra.sets.map((set, index) => (
          <View key={set.uuid} style={[styles.setRow, styles.setRowChecked]}>
            <Text style={[styles.setRank, styles.setRankChecked]}>
              {String(index + 1).padStart(2, '0')}
            </Text>
            <View style={styles.setBadgeSlot} />
            <Text style={styles.setEffort}>{setEffort(set.reps, set.durationSeconds) ?? '—'}</Text>
            <View style={styles.spacer} />
            <Text style={styles.setLoad}>{set.weightKg !== null ? weight(set.weightKg) : ''}</Text>
            <View style={[styles.box, styles.boxChecked]} />
          </View>
        ))}

        {extra.logged.notes ? <Text style={styles.logNotes}>{extra.logged.notes}</Text> : null}
      </View>
    </View>
  );
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

  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: layout.touchTarget,
    marginTop: space[3],
    paddingHorizontal: space[4],
    borderWidth: layout.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Une série faite se pose sur un fond appuyé et garde son filet : elle ne
  // disparaît pas, elle se range.
  setRowChecked: { backgroundColor: colors.fill, borderColor: colors.borderStrong },
  setRowPressed: { backgroundColor: colors.surfaceHover },
  setRank: { ...text.numeric, color: colors.textFaint, width: 24 },
  setRankChecked: { color: colors.textSecondary },
  setEffort: { ...text.numeric, color: colors.text },
  setLoad: { ...text.numeric, color: colors.text },
  setFaint: { color: colors.textFaint },

  setBadgeSlot: { width: 22, alignItems: 'center' },
  // Couleur et fond viennent du type (`SET_BADGES`) : ici la forme seulement.
  setBadge: { borderWidth: layout.hairline, paddingHorizontal: space[1] },
  setBadgeText: { ...text.eyebrow },

  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
  },
  boxChecked: { borderColor: colors.text, backgroundColor: colors.text },
  boxIdle: { borderColor: colors.borderMuted },
});
