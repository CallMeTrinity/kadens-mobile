import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
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
  Icon,
  NumberStepper,
  setEffort,
  Sheet,
  weight,
  type ChipRank,
} from '@/components';
import {
  activityLabel,
  addExercise,
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
  isClosed,
  isRunning,
  longDate,
  nextTarget,
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
  usePreferences,
  useRestTimer,
  useSessionHistory,
  useSessionProgram,
  useToday,
  useWorkout,
  useWorkoutPendingSync,
  withDraftSets,
  type ExerciseRef,
  type LoggedSetValues,
  type RestState,
  type SessionBlock,
  type SessionExercise,
  type SessionGroup,
  type SessionSetLine,
  type SessionTarget,
} from '@/session';
import { colors, layout, space, text, useReducedMotion } from '@/theme';
import {
  patchPreferences,
  type ActivityType,
  type ExerciseHistoryRow,
  type PerformanceBest,
  type PerformanceSession,
  type SetType,
  type TargetArea,
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
 * ## La barre d'action basse, et la série courante (KL-39)
 *
 * L'écran se tient **d'une main, debout**. La cible principale ne peut donc pas
 * être une ligne quelque part dans un déroulé de douze exercices : elle est
 * ancrée en bas, au pouce, et elle ne bouge pas. C'est le rôle de `SessionDock`,
 * qui empile ce qui vit en bas de cet écran — le repos quand il court, puis la
 * validation, toujours en dernier, donc toujours à la même distance du bord.
 *
 * Ce qu'elle propose est la **cible courante** (`nextTarget`, `@/session`) : la
 * première série cochable en descendant l'écran, l'alternance des membres d'un
 * superset en plus. Quand il n'y a plus rien à cocher, elle devient la porte de
 * la clôture. Deux conséquences :
 *
 * - la série courante ne se perd **jamais** — même déroulé jusqu'en bas, elle
 *   est écrite dans la barre, et le déroulé la rejoint tout seul quand elle
 *   change d'exercice (`useRevealTarget`) ;
 * - le bouton de clôture resté dans le fil du déroulé passe en **secondaire** :
 *   l'action primaire de l'écran est dans la barre, et il n'y en a qu'une.
 *
 * Les lignes restent cochables une par une, et c'est délibéré : la barre est le
 * chemin court du cas nominal, elle ne remplace pas la lecture d'un tableau —
 * un superset qu'on mène dans un autre ordre, une série qu'on rattrape.
 *
 * ## Les deux gestes, et pourquoi ils sont distincts (KL-30)
 *
 * Une ligne **non cochée** se coche d'un appui n'importe où : c'est le geste
 * nominal en salle, on fait ce qui est écrit. Une fois **cochée**, la ligne
 * devient un objet qu'on corrige : sa zone de valeurs ouvre la feuille
 * d'ajustement, sa case reste le décochage. Deux cibles dans une ligne plutôt
 * qu'un appui long, qui n'est visible nulle part et se découvre par accident.
 *
 * **Ajouter une série n'ouvre rien, et ne la coche pas** (KL-39, revu). Elle naît
 * pré-remplie par la précédente — ce qui est juste dans le cas courant — mais
 * **pas faite** : c'est une ligne cochable de plus, en attente comme les autres.
 * La version d'origine la consignait d'office, si bien qu'annoncer une série de
 * plus revenait à déclarer l'avoir faite, et le repos partait avant l'effort. La
 * ligne se coche ensuite par le même geste que toutes les autres, à la ligne ou à
 * la barre basse, et rien ne va en base avant. Le brouillon vit donc ici, dans
 * l'écran (`drafts`), et se projette sur le déroulé par `withDraftSets`.
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
  const base = useSessionProgram(uuid);
  const pendingSync = useWorkoutPendingSync(uuid);
  // Les séries annoncées et pas encore faites, par clé d'exercice. En mémoire
  // seulement : une série non faite n'est ni du prescrit ni du réalisé, elle n'a
  // aucune colonne où s'écrire (`withDraftSets`).
  const [drafts, setDrafts] = useState<ReadonlySet<string>>(() => new Set());
  const program = useMemo(() => withDraftSets(base, drafts), [base, drafts]);
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
  const [dockHeight, setDockHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const running = workout ? isRunning(workout) : false;
  const rest = useRestTimer();
  // Lues en vif : la bascule de la barre basse et celle des réglages écrivent la
  // même ligne, et l'écran doit suivre l'une comme l'autre.
  const preferences = usePreferences();
  // Ce que la séance attend maintenant. C'est ce que la barre basse propose, et
  // ce que le déroulé garde en vue.
  const target = running ? nextTarget(program) : null;
  const { scrollRef, frameRef, targetRef, onScroll } = useRevealTarget(
    target?.exercise.key ?? null,
    { bottomInset: dockHeight },
  );

  // L'écran ne s'éteint pas pendant une séance en cours (KL-31). Conditionné, et
  // non `useKeepAwake()` : cet écran se monte aussi pour relire une séance close.
  useKeepScreenAwake(running);

  // La série annoncée est **consommée par la validation suivante**, quelle
  // qu'elle soit : cochée, elle devient du réalisé et la ligne repousse par le
  // bas ; décochée, l'exercice repart d'une ligne en attente et deux cibles
  // vaudraient une de trop. Une seule règle, donc aucune clé qui traîne.
  const dropDraft = useCallback((key: string) => {
    setDrafts((current) => {
      if (!current.has(key)) {
        return current;
      }

      const next = new Set(current);
      next.delete(key);

      return next;
    });
  }, []);

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
          dropDraft(exercise.key);
          startRestAfterSet(exercise);
        }
      } else if (line.undoable) {
        if (uncheckSet(uuid, exercise, line)) {
          dropDraft(exercise.key);
          stopRest();
        }
      }
    },
    [uuid, dropDraft],
  );

  const onCardio = useCallback(
    (exercise: SessionExercise) => setCardioDone(uuid, exercise, exercise.logged === null),
    [uuid],
  );

  // Ajouter une série **annonce**, elle ne consigne pas : la ligne apparaît en
  // attente, pré-remplie par la précédente, et rien ne part en base tant qu'elle
  // n'est pas cochée. Le repos non plus — il suit l'effort, pas l'intention.
  const onAddSet = useCallback(
    (exercise: SessionExercise) => setDrafts((current) => new Set(current).add(exercise.key)),
    [],
  );

  // La cible de la barre basse : le même geste que cocher la ligne, au pouce.
  const onValidate = useCallback(
    (pending: SessionTarget) => {
      if (pending.line === null) {
        setCardioDone(uuid, pending.exercise, true);

        return;
      }

      if (checkSet(uuid, pending.exercise, pending.line)) {
        dropDraft(pending.exercise.key);
        startRestAfterSet(pending.exercise);
      }
    },
    [uuid, dropDraft],
  );

  // Le sélecteur rend **une liste** : garnir une séance vierge, c'est y poser
  // cinq exercices d'affilée, et rouvrir la feuille entre chacun est cinq fois
  // la même recherche. Le remplacement, lui, n'en accepte qu'un — deux
  // exercices ne remplacent pas une ligne du programme.
  const onPick = useCallback(
    (target: PickerTarget, references: ExerciseRef[]) => {
      if (target.mode === 'add') {
        // La position se relit en base à chaque insertion (`nextExercisePosition`) :
        // la liste garde son ordre, du premier choisi au dernier.
        for (const reference of references) {
          addExercise(uuid, reference, program.prescribedCount);
        }
      } else {
        const exercise = findExercise(program, target.exerciseKey);
        const reference = references[0];

        if (exercise && reference) {
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

  const closed = isClosed(workout);
  // Fermée sans jamais avoir tourné ici : elle a été cochée « faite » sur le web.
  // Il n'y a donc ni durée, ni série, ni écart à résumer — l'écran se lit, il ne
  // se clôture pas.
  const closedElsewhere = closed && workout.endedAt === null;
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
        Le dégagement sous la page est la hauteur **mesurée** de la barre basse,
        pas une valeur devinée : elle change avec le repos qui s'y ajoute, avec
        la longueur d'un nom d'exercice et avec la taille de police du système,
        et un nombre écrit à la main finirait par masquer la dernière série
        cochée — c'est-à-dire exactement celle qu'on vient de faire.

        Sans barre, c'est la barre gestuelle Android qu'il faut dégager (KL-37) :
        cet écran est empilé par-dessus la barre d'onglets, rien ne le protège du
        bord. Avec elle, la mesure **contient déjà** la zone sûre, que la barre
        prend en rembourrage — l'ajouter ici la compterait deux fois.
      */}
      {/* La fenêtre de lecture : c'est elle que `useRevealTarget` mesure pour
          savoir si la série courante est encore dedans. */}
      <View ref={frameRef} style={styles.frame}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[
            styles.page,
            dockHeight > 0
              ? { paddingBottom: dockHeight + space[13] }
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

          {/* Sans ce mot, l'absence de bouton se lirait comme une panne : le
              programme est là, la séance est datée, et rien ne se coche. */}
          {closedElsewhere ? (
            <View style={styles.notice}>
              <Text style={styles.body}>
                Séance déjà déclarée faite. Elle se relit, elle ne se consigne plus.
              </Text>
            </View>
          ) : null}

          {program.blocks.map((block) => (
            <BlockSection
              key={block.key}
              block={block}
              editable={running}
              history={history}
              today={today}
              targetKey={target?.exercise.key ?? null}
              targetRef={targetRef}
              onCheck={onCheck}
              onCardio={onCardio}
              onAdjustSet={setOpenSet}
              onAddSet={onAddSet}
              onDropSet={dropDraft}
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
                  targetKey={target?.exercise.key ?? null}
                  targetRef={targetRef}
                  onCheck={onCheck}
                  onCardio={onCardio}
                  onAdjustSet={setOpenSet}
                  onAddSet={onAddSet}
                  onDropSet={dropDraft}
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
            résumé et sa note vivent sur l'écran suivant.

            En **secondaire** tant que la séance court : l'action primaire de
            l'écran est celle de la barre basse, et il n'y en a qu'une (KL-39).
            Ce bouton-ci reste le chemin de celui qui arrête plus tôt. */}
          {running || (closed && !closedElsewhere) ? (
            <Button
              label={closed ? 'Voir le résumé' : 'Terminer la séance'}
              variant="secondary"
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
      </View>

      {running || rest ? (
        <SessionDock
          rest={rest}
          target={target}
          finishable={running}
          autoRest={preferences.autoRest}
          onToggleAutoRest={() => patchPreferences({ autoRest: !preferences.autoRest })}
          onHeight={setDockHeight}
          onValidate={onValidate}
          onFinish={() => router.push(`/session/${uuid}/close`)}
        />
      ) : null}

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
          multiple={picker.mode === 'add'}
          onPick={(references) => onPick(picker, references)}
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
 * La barre basse : le repos (KL-31) et la validation (KL-39).
 *
 * **Tout ce qui se tape sans regarder vit ici**, et l'ordre n'est pas décoratif :
 * la validation est le dernier étage, donc toujours à la même distance du bord,
 * qu'un repos coure ou non. C'est ce qui la rend atteignable sans viser — la
 * mémoire du pouce ne se rééduque pas entre deux séries.
 *
 * Elle ne défile pas, elle recouvre : d'où le rembourrage de la page à sa
 * hauteur **mesurée**, sinon elle masquerait la dernière ligne cochée, c'est-à-
 * dire précisément celle qu'on vient de faire.
 *
 * **La bascule du repos automatique est ici, contre la validation**, et pas
 * seulement dans les réglages : c'est en cochant une série qu'on s'aperçoit
 * qu'un décompte n'a rien à faire là (circuit mené à la montre, échauffement
 * enchaîné), et repartir chercher un écran de réglages au milieu d'une séance
 * n'arrive pas. Elle ne se montre qu'avec une cible : sans série à valider, il
 * n'y a pas de repos à démarrer, et un interrupteur inerte à côté du bouton de
 * clôture serait une cible de plus pour rien.
 */
function SessionDock({
  rest,
  target,
  finishable,
  autoRest,
  onToggleAutoRest,
  onHeight,
  onValidate,
  onFinish,
}: {
  rest: RestState | null;
  target: SessionTarget | null;
  /** La séance court : elle peut être close, et la barre porte cette porte-là. */
  finishable: boolean;
  /** Le repos part-il tout seul à la validation ? */
  autoRest: boolean;
  onToggleAutoRest: () => void;
  onHeight: (height: number) => void;
  onValidate: (target: SessionTarget) => void;
  onFinish: () => void;
}) {
  // La zone sûre du bas en **rembourrage** (KL-37) : la barre peint sous la
  // barre gestuelle Android au lieu de s'arrêter au-dessus, et ses cibles
  // remontent d'autant.
  const insets = useSafeAreaInsets();

  // La barre disparue, le dégagement de la page doit disparaître avec elle :
  // sinon une séance qu'on vient de clore garde un vide de 200 points en bas.
  useEffect(() => () => onHeight(0), [onHeight]);

  return (
    <View
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      // Elle est posée sur la barre entière et non sur son dernier étage : quel
      // que soit ce qui s'y trouve, rien ne tombe sous le trait gestuel — et la
      // mesure la contient, donc le dégagement de la page suit tout seul.
      style={[styles.dock, { paddingBottom: insets.bottom }]}
    >
      {rest ? <RestStrip rest={rest} /> : null}

      {target === null && !finishable ? null : (
        <View style={styles.dockAction}>
          {target ? (
            <>
              <View style={styles.dockLabels}>
                <Text style={styles.dockEyebrow} numberOfLines={1}>
                  {target.line === null ? 'À faire' : `Série ${target.line.index}`}
                </Text>
                <Text style={styles.dockName} numberOfLines={1}>
                  {target.exercise.name}
                </Text>
                <Text style={styles.dockValues} numberOfLines={1}>
                  {targetValues(target)}
                </Text>
              </View>
              <AutoRestToggle enabled={autoRest} onToggle={onToggleAutoRest} />
              <Button
                label={target.line === null ? 'Fait' : 'Valider'}
                size="lg"
                accessibilityLabel={`Valider : ${targetLabel(target)}`}
                accessibilityHint={
                  autoRest
                    ? 'Elle est consignée aux valeurs affichées, et le repos démarre'
                    : 'Elle est consignée aux valeurs affichées. Le repos automatique est coupé'
                }
                onPress={() => onValidate(target)}
              />
            </>
          ) : (
            <Button
              label="Terminer la séance"
              size="lg"
              block
              accessibilityHint="Tout est coché. Voir le résumé avant de la déclarer terminée"
              onPress={onFinish}
            />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * L'interrupteur du repos automatique, contre le bouton de validation.
 *
 * **Deux dessins, pas deux teintes.** L'état ne peut pas se lire à la seule
 * couleur du trait : l'identité n'a qu'une couleur et elle est prise par
 * l'action primaire, juste à côté (règle 2). C'est donc `timer` ou `timer-off`,
 * la barre du second disant l'arrêt comme dans tout le jeu Lucide, doublé du
 * cadre encre quand il est actif. TalkBack, lui, l'annonce comme un
 * interrupteur — `accessibilityRole="switch"` et son état.
 *
 * Elle fait la **hauteur** du bouton `lg` qu'elle jouxte (56 points) mais pas sa
 * largeur : 48 suffisent, et les 8 points économisés vont au nom de l'exercice,
 * qui partage la ligne et se tronque à une ligne. C'est le seul arbitrage de
 * cette barre — une cible de plus y prend forcément sur ce qui se lit.
 */
function AutoRestToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel="Repos automatique"
      accessibilityHint={
        enabled
          ? 'Le désactiver : le repos ne partira plus tout seul en validant une série'
          : 'Le réactiver : le repos repartira à chaque série validée'
      }
      onPress={onToggle}
      style={({ pressed }) => [
        styles.autoRest,
        enabled && styles.autoRestOn,
        pressed && styles.autoRestPressed,
      ]}
    >
      <Icon
        name={enabled ? 'timer' : 'timer-off'}
        size={24}
        color={enabled ? colors.text : colors.textSecondary}
      />
    </Pressable>
  );
}

/**
 * L'étage du repos (KL-31), **réduit à une ligne**.
 *
 * Il occupait trois étages — jauge, titre et chrono géant, rangée d'actions —
 * soit près du tiers de l'écran pour une information qui se lit d'un coup d'œil.
 * Or il pousse vers le haut ce qui compte, le déroulé des séries, au moment
 * précis où on le consulte. Tout tient donc sur une ligne : retirer, le temps,
 * ajouter, passer. Ce qui a sauté n'était pas de l'information — le mot
 * « Repos » que la jauge et le chrono disent déjà, et le nom de l'exercice, qui
 * est écrit dans la barre juste en dessous.
 *
 * La jauge reste : c'est le seul élément qui se lit **sans lire**, de loin, banc
 * en face. Elle fait 3 points.
 *
 * « Passer » ferme l'étage sans rien consigner — le repos n'est pas du réalisé,
 * l'écourter ne se raconte nulle part. Il n'a pas à être passé pour valider la
 * série suivante : la validation est en dessous, elle reste sous le pouce
 * pendant le décompte.
 *
 * **Le décompte n'est pas une zone vive pour TalkBack.** Un nombre qui change
 * chaque seconde et s'annonce à chaque fois rendrait l'écran inutilisable au
 * lecteur d'écran ; l'étage s'annonce une fois, à son apparition, et se relit à
 * la demande.
 */
function RestStrip({ rest }: { rest: RestState }) {
  const over = rest.remaining === 0;
  const ratio = rest.totalSeconds > 0 ? rest.remaining / rest.totalSeconds : 0;

  return (
    <View style={styles.rest}>
      {/* La jauge se vide : ce qui reste de la barre est ce qui reste du repos. */}
      <View style={styles.restTrack}>
        <View style={[styles.restFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>

      <View style={styles.restBody}>
        <Button
          label={`− ${REST_STEP} s`}
          variant="ghost"
          size="sm"
          accessibilityLabel={`Retirer ${REST_STEP} secondes de repos`}
          onPress={() => adjustRest(-REST_STEP)}
        />

        <Text
          accessibilityLabel={
            over ? 'Repos terminé' : `Repos, ${rest.remaining} secondes restantes`
          }
          style={[styles.restClock, over && styles.restClockOver]}
        >
          {duration(rest.remaining)}
        </Text>

        <Button
          label={`+ ${REST_STEP} s`}
          variant="ghost"
          size="sm"
          accessibilityLabel={`Ajouter ${REST_STEP} secondes de repos`}
          onPress={() => adjustRest(REST_STEP)}
        />

        <View style={styles.spacer} />

        <Button
          label={over ? 'Fermer' : 'Passer'}
          variant="ghost"
          size="sm"
          accessibilityHint="Le repos ne se consigne pas, l’écourter ne change rien à la séance"
          onPress={stopRest}
        />
      </View>
    </View>
  );
}

/** Les valeurs à faire, telles que la barre basse les annonce. */
function targetValues(target: SessionTarget): string {
  if (target.line === null) {
    return target.exercise.prescribed?.summary ?? 'À marquer fait';
  }

  const planned = target.line.planned;
  const effort = setEffort(planned?.reps ?? null, planned?.durationSeconds ?? null) ?? 'série';

  return planned?.weightKg != null ? `${effort} × ${weight(planned.weightKg)}` : effort;
}

/** Ce que TalkBack annonce du bouton de validation : quoi, sur quoi, à combien. */
function targetLabel(target: SessionTarget): string {
  const head =
    target.line === null
      ? target.exercise.name
      : `série ${target.line.index}, ${target.exercise.name}`;

  return `${head}, ${targetValues(target)}`;
}

/**
 * Garder la cible courante en vue (KL-39).
 *
 * Le déroulé rejoint l'exercice courant **quand il change**, jamais à chaque
 * série : un écran qui se recale sous le doigt entre deux lignes du même
 * exercice serait pire que le mal. Et il ne bouge que si la cible est
 * effectivement sortie de la zone lisible — dont le bas est la barre d'action,
 * qui recouvre la page.
 *
 * La mesure passe par `measureInWindow` des deux vues plutôt que par un cumul
 * d'`onLayout` : entre la page, le bloc, le groupe et l'exercice, quatre `y`
 * relatifs s'additionneraient, et le rail d'un superset en ajouterait un
 * cinquième. Deux positions écran et le décalage courant suffisent, et restent
 * justes quelle que soit la profondeur.
 */
function useRevealTarget(targetKey: string | null, { bottomInset }: { bottomInset: number }) {
  const scrollRef = useRef<ScrollView>(null);
  // La **fenêtre** de lecture, et non la `ScrollView` elle-même : c'est ce qui
  // se mesure. Son type n'expose pas `measureInWindow`, une vue simple si.
  const frameRef = useRef<View>(null);
  const targetRef = useRef<View>(null);
  const offset = useRef(0);
  const reducedMotion = useReducedMotion();

  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    const node = targetRef.current;
    const frame = frameRef.current;

    if (targetKey === null || node === null || frame === null) {
      return;
    }

    node.measureInWindow((_x, y, _width, height) => {
      frame.measureInWindow((_sx, sy, _sw, sheight) => {
        // Positions ramenées au haut de la zone défilante.
        const top = y - sy;
        const margin = space[8];
        const floor = sheight - bottomInset - margin;

        if (top >= margin && top + height <= floor) {
          return;
        }

        scrollRef.current?.scrollTo({
          y: Math.max(0, offset.current + top - margin),
          animated: !reducedMotion,
        });
      });
    });
    // La hauteur de la barre est une dépendance et pas une valeur figée : quand
    // le repos s'ouvre, la barre grandit et peut recouvrir la série courante.
    // Le même effet la redécouvre alors, au lieu de la laisser sous la barre.
  }, [targetKey, bottomInset, reducedMotion]);

  return { scrollRef, frameRef, targetRef, onScroll };
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
  /** L'exercice que la barre basse propose. Il se marque, et il se garde en vue. */
  targetKey: string | null;
  /** Posée sur l'exercice courant : c'est ce que le déroulé mesure pour le rejoindre. */
  targetRef: Ref<View>;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
  onAdjustSet: (setUuid: string) => void;
  onAddSet: (exercise: SessionExercise) => void;
  /** Retire la série annoncée et pas encore faite. Prend la clé de l'exercice. */
  onDropSet: (exerciseKey: string) => void;
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
  targetKey,
  targetRef,
  onCheck,
  onCardio,
  onAdjustSet,
  onAddSet,
  onDropSet,
  onOpenExercise,
}: { exercise: SessionExercise } & SectionHandlers) {
  const { prescribed, lines } = exercise;
  const current = targetKey === exercise.key;
  const exerciseId = exerciseIdOf(exercise);
  const past = exerciseId === null ? null : (history.get(exerciseId) ?? null);
  // Une série annoncée attend d'être faite : le bouton devient sa reprise, pas un
  // second ajout. C'est aussi ce qui limite l'annonce à une ligne à la fois — on
  // n'annonce pas trois séries d'avance, on en fait une.
  const drafted = editable && (lines?.some((line) => line.draft) ?? false);
  // « Ajouter une série » n'a de sens qu'une fois le prescrit épuisé : tant qu'une
  // ligne de travail attend, cocher la suivante **est** le geste, et proposer les
  // deux ferait deux chemins pour un même fait.
  const canAddSet =
    editable &&
    !exercise.skipped &&
    lines !== null &&
    lines.every((line) => line.planned === null || line.type === 'warmup' || line.logged !== null);

  return (
    // La marque de l'exercice courant est un **rail d'encre**, pas un fond : le
    // fond appuyé dit déjà « série faite » deux lignes plus bas, et l'identité
    // n'a qu'une couleur, prise par l'action primaire (règle 2).
    <View ref={current ? targetRef : null} style={[styles.exercise, current && styles.exerciseNow]}>
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

      {drafted ? (
        <Button
          label="Retirer la série"
          variant="ghost"
          block
          accessibilityHint="Elle n’a pas encore été consignée : rien ne sera perdu"
          onPress={() => onDropSet(exercise.key)}
        />
      ) : canAddSet ? (
        <Button
          label="+ Série"
          variant="ghost"
          block
          accessibilityHint="Ajouter une série de plus que prévu. Elle reste à cocher"
          onPress={() => onAddSet(exercise)}
        />
      ) : null}

      {/* Ce que l'athlète a écrit à la salle. Rien à voir avec la consigne. */}
      {exercise.logged?.notes ? <Text style={styles.logNotes}>{exercise.logged.notes}</Text> : null}
    </View>
  );
}

/**
 * La dernière performance et le record d'un exercice (KL-32, remis en tableau en
 * KL-39).
 *
 * **Un tableau, parce qu'une ligne mentait.** La version d'origine condensait la
 * séance entière en une phrase, tronquée à la largeur de l'écran : « 2 × 8 reps,
 * 1 × 6 reps · 80 kg » tenait, « 3 × 10 reps, 2 × 8 reps, 1 × 6 reps » finissait
 * en points de suspension — donc sur la série la plus lourde, celle qu'on est
 * venu lire. Trois colonnes (séries, effort, charge) ne tronquent rien, se
 * comparent verticalement, et disent l'échauffement absent sans avoir à
 * l'écrire.
 *
 * Un exercice jamais fait n'a pas d'entrée du tout et ce composant n'est pas
 * monté ; un exercice fait au poids du corps a une dernière fois mais pas de
 * record (il n'y a pas de record sans kilos, `docs/api-mobile.md §6.6`), et la
 * section manquante n'est pas rendue — pas de case vide.
 *
 * **Ça ne ressemble toujours pas à une série** : pas de case, pas de fond, pas de
 * cadre, et un rail à gauche qui dit « ceci est du passé cité » comme la note de
 * salle plus bas. Une ligne d'historique qui aurait la peau d'une série
 * s'appuierait du pouce par erreur, à bout de bras, entre deux séries.
 *
 * Le **type** de la série record (à l'échec, drop set) n'est pas affiché : c'est
 * un repère qu'on lit en levant les yeux, et la charge est ce qui s'y compare. La
 * nuance vit sur la fiche d'exercice, quand KL-50 la posera.
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
        <HistoryTable
          label="Dernière fois"
          date={performanceDate(last.date, today)}
          rows={performanceRows(last)}
          summary={performanceSummary(last)}
        />
      ) : null}
      {best ? (
        <HistoryTable
          label="Record"
          date={performanceDate(best.date, today)}
          rows={[bestRow(best)]}
          summary={bestSummary(best)}
        />
      ) : null}
    </View>
  );
}

/** Une ligne du tableau : combien de fois, quel effort, sous quelle charge. */
type HistoryLine = { count: string; effort: string; load: string };

/**
 * Une section du tableau : son intitulé, sa date, ses lignes.
 *
 * La section s'annonce **d'un bloc** à TalkBack (`accessible`), et sur la phrase
 * condensée plutôt que colonne par colonne : un tableau se parcourt de l'œil,
 * pas à la voix — six arrêts pour lire « Record », « », « 8 reps », « 85 kg »
 * diraient la même chose en six fois plus de gestes.
 */
function HistoryTable({
  label,
  date,
  rows,
  summary,
}: {
  label: string;
  date: string;
  rows: HistoryLine[];
  summary: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${date}, ${summary}`}
      style={styles.historyPart}
    >
      <View style={styles.historyHead}>
        <Text style={styles.historyLabel}>{label}</Text>
        <View style={styles.spacer} />
        <Text style={styles.historyDate}>{date}</Text>
      </View>

      {rows.map((row, index) => (
        // Les lignes n'ont ni identité ni ordre propre : elles sont dérivées de
        // la performance et se rendent toutes ensemble ou pas du tout.
        <View key={index} style={styles.historyRow}>
          <Text style={styles.historyCount}>{row.count}</Text>
          {/* Aucun `numberOfLines` : c'est tout l'objet du tableau — une valeur
              longue passe à la ligne, elle ne se coupe pas. */}
          <Text style={styles.historyEffort}>{row.effort}</Text>
          <Text style={styles.historyLoad}>{row.load}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Les lignes de la dernière séance.
 *
 * Les séries arrivent déjà condensées par le serveur (les consécutives
 * identiques fusionnent, `count`) : trois séries de 8 à 80 kg tiennent en une
 * ligne. L'échauffement n'y est pas — le serveur ne compte que les séries de
 * travail (`PerformanceHistory`), ici comme dans le tonnage et les records.
 */
function performanceRows(session: PerformanceSession): HistoryLine[] {
  if (session.sets.length === 0) {
    // Ne devrait pas arriver — une performance sans série n'en est pas une — mais
    // le nombre de séries de travail est toujours là et se lit tout seul.
    return [
      {
        count: '',
        effort: `${session.workingSets} série${session.workingSets > 1 ? 's' : ''}`,
        load: '',
      },
    ];
  }

  return session.sets.map((group) => ({
    // Le « × » ne se met qu'à partir de deux : « 1 × 8 reps » se dit « 8 reps ».
    count: group.count > 1 ? `${group.count} ×` : '',
    effort: setEffort(group.reps, group.durationSeconds) ?? 'série',
    load: group.weightKg === null ? '' : weight(group.weightKg),
  }));
}

/** Le record : la série la plus lourde. Une ligne, et elle a toujours des kilos. */
function bestRow(best: PerformanceBest): HistoryLine {
  return {
    count: '',
    effort: setEffort(best.reps, best.durationSeconds) ?? 'série',
    load: weight(best.weightKg),
  };
}

/**
 * Ce qui a été fait la dernière fois, en **une phrase** — celle que TalkBack lit.
 *
 * Ce n'est plus ce qui s'affiche depuis KL-39 (le tableau l'a remplacée à
 * l'écran, justement parce qu'une phrase se tronque), mais c'est exactement ce
 * qu'il faut dire à la voix : condensé, dans l'ordre, sans colonne à annoncer.
 *
 * La charge se factorise quand elle est la même partout — le cas courant — et
 * rejoint la fin : « 2 × 8 reps, 1 × 6 reps · 80 kg » plutôt que la répéter deux
 * fois. Quand elle varie, chaque segment porte la sienne.
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
 *
 * ## Choisir, puis valider (`multiple`)
 *
 * Un appui **retient** l'exercice au lieu de fermer la feuille, et le pied
 * l'ajoute — ou les ajoute tous. Garnir une séance vierge, c'est y poser cinq
 * exercices d'affilée : la version d'origine refermait la feuille à chaque
 * choix, donc rouvrait, refocalisait le champ, recomposait les mêmes filtres,
 * cinq fois. Ce que ça coûte est un appui de plus dans le cas d'un seul
 * exercice ; ce que ça rend est une recherche au lieu de cinq.
 *
 * Le **remplacement** n'en profite pas et garde l'appui unique : deux exercices
 * ne remplacent pas une ligne du programme, et un pied « Remplacer (2) » serait
 * une promesse fausse.
 */
function ExercisePicker({
  title,
  multiple,
  onPick,
  onClose,
}: {
  title: string;
  /** Le choix s'accumule et se valide au pied, au lieu de fermer la feuille. */
  multiple: boolean;
  onPick: (references: ExerciseRef[]) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [activity, setActivity] = useState<ActivityType | null>(null);
  const [area, setArea] = useState<TargetArea | null>(null);
  // Retenus **dans l'ordre des appuis**, et non dans celui de la liste : c'est
  // celui dans lequel ils entreront dans la séance, et c'est ce que l'ordre des
  // gestes annonce. Une entrée porte son nom en plus de son identifiant — la
  // liste se refiltre sous les doigts, et un exercice retenu puis filtré hors de
  // la vue doit rester ajoutable.
  const [picked, setPicked] = useState<ExerciseRef[]>([]);
  const { results, activities, areas } = useExerciseLibrary(term, activity, area);

  const choose = (reference: ExerciseRef) => {
    if (!multiple) {
      onPick([reference]);

      return;
    }

    setPicked((current) =>
      current.some((entry) => entry.id === reference.id)
        ? current.filter((entry) => entry.id !== reference.id)
        : [...current, reference],
    );
  };

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
    <Sheet
      visible
      onClose={onClose}
      title={title}
      footer={
        multiple ? (
          // Toujours rendu, désactivé tant que rien n'est retenu : un bouton qui
          // apparaît sous le doigt déplacerait la liste au moment du premier
          // choix, c'est-à-dire pile là où on regarde.
          <Button
            label={picked.length > 1 ? `Ajouter les ${picked.length}` : 'Ajouter'}
            block
            disabled={picked.length === 0}
            accessibilityHint="Les exercices retenus entrent dans la séance, dans l’ordre choisi"
            onPress={() => onPick(picked)}
          />
        ) : null
      }
    >
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
        results.map((option) => {
          const selected = picked.some((entry) => entry.id === option.id);

          return (
            <Pressable
              key={option.id}
              // Un choix qui s'accumule est une **case**, pas un bouton : c'est
              // ce qui fait dire à TalkBack qu'il reste coché, et qu'on peut le
              // décocher. Un « bouton » aurait laissé croire que la feuille se
              // ferme.
              accessibilityRole={multiple ? 'checkbox' : 'button'}
              accessibilityState={multiple ? { checked: selected } : undefined}
              accessibilityLabel={`${option.name}, ${activityLabel(option.activity)}`}
              onPress={() => choose({ id: option.id, name: option.name })}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
            >
              <Text style={styles.name}>{option.name}</Text>
              <View style={styles.spacer} />
              {option.global ? null : <Chip label="Perso" />}
              {/* L'activité est une **catégorie** : elle se code par son rang dans
                  l'échelle de gris, jamais par une teinte (règle 2). Elle se lit
                  surtout quand on parcourt la liste sans avoir rien tapé. */}
              <Chip label={activityLabel(option.activity)} rank={ACTIVITY_RANKS[option.activity]} />
              {/* La même case que les séries, au même endroit du regard : à
                  droite, en bout de ligne. Elle ne se rend qu'en choix multiple —
                  sinon elle promettrait une accumulation qui n'existe pas. */}
              {multiple ? <View style={[styles.box, selected && styles.boxChecked]} /> : null}
            </Pressable>
          );
        })
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
  frame: { flex: 1 },
  page: { padding: space[8], gap: space[8], paddingBottom: space[13] },
  spacer: { flex: 1 },

  name: { ...text.name, color: colors.text, flexShrink: 1 },
  body: { ...text.body, color: colors.textSecondary },
  caption: { ...text.caption, color: colors.textSecondary },
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
  blockNumber: { ...text.numeric, color: colors.textSecondary },
  blockRole: { ...text.sectionTitle, color: colors.text },
  blockLabel: { ...text.caption, color: colors.textSecondary, flexShrink: 1 },
  blockCount: { ...text.numeric, color: colors.textSecondary },

  // Le groupe se marque au rail, pas au conteneur : il n'en a pas dans le modèle.
  group: {
    borderLeftWidth: 3,
    borderLeftColor: colors.cat1,
    marginLeft: space[7],
    marginVertical: space[4],
    paddingLeft: space[5],
  },
  groupHead: { ...text.eyebrow, color: colors.textSecondary, paddingVertical: space[3] },

  exercise: { paddingHorizontal: space[7], paddingVertical: space[6] },
  // L'exercice courant (KL-39). Le rail compense sa propre épaisseur en
  // rembourrage, sinon le contenu sauterait de 3 points en devenant courant.
  exerciseNow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.text,
    paddingLeft: space[7] - 3,
    backgroundColor: colors.surfaceSubtle,
  },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  exerciseCount: { ...text.numeric, color: colors.textSecondary },
  // Le rang dans le superset, en mono : il se compare, il ne se lit pas.
  rank: { ...text.eyebrow, color: colors.text },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[2] },

  // L'historique (KL-32, en tableau depuis KL-39). Pas de case, pas de fond : un
  // rail, comme la note de salle — c'est du passé cité, pas une ligne où appuyer.
  history: {
    gap: space[5],
    marginTop: space[5],
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: space[5],
  },
  historyPart: { gap: space[1] },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  historyLabel: { ...text.eyebrow, color: colors.textSecondary },
  historyDate: { ...text.caption, color: colors.textSecondary },
  // `flex-start` et non `center` : une valeur qui passe à la ligne doit aligner
  // sa **première** ligne sur les autres colonnes, pas se centrer sur deux.
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[4] },
  // En mono comme les charges de la séance : c'est la même grandeur, lue au même
  // moment, et elle doit se comparer d'un coup d'œil à la ligne d'en dessous.
  // Trois colonnes de largeur tenue, sinon un tableau n'en est pas un.
  historyCount: { ...text.numeric, color: colors.textSecondary, width: 34, textAlign: 'right' },
  historyEffort: { ...text.numeric, color: colors.textSecondary, flex: 1 },
  historyLoad: { ...text.numeric, color: colors.textSecondary, minWidth: 68, textAlign: 'right' },

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
  setRank: { ...text.numeric, color: colors.textSecondary, width: 24 },
  setRankChecked: { color: colors.textSecondary },
  setEffort: { ...text.numeric, color: colors.text },
  setLoad: { ...text.numeric, color: colors.text },
  setFaint: { color: colors.textSecondary },
  // Le prévu, à côté du saisi. Atténué et plus petit : il est le repère, pas la
  // valeur — celle qui compte est ce qui a été fait.
  setPlanned: { ...text.caption, color: colors.textSecondary },

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
  // La case est la cible qu'on vise **sans regarder** : son contour porte donc
  // l'encre secondaire et non un gris de filet, qui plafonnait à 1,7:1 sur le
  // blanc (KL-39, `§1.4.11` demande 3:1 à ce qui identifie un contrôle).
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    backgroundColor: 'transparent',
  },
  boxChecked: { borderColor: colors.text, backgroundColor: colors.text },
  boxIdle: { borderColor: colors.borderMuted },

  // La barre basse : posée sur le bas de l'écran, filet en tête, fond appuyé.
  // Elle ne flotte pas (aucune ombre dans cette identité), elle s'ancre.
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.text,
  },
  // L'étage de validation : le dernier, donc toujours à la même distance du bord.
  dockAction: {
    flexDirection: 'row',
    alignItems: 'center',
    // Resserré depuis que l'interrupteur de repos partage la ligne : ce que les
    // gouttières prennent, le nom de l'exercice le perd.
    gap: space[4],
    paddingHorizontal: space[8],
    paddingVertical: space[6],
  },
  dockLabels: { flex: 1, gap: space[1] },
  dockEyebrow: { ...text.eyebrow, color: colors.textSecondary },
  dockName: { ...text.name, color: colors.text },
  dockValues: { ...text.numeric, color: colors.text },

  // L'étage du repos : une jauge et une ligne, empilées au-dessus de la
  // validation. Rien de plus — ce qui est au-dessus, c'est la séance.
  rest: {
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },
  restTrack: { height: 3, backgroundColor: colors.track },
  restFill: { height: 3, backgroundColor: colors.text },
  restBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
  },
  // Le chrono tabulaire, deux crans sous l'ancien : il se lit encore à bout de
  // bras sans prendre l'étage entier. Le rembourrage horizontal l'écarte des
  // deux boutons qui l'encadrent, sinon « − 15 s 1:23 + 15 s » se lit d'un bloc.
  restClock: { ...text.inputValue, color: colors.text, paddingHorizontal: space[2] },
  // Le rouge à l'échéance seulement, et c'est bien son emploi : ce n'est pas une
  // catégorie qu'on colore, c'est l'appel à reprendre la série (§5 règle 2).
  // `primaryOnTint` et non `primary` : à cette taille, le chrono n'est plus un
  // « grand texte » au sens WCAG, et le rouge plein y tomberait sous AA.
  restClockOver: { color: colors.primaryOnTint },

  // La bascule du repos automatique, contre la validation. Carrée, de la hauteur
  // du bouton `lg` qu'elle jouxte : elle se tape sans regarder, elle aussi.
  autoRest: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 48,
    height: 56,
    borderWidth: layout.hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  autoRestOn: { borderColor: colors.text },
  autoRestPressed: { backgroundColor: colors.fill },

  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: space[4] },

  // Les facettes du sélecteur (KL-34). Le `gap` de la feuille sépare déjà les
  // deux rangées : ici seulement l'intitulé et ses pilules.
  facets: { gap: space[2] },
  facetLabel: { ...text.eyebrow, color: colors.textSecondary },
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
  // Un exercice retenu se pose sur le même fond appuyé qu'une série faite, et
  // gagne le filet encre : c'est le même vocabulaire, « ceci est acquis ».
  optionSelected: { backgroundColor: colors.fill, borderColor: colors.borderStrong },
});
