import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import ReorderableList, { useReorderableDrag } from 'react-native-reorderable-list';
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
  setEffortParts,
  Sheet,
  weight,
  weightParts,
  type ChipRank,
  type Measure as MeasureParts,
} from '@/components';
import {
  activityLabel,
  addExercise,
  adjustRest,
  beginWorkout,
  blockRoleLabel,
  cancelWorkout,
  canReplaceExercise,
  chainExercise,
  checkSet,
  dayOffset,
  deleteSet,
  exerciseIdOf,
  EXTRAS_LANE,
  findExercise,
  findLine,
  groupExercises,
  lineKey,
  lineValues,
  isClosed,
  isRunning,
  longDate,
  moveExercise,
  moveExerciseTo,
  nextTarget,
  removeExercise,
  replaceExercise,
  resetExecutionOrder,
  REST_STEP,
  sessionRecords,
  setCardioDone,
  setDeviates,
  setExerciseState,
  setTypeLabel,
  setTypeLetter,
  shortDate,
  targetAreaLabel,
  startRestAfterSet,
  stopRest,
  unchainExercise,
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
  withPlannedOverrides,
  type ExerciseRef,
  type LoggedSetValues,
  type RestState,
  type SessionBlock,
  type SessionExercise,
  type SessionGroup,
  type SessionProgram,
  type SessionSetLine,
  type SessionTarget,
  type SetValues,
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
 * ## Les deux gestes d'une ligne, avant comme après (KL-30, revu)
 *
 * Une ligne a **deux cibles**, qu'elle soit faite ou non : sa zone de valeurs
 * ouvre la feuille, sa case coche ou décoche. Deux cibles plutôt qu'un appui
 * long, qui n'est visible nulle part et se découvre par accident.
 *
 * La version d'origine réservait la feuille aux séries **faites** : on faisait ce
 * qui était écrit, puis on corrigeait. C'est juste pour une série qu'on découvre
 * en la faisant, et faux pour celle qu'on sait d'avance — la barre est chargée à
 * 82,5 kg, elle le sera pour les quatre séries, et on le sait avant la première.
 * Il fallait alors cocher pour corriger, c'est-à-dire déclarer faite chaque série
 * avant de la faire, quatre fois. La feuille s'ouvre donc aussi **avant**, et ce
 * qu'on y valide n'est pas du réalisé : c'est une valeur posée sur la ligne
 * (`withPlannedOverrides`), qui vit en mémoire comme la série en brouillon et que
 * la coche consigne.
 *
 * Le prescrit ne bouge pas pour autant, et c'est ce qui rend la chose licite :
 * il reste écrit à côté, et l'écart se lit avant la série au lieu d'après.
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
 * Corollaire du modèle, pas de l'écran : **rien ne s'écrit avant la coche**. Le
 * prescrit ne bouge jamais (§0.3) et n'a aucun endroit où accueillir « la série 3
 * se fera à 82,5 kg » ; le réalisé, lui, n'existe pas avant d'avoir eu lieu. Ce
 * qu'on annonce d'avance — une série de plus, une charge revue — vit donc dans
 * l'écran, se projette sur le déroulé au rendu, et va en base par le seul chemin
 * qui écrive du réalisé.
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
  // Les valeurs corrigées **avant** que la série soit faite, par clé de série.
  // Même statut que les brouillons ci-dessus, et pour la même raison : ni du
  // prescrit ni du réalisé, donc aucune colonne où s'écrire
  // (`withPlannedOverrides`). Elles se consignent en cochant, et pas avant.
  //
  // Sans RPE, et ce n'est pas un oubli : le RPE se **ressent**, il ne s'annonce
  // pas — `checkSet` écrit `null` pour la même raison, et il se saisit après coup
  // dans la feuille de la série faite.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, SetValues>>(() => new Map());
  // L'ordre compte : les corrections se posent **après** les brouillons, la série
  // annoncée n'existant pas avant d'être projetée — et c'est justement une de
  // celles qu'on veut pouvoir corriger avant de la faire.
  const program = useMemo(
    () => withPlannedOverrides(withDraftSets(base, drafts), overrides),
    [base, drafts, overrides],
  );
  const history = useSessionHistory(program);
  // La série qui bat le record de son exercice, s'il y en a une. Calculé une
  // fois pour tout le déroulé, comme l'historique dont il dérive — et mémoïsé
  // comme lui : il se refait à chaque écriture, pas à chaque rendu.
  const records = useMemo(() => sessionRecords(program, history), [program, history]);
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
  // Le mode « ranger le déroulé » (KL-52). Il vit dans l'écran et nulle part
  // ailleurs : ce n'est pas un état de la séance, c'est une façon de la regarder,
  // et le quitter ne défait rien de ce qu'on y a fait.
  const [reordering, setReordering] = useState(false);
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
  // Pas de cible pendant qu'on range : la barre basse porte alors la sortie du
  // mode, et le déroulé ne doit pas se recaler sous le doigt au moment précis où
  // on déplace une ligne (`useRevealTarget`).
  const target = running && !reordering ? nextTarget(program) : null;
  // Les hors-programme se regroupent comme les exercices d'un bloc : sans ordre
  // local chacun est son propre groupe, avec un enchaînement improvisé ils
  // partagent un rail. Mémoïsé comme le reste du déroulé — il se reconstruit à
  // chaque écriture, pas à chaque rendu.
  const extraGroups = useMemo(() => groupExercises(program.extras), [program.extras]);
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

  // La correction posée d'avance est **consommée par la coche** : la série est
  // faite, ses valeurs sont en base, et la corriger encore passe désormais par la
  // feuille de la série faite (`updateSet`). La laisser traîner donnerait deux
  // vérités sur le même fait — et c'est aussi ce qui évite qu'une clé survive à
  // la ligne qu'elle décrivait.
  const dropOverride = useCallback((key: string) => {
    setOverrides((current) => {
      if (!current.has(key)) {
        return current;
      }

      const next = new Map(current);
      next.delete(key);

      return next;
    });
  }, []);

  // Enregistrer une correction. Elle **n'écrit rien** : la série reste à faire,
  // elle affiche seulement ce qu'on va y mettre. Une correction qui retombe sur
  // le prescrit n'en est plus une, et s'efface plutôt que de se poser.
  const onOverride = useCallback(
    (key: string, values: SetValues | null) => {
      if (values === null) {
        dropOverride(key);

        return;
      }

      setOverrides((current) => new Map(current).set(key, values));
    },
    [dropOverride],
  );

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
          dropOverride(lineKey(exercise, line));
          startRestAfterSet(exercise);
        }
      } else if (line.undoable) {
        if (uncheckSet(uuid, exercise, line)) {
          dropDraft(exercise.key);
          stopRest();
        }
      }
    },
    [uuid, dropDraft, dropOverride],
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
        dropOverride(lineKey(pending.exercise, pending.line));
        startRestAfterSet(pending.exercise);
      }
    },
    [uuid, dropDraft, dropOverride],
  );

  // Annuler la séance : elle n'a pas eu lieu. **Confirmé**, parce que c'est le
  // seul geste de cet écran qui efface du réalisé et qu'aucun « défaire » ne le
  // rattrape — les autres irréversibles de l'app (la clôture) ont un écran à eux
  // pour ça, celui-ci n'en mérite pas un, il n'a rien à résumer.
  //
  // Ce qui suit dépend de ce qui reste. Une séance **libre** n'existe plus : il
  // n'y a plus rien à afficher, on revient d'où l'on vient. Une séance
  // **programmée** est toujours là, redevenue « à faire » : rester dessus est la
  // bonne réponse, l'écran repasse tout seul en « pas commencée » (`startable`)
  // et la barre basse reproposera « Démarrer la séance ». Les brouillons partent
  // avec — ils décrivaient des séries d'une séance qui n'a pas eu lieu.
  const onCancel = useCallback(() => {
    const freeform = workout?.freeform ?? false;

    Alert.alert(
      freeform ? 'Supprimer cette séance ?' : 'Annuler cette séance ?',
      freeform
        ? 'Elle disparaît avec tout ce qui y a été consigné, ici comme sur le web. C’est sans retour.'
        : 'Elle redevient à faire, et tout ce qui a été coché est effacé. C’est sans retour.',
      [
        { text: 'Continuer la séance', style: 'cancel' },
        {
          text: freeform ? 'Supprimer' : 'Annuler la séance',
          style: 'destructive',
          onPress: () => {
            const outcome = cancelWorkout(uuid);

            if (outcome === null) {
              return;
            }

            setDrafts(new Set());
            setOverrides(new Map());
            setReordering(false);

            if (outcome === 'deleted') {
              router.back();
            }
          },
        },
      ],
    );
  }, [uuid, workout?.freeform]);

  // Ranger le déroulé (KL-52). Un seul point d'entrée pour les quatre gestes :
  // ils écrivent la même chose — l'ordre entier — et ne diffèrent que par la
  // modification qu'ils y appliquent (`@/session`, `order.ts`).
  // Le relâchement d'un glisser-déposer. Il ne dit pas « d'un cran », il dit
  // « dans cette file, à cette place » — la file étant un bloc ou les
  // hors-programme, et pas forcément celle d'où l'exercice vient. `ArrangeBoard`
  // a déjà relu l'index de liste en file et en rang (`dropTarget`), il n'y a
  // rien à traduire de plus ici.
  const onReorder = useCallback(
    (exerciseKey: string, lane: string, to: number) => {
      moveExerciseTo(uuid, program, exerciseKey, lane, to);
    },
    [uuid, program],
  );

  const onArrange = useCallback(
    (exerciseKey: string, action: ArrangeAction) => {
      switch (action) {
        case 'up':
          moveExercise(uuid, program, exerciseKey, -1);
          break;
        case 'down':
          moveExercise(uuid, program, exerciseKey, 1);
          break;
        case 'chain':
          chainExercise(uuid, program, exerciseKey);
          break;
        case 'unchain':
          unchainExercise(uuid, program, exerciseKey);
          break;
      }
    },
    [uuid, program],
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
  // Ni commencée ni close : elle s'ouvre depuis ici, et c'est le seul écran qui
  // la montre avant de l'ouvrir (« Voir la séance », écran « Aujourd'hui »).
  const startable = !running && !closed;
  // Fermée sans jamais avoir tourné ici : elle a été cochée « faite » sur le web.
  // Il n'y a donc ni durée, ni série, ni écart à résumer — l'écran se lit, il ne
  // se clôture pas.
  const closedElsewhere = closed && workout.endedAt === null;
  const sheetSet = openSet === null ? null : findLine(program, openSet);
  const sheetExercise = openExercise === null ? null : findExercise(program, openExercise);

  return (
    <View style={styles.screen}>
      {/* Le titre de l'écran **est** le nom de la séance : « SÉANCE » en pas de
          30 nommait ce qu'on venait d'ouvrir, et le vrai nom se lisait plus bas,
          plus petit, dans la bande. Deux étages pour une seule information, en
          haut de l'écran où la place se paie en séries visibles — d'où aussi le
          `compact`, qui remonte les pastilles sur la ligne du retour. L'état
          (« En cours », « Terminée ») reste dit par la pastille, qui le disait
          déjà. */}
      <Header
        compact
        eyebrow={longDate(workout.date)}
        title={workout.title ?? 'Séance libre'}
        titleRole="name"
        onBack={() => router.back()}
        right={
          <>
            {pendingSync ? <Chip label="À synchroniser" /> : null}
            {closed ? (
              <Chip label="Terminée" tone="done" dot />
            ) : running ? (
              <Chip label="En cours" tone="planned" dot />
            ) : null}
          </>
        }
      />

      {/* La bande de tête ne défile pas : la progression doit rester lisible au
          milieu du douzième exercice, c'est tout l'intérêt de l'afficher. Elle
          ne porte plus que ce qui n'est pas déjà en tête, et disparaît quand il
          ne lui reste rien — un liseré vide sous l'en-tête n'est pas une bande,
          c'est une marge. */}
      {workout.plan || program.total > 0 ? (
        <View style={styles.summary}>
          {workout.plan ? <Text style={styles.caption}>{workout.plan.title}</Text> : null}
          {/* Rien à mesurer sur une séance sans programme : « 0 / 0 » n'est pas une
              progression, c'est une case vide de plus. */}
          {program.total > 0 ? <Progress done={program.done} total={program.total} /> : null}
        </View>
      ) : null}

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
      {/* Ranger le déroulé remplace la page, il ne s'y glisse pas (KL-52) : les
          séries disparaissent, la séance entière devient une seule liste
          traînable où les titres de blocs sont des lignes. Deux arbres plutôt
          qu'un arbre à conditions — celui de la séance ne connaît pas le
          rangement, et réciproquement. */}
      {reordering ? (
        <ArrangeBoard
          program={program}
          freeform={workout.freeform}
          bottomInset={dockHeight > 0 ? dockHeight + space[13] : space[13] + insets.bottom}
          onReset={() => resetExecutionOrder(uuid)}
          onArrange={onArrange}
          onReorder={onReorder}
        />
      ) : (
        /* La fenêtre de lecture : c'est elle que `useRevealTarget` mesure pour
         savoir si la série courante est encore dedans. */
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
            {/* Le bouton de démarrage n'est plus ici mais dans la barre basse : on
              arrive sur cet écran pour **lire** ce qu'il y a à faire (« Voir la
              séance », écran « Aujourd'hui »), on déroule, et l'action reste au
              pouce où qu'on soit rendu. La même action aux deux endroits ferait
              douter qu'elle fait la même chose. */}
            {startable ? (
              <View style={styles.notice}>
                <Text style={styles.body}>
                  Cette séance n’est pas commencée. Rien ne se consigne tant qu’elle ne l’est pas.
                </Text>
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

            {/* Un bloc que le rangement a vidé ne se dessine plus : un titre
              suivi de rien ne dit rien de la séance, et le mode rangement garde
              le sien pour qu'on puisse toujours y revenir (`arrangeLanes`).
              Un bloc vide au **programme** n'existe pas — le serveur n'en
              descend pas. */}
            {program.blocks
              .filter((block) => block.groups.length > 0)
              .map((block) => (
                <BlockSection
                  key={block.key}
                  block={block}
                  editable={running}
                  history={history}
                  records={records}
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
                    {workout.freeform && program.blocks.length === 0
                      ? 'Exercices'
                      : 'Hors programme'}
                  </Text>
                </View>
                {/* Par groupes et non un à un : une séance libre (KL-34) n'a **que**
                  des hors-programme, et un superset improvisé s'y dessine au même
                  rail que dans un bloc (KL-52). Sans ordre local, chacun est son
                  propre groupe et le rendu est celui d'avant, à l'identique. */}
                {extraGroups.map((group) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    editable={running}
                    history={history}
                    records={records}
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

            {/* La porte du rangement (KL-52), en fin de déroulé et **une seule** :
              le même geste à deux endroits ferait douter qu'il fait la même
              chose. Elle s'ouvre aussi avant le démarrage — on lit le programme,
              on sait déjà que le rack sera pris — puisque rien de ce qu'elle
              écrit n'est du réalisé. */}
            {!closed && exerciseCount(program) > 1 ? (
              <Button
                label="Réorganiser les exercices"
                variant="ghost"
                block
                accessibilityHint="Changer l’ordre et les enchaînements, sur ce téléphone seulement"
                onPress={() => setReordering(true)}
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

            {/* La sortie de secours : la séance a été ouverte par erreur, ou on
              renonce. Elle est **sous** la porte de la clôture et en `ghost` —
              c'est le geste qu'on ne cherche pas, et l'écran n'a qu'une action
              primaire, dans la barre basse (KL-39). Elle disparaît avec la
              clôture : une séance close ne s'annule plus (`cancel.ts`). */}
            {running ? (
              <Button
                label={workout.freeform ? 'Supprimer cette séance' : 'Annuler la séance'}
                variant="ghost"
                block
                accessibilityHint={
                  workout.freeform
                    ? 'Elle n’a pas eu lieu : elle disparaît, ici comme sur le web'
                    : 'Elle n’a pas eu lieu : elle redevient à faire, et ce qui a été coché est effacé'
                }
                onPress={onCancel}
              />
            ) : null}
          </ScrollView>
        </View>
      )}

      {reordering ? (
        <ArrangeDock onHeight={setDockHeight} onDone={() => setReordering(false)} />
      ) : running || rest || startable ? (
        <SessionDock
          rest={rest}
          target={target}
          startable={startable}
          finishable={running}
          onStart={() => beginWorkout(uuid)}
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
          onOverride={(values) => onOverride(openSet ?? '', values)}
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
 * La barre basse : le démarrage, le repos (KL-31) et la validation (KL-39).
 *
 * Trois états qui ne coexistent pas — ouvrir la séance, la valider série par
 * série, la clore — et **une seule position** pour tous : la cible principale de
 * l'écran est toujours à la même distance du bord, du premier appui au dernier.
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
  startable,
  finishable,
  autoRest,
  onToggleAutoRest,
  onHeight,
  onStart,
  onValidate,
  onFinish,
}: {
  rest: RestState | null;
  target: SessionTarget | null;
  /** La séance n'est pas commencée : la barre ne porte qu'un geste, l'ouvrir. */
  startable: boolean;
  /** La séance court : elle peut être close, et la barre porte cette porte-là. */
  finishable: boolean;
  /** Le repos part-il tout seul à la validation ? */
  autoRest: boolean;
  onToggleAutoRest: () => void;
  onHeight: (height: number) => void;
  onStart: () => void;
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

      {/* Une séance pas encore commencée n'a qu'un geste, et il est au même
          endroit que la validation qui lui succédera : le pouce ne se rééduque
          pas entre l'ouverture et la première série. */}
      {startable ? (
        <View style={styles.dockAction}>
          <Button
            label="Démarrer la séance"
            size="lg"
            block
            accessibilityHint="Elle passe en cours : c’est le début du réalisé, et les séries deviennent cochables"
            onPress={onStart}
          />
        </View>
      ) : target === null && !finishable ? null : (
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

  // Ce que la série **va** consigner, correction posée d'avance comprise : la
  // barre ne peut pas annoncer 80 kg pour en écrire 82,5.
  const values = lineValues(target.line);
  const effort = setEffort(values?.reps ?? null, values?.durationSeconds ?? null) ?? 'série';

  return values?.weightKg != null ? `${effort} × ${weight(values.weightKg)}` : effort;
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
  /**
   * Les records battus dans cette séance : clé d'exercice → clé de la série qui
   * les porte (`sessionRecords`). Descendue avec l'historique et pour la même
   * raison — c'est une seule lecture pour tout le déroulé.
   */
  records: Map<string, string>;
  /** Le jour réel, repère des dates d'historique. */
  today: string;
  /** L'exercice que la barre basse propose. Il se marque, et il se garde en vue. */
  targetKey: string | null;
  /** Posée sur l'exercice courant : c'est ce que le déroulé mesure pour le rejoindre. */
  targetRef: Ref<View>;
  onCheck: (exercise: SessionExercise, line: SessionSetLine) => void;
  onCardio: (exercise: SessionExercise) => void;
  /** Ouvre la feuille d'une série. Prend sa **clé composée** (`lineKey`). */
  onAdjustSet: (key: string) => void;
  onAddSet: (exercise: SessionExercise) => void;
  /** Retire la série annoncée et pas encore faite. Prend la clé de l'exercice. */
  onDropSet: (exerciseKey: string) => void;
  onOpenExercise: (key: string) => void;
};

/**
 * Les gestes du rangement qui restent des **boutons** (KL-52).
 *
 * Le déplacement, lui, se traîne désormais et n'est plus ici : `up` et `down`
 * survivent pour TalkBack, qui n'a aucun moyen de traîner quoi que ce soit, et
 * qui les trouve en actions d'accessibilité sur la poignée (`ArrangeRow`).
 */
type ArrangeAction = 'up' | 'down' | 'chain' | 'unchain';

/**
 * Les files réordonnables du déroulé, telles que le rangement les dessine.
 *
 * Une file par bloc, plus les hors-programme — **exactement** les files de
 * `order.ts` (`pools`), et ce n'est pas une coïncidence qu'il faut entretenir :
 * la file et le rang que le glisser-déposer rend au relâchement désignent une
 * place dans cette liste-là, et `moveExerciseTo` les applique tels quels. Les
 * composer autrement ici ferait atterrir l'exercice ailleurs qu'où le doigt l'a
 * lâché.
 *
 * Deux règles héritées de `pools`, pour la même raison : **un bloc vidé reste
 * une file** — sinon un exercice qu'on en a sorti ne pourrait plus y revenir —
 * et les hors-programme n'en font une que s'il y en a, « hors programme » étant
 * un statut qu'on prend en étant ajouté à la main, pas une section où l'on se
 * range.
 *
 * Le groupe (superset) n'est **pas** une file : il n'a pas de conteneur dans le
 * modèle, et un enchaînement se fait et se défait de voisins contigus. On aplatit
 * donc les groupes, et le rang porté par chaque ligne dit le reste.
 */
type ArrangeLane = {
  key: string;
  /** Le numéro du bloc, ou `null` pour les hors-programme, qui n'en ont pas. */
  number: string | null;
  title: string;
  label: string | null;
  exercises: SessionExercise[];
};

function arrangeLanes(program: SessionProgram, freeform: boolean): ArrangeLane[] {
  const lanes: ArrangeLane[] = program.blocks.map((block) => ({
    key: block.key,
    number: String(block.number).padStart(2, '0'),
    title: blockRoleLabel(block.block.role),
    label: block.block.label,
    exercises: block.groups.flatMap((group) => group.exercises),
  }));

  if (program.extras.length > 0) {
    lanes.push({
      key: EXTRAS_LANE,
      number: null,
      // Une séance libre n'a **que** ça : l'appeler « hors programme » ferait
      // lire la séance entière comme une longue déviation (même mot que la page).
      title: freeform && program.blocks.length === 0 ? 'Exercices' : 'Hors programme',
      label: null,
      exercises: [...program.extras],
    });
  }

  return lanes;
}

/**
 * Une ligne de la liste de rangement : un en-tête de file, ou un exercice.
 *
 * **Une seule liste pour toute la séance**, et c'est ce qui permet de traîner un
 * exercice d'un bloc à l'autre : la bibliothèque ne sait réordonner qu'à
 * l'intérieur d'une liste, donc tant qu'il y en avait une par bloc, aucun geste
 * ne pouvait en sortir. Les en-têtes deviennent alors des **lignes**, et la
 * frontière entre deux files n'est plus qu'un rang de plus à franchir.
 *
 * Un en-tête ne se traîne pas : rien en lui n'appelle `useReorderableDrag`, donc
 * aucun geste ne démarre dessus. Il se fait pousser par ce qui passe, ce qui est
 * exactement ce qu'on veut voir — l'exercice remonte au-dessus du titre, il
 * change de bloc.
 */
type ArrangeItem =
  | { type: 'lane'; key: string; lane: ArrangeLane }
  | {
      type: 'exercise';
      key: string;
      lane: string;
      exercise: SessionExercise;
      /** En tête de sa file : rien ne le précède **ici**, donc rien à enchaîner. */
      first: boolean;
      /** En queue de sa file : c'est lui qui referme le cadre du bloc. */
      last: boolean;
      /** Un cran plus haut existe — dans sa file, ou dans celle d'au-dessus. */
      canUp: boolean;
      canDown: boolean;
    };

/** Les files mises bout à bout : en-tête, contenu, en-tête, contenu. */
function arrangeItems(lanes: ArrangeLane[]): ArrangeItem[] {
  return lanes.flatMap((lane, laneIndex) => [
    { type: 'lane' as const, key: `lane:${lane.key}`, lane },
    ...lane.exercises.map((exercise, rank) => ({
      type: 'exercise' as const,
      key: exercise.key,
      lane: lane.key,
      exercise,
      first: rank === 0,
      last: rank === lane.exercises.length - 1,
      // Les bornes sont celles de la **séance**, pas de la file : le cran
      // suivant peut être dans le bloc d'à côté (`moveExercise`), et c'est le
      // seul chemin qu'a TalkBack pour y aller.
      canUp: rank > 0 || laneIndex > 0,
      canDown: rank < lane.exercises.length - 1 || laneIndex < lanes.length - 1,
    })),
  ]);
}

/**
 * Où l'exercice a été lâché : la file, et son rang dedans.
 *
 * La bibliothèque ne parle qu'en index de liste — `from` d'où il vient, `to` où
 * il atterrit dans la liste **privée de lui**. On relit donc la liste vers le
 * haut depuis ce point : le premier en-tête rencontré est la file, et ce qu'on a
 * enjambé pour l'atteindre est le rang.
 *
 * Relâché au-dessus du tout premier en-tête, il n'y a pas de file à trouver : il
 * entre en tête de la première, qui est la seule lecture possible d'un doigt
 * remonté au-delà du haut de la séance.
 */
function dropTarget(
  items: ArrangeItem[],
  from: number,
  to: number,
): { lane: string; rank: number } {
  const rest = items.filter((_, index) => index !== from);
  let rank = 0;

  for (let index = to - 1; index >= 0; index -= 1) {
    const item = rest[index];

    if (item?.type === 'lane') {
      return { lane: item.lane.key, rank };
    }

    rank += 1;
  }

  return { lane: items[0]?.type === 'lane' ? items[0].lane.key : EXTRAS_LANE, rank: 0 };
}

/** Combien d'exercices la séance porte, hors programme compris. */
function exerciseCount(program: SessionProgram): number {
  return (
    program.blocks.reduce(
      (sum, block) =>
        sum + block.groups.reduce((count, group) => count + group.exercises.length, 0),
      0,
    ) + program.extras.length
  );
}

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
  records,
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
  // Au plus une par exercice : `sessionRecords` retient la meilleure série, pas
  // toutes celles qui dépassent l'ancienne marque.
  const recordKey = records.get(exercise.key) ?? null;
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
        {exercise.groupLabel ? <Text style={styles.rank}>{exercise.groupLabel}</Text> : null}
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
            record={line.key === recordKey}
            onToggle={() => onCheck(exercise, line)}
            onAdjust={() => onAdjustSet(lineKey(exercise, line))}
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
 * Le déroulé en mode rangement (KL-52) : les files, et rien qu'elles.
 *
 * ## Le glisser-déposer, et le retour en arrière qu'il représente
 *
 * La première version rangeait aux **boutons**, et le disait longuement : viser
 * une poignée, maintenir, suivre une cible qui défile, relâcher au bon endroit,
 * ça fait quatre exigences de précision dans le contexte de KL-39 — debout, à
 * bout de bras, écran gras. C'était un raisonnement juste sur le mauvais geste.
 * Déplacer un exercice de la position 6 à la position 2 demandait **quatre**
 * appuis successifs, chacun suivi d'un re-rendu de la liste entière, la ligne
 * qu'on suit changeant de place à chaque fois — soit exactement le « suivre une
 * cible qui bouge » qu'on cherchait à éviter, en quatre fois.
 *
 * La bibliothèque est `react-native-reorderable-list`, et le choix se tient en
 * une ligne : elle est **entièrement en JavaScript**, posée sur Reanimated et
 * Gesture Handler, tous deux déjà là. Aucun module natif de plus, donc aucune
 * reconstruction du client de développement (voir CLAUDE.md, « Native modules »)
 * — la seule chose que l'app y gagne est une `GestureHandlerRootView` à la
 * racine, que rien ne montait jusqu'ici.
 *
 * ## Une seule liste, parce que les files se traversent
 *
 * Le montage d'origine était une liste imbriquée **par bloc**, dans un
 * `ScrollViewContainer`. Il tenait tant qu'un exercice ne sortait pas de sa
 * file, et il tombait dès qu'on voulait l'en sortir : la bibliothèque réordonne
 * une liste, elle ne fait pas passer d'une liste à l'autre, et aucune option ne
 * change ça. Or on mène le gainage d'échauffement entre deux séries de squat et
 * le finisseur avant la fin — refuser le geste n'empêchait pas la séance, ça
 * empêchait seulement de la dire à la barre basse.
 *
 * Donc **une liste plate pour la séance entière**, où les en-têtes de bloc sont
 * des lignes comme les autres (`arrangeItems`). Ce que la bibliothèque rend au
 * relâchement — un index de liste — se relit alors en file et en rang
 * (`dropTarget`), et traverser un titre est un mouvement continu, sans zone
 * morte entre deux blocs. Un en-tête ne se traîne pas lui-même : rien en lui
 * n'appelle `useReorderableDrag`.
 *
 * Une file vide garde son en-tête et affiche une **zone d'accueil** : c'est là
 * qu'on relâche pour y revenir, et un bloc qui disparaîtrait une fois vidé
 * serait un bloc dont on ne pourrait plus jamais s'approcher.
 *
 * ## Ce qui est vrai est en base, ici aussi
 *
 * Le relâchement **écrit** (`moveExerciseTo`), et la liste se redessine parce que
 * la base a republié — pas parce qu'un état local aurait bougé. C'est la règle de
 * l'écran (§1 de son en-tête), et elle vaut la peine d'être tenue jusqu'ici : un
 * ordre optimiste en mémoire serait une deuxième version de l'ordre, et deux
 * versions d'un même fait finissent toujours par diverger.
 */
function ArrangeBoard({
  program,
  freeform,
  bottomInset,
  onReset,
  onArrange,
  onReorder,
}: {
  program: SessionProgram;
  freeform: boolean;
  /** Le dégagement sous la page : la barre basse mesurée, ou la zone sûre. */
  bottomInset: number;
  onReset: () => void;
  onArrange: (exerciseKey: string, action: ArrangeAction) => void;
  onReorder: (exerciseKey: string, lane: string, to: number) => void;
}) {
  const lanes = useMemo(() => arrangeLanes(program, freeform), [program, freeform]);
  const items = useMemo(() => arrangeItems(lanes), [lanes]);
  const reducedMotion = useReducedMotion();

  return (
    <ReorderableList
      data={items}
      keyExtractor={(item) => item.key}
      contentContainerStyle={[styles.arrangePage, { paddingBottom: bottomInset }]}
      // Le mouvement est le seul de cet écran qui ne passe pas par
      // `useReducedMotion` sans qu'on lui dise : la bibliothèque anime le
      // replacement des lignes, on lui coupe la durée.
      animationDuration={reducedMotion ? 0 : undefined}
      ListHeaderComponent={
        /* Ranger le déroulé se dit, sinon la disparition des séries se lit comme
           une panne — et la portée de ce qu'on fait doit être écrite : rien de ce
           qui se range ici ne part au serveur. */
        <View style={styles.notice}>
          <Text style={styles.body}>
            Range la séance dans l’ordre où tu la mènes : tire un exercice par sa poignée, d’un bloc
            à l’autre si c’est là que tu le fais. Ça ne change pas le programme et ne part pas au
            serveur : ça décide de ce que la barre du bas propose.
          </Text>
          {program.reordered ? (
            <Button
              label="Rétablir l’ordre du programme"
              variant="ghost"
              block
              accessibilityHint="Le déroulé retrouve l’ordre prescrit. Rien de consigné n’est perdu"
              onPress={onReset}
            />
          ) : null}
        </View>
      }
      onReorder={({ from, to }) => {
        const moved = items[from];

        if (moved?.type !== 'exercise') {
          return;
        }

        const { lane, rank } = dropTarget(items, from, to);

        onReorder(moved.exercise.key, lane, rank);
      }}
      renderItem={({ item }) =>
        item.type === 'lane' ? (
          <ArrangeLaneHead lane={item.lane} />
        ) : (
          <ArrangeRow
            exercise={item.exercise}
            first={item.first}
            last={item.last}
            canUp={item.canUp}
            canDown={item.canDown}
            onArrange={onArrange}
          />
        )
      }
    />
  );
}

/**
 * Le titre d'une file, en ligne de liste.
 *
 * Il porte la zone d'accueil des files vides, **dans le même item** plutôt que
 * dans une ligne à lui : une ligne de plus décalerait tous les index que
 * `dropTarget` relit, pour ne rien dire de plus que ce titre.
 */
function ArrangeLaneHead({ lane }: { lane: ArrangeLane }) {
  return (
    <View style={[styles.arrangeLane, lane.exercises.length === 0 && styles.arrangeLaneClosed]}>
      <View style={styles.blockHead}>
        {lane.number ? <Text style={styles.blockNumber}>{lane.number}</Text> : null}
        <Text accessibilityRole="header" style={styles.blockRole}>
          {lane.title}
        </Text>
        {lane.label ? <Text style={styles.blockLabel}>{lane.label}</Text> : null}
      </View>

      {lane.exercises.length === 0 ? (
        <Text style={styles.arrangeEmpty}>Relâche un exercice ici pour le mener dans ce bloc.</Text>
      ) : null}
    </View>
  );
}

/**
 * Un exercice, réduit à ce qu'il faut pour le ranger (KL-52).
 *
 * ## Ce que la ligne dit, et ce qu'elle tait
 *
 * Le nom, son rang d'enchaînement, une poignée, et rien d'autre : ni séries, ni
 * historique, ni consigne. Ranger est une vue de haut, et un déroulé complet ne
 * tient pas à l'écran — on ne déplace pas ce qu'on ne voit pas. Un exercice
 * **sauté** garde sa marque : il reste dans l'ordre, il est réglé, pas absent.
 *
 * ## La poignée, et le déplacement au clavier qu'elle porte quand même
 *
 * Le glisser-déposer n'existe pas pour TalkBack : il n'y a rien à traîner quand
 * on navigue au balayage. La poignée porte donc deux **actions d'accessibilité**,
 * « Monter » et « Descendre », qui appellent le déplacement d'un cran resté dans
 * `order.ts`. C'est le chemin d'origine, conservé là où il est le seul possible,
 * et il ne coûte pas une cible de plus à l'écran.
 *
 * Le geste part à l'**appui**, pas à l'appui long : la poignée est une zone
 * dédiée, rien d'autre ne s'y déclenche, et attendre une demi-seconde avant que
 * la ligne décolle se lit comme un écran qui ne répond pas. La page, elle, se
 * fait défiler partout ailleurs sur la ligne.
 *
 * ## L'enchaînement reste un bouton, et un seul
 *
 * Traîner ne sait pas dire « et celui-ci est enchaîné au précédent » : c'est une
 * autre question que la place. Les deux gestes sont **un seul bouton**, parce
 * qu'ils sont un seul fait vu des deux côtés — ou l'exercice est lié à celui qui
 * le précède, ou il ne l'est pas. Il porte le rang dans son libellé (« Détacher
 * de A »), seule façon de savoir de quoi on se détache sans compter les rails à
 * l'œil.
 */
function ArrangeRow({
  exercise,
  first,
  last,
  canUp,
  canDown,
  onArrange,
}: {
  exercise: SessionExercise;
  /** En tête de sa file : rien ne le précède **ici**, donc rien à quoi l'enchaîner. */
  first: boolean;
  /** En queue de sa file : c'est lui qui referme le cadre du bloc. */
  last: boolean;
  /** Un cran plus haut existe dans la séance — pas forcément dans cette file. */
  canUp: boolean;
  canDown: boolean;
  onArrange: (exerciseKey: string, action: ArrangeAction) => void;
}) {
  const drag = useReorderableDrag();
  const chained = exercise.groupLabel !== null;
  const previous = chained ? (exercise.groupLabel?.replace(/\d+$/, '') ?? null) : null;

  return (
    <View style={[styles.arrange, last && styles.arrangeLast]}>
      <View style={styles.arrangeHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Déplacer ${exercise.name}`}
          accessibilityHint="Tire pour changer sa place, dans ce bloc ou dans un autre"
          // Ce que TalkBack propose à la place du glissement, qu'il ne sait pas
          // faire. Les deux actions sont annoncées, jamais grisées : une action
          // absente au bord de la séance est plus claire qu'une action inerte.
          // Le bord est celui de la **séance**, pas de la file : au bout d'un
          // bloc, « Descendre » entre dans le suivant, et c'est le seul chemin
          // qu'a le balayage vers un autre bloc.
          accessibilityActions={[
            ...(canUp ? [{ name: 'moveUp', label: 'Monter' }] : []),
            ...(canDown ? [{ name: 'moveDown', label: 'Descendre' }] : []),
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'moveUp') {
              onArrange(exercise.key, 'up');
            } else if (event.nativeEvent.actionName === 'moveDown') {
              onArrange(exercise.key, 'down');
            }
          }}
          onPressIn={drag}
          style={({ pressed }) => [styles.grip, pressed && styles.gripPressed]}
        >
          <Icon name="grip-vertical" color={colors.textSecondary} />
        </Pressable>

        {exercise.groupLabel ? <Text style={styles.rank}>{exercise.groupLabel}</Text> : null}
        <Text style={styles.name} numberOfLines={2}>
          {exercise.name}
        </Text>
        <View style={styles.spacer} />
        {exercise.skipped ? <Chip label="Sauté" /> : null}
      </View>

      <View style={styles.arrangeActions}>
        <Button
          label={chained ? `Détacher${previous ? ` de ${previous}` : ''}` : 'Enchaîner'}
          variant="ghost"
          size="sm"
          disabled={!chained && first}
          accessibilityLabel={
            chained ? `Détacher ${exercise.name} de son enchaînement` : `Enchaîner ${exercise.name}`
          }
          accessibilityHint={
            chained
              ? 'Il se mènera seul, avec son repos'
              : first
                ? 'Rien ne le précède dans ce bloc'
                : 'Il s’enchaîne sans repos avec l’exercice juste au-dessus'
          }
          onPress={() => onArrange(exercise.key, chained ? 'unchain' : 'chain')}
        />
      </View>
    </View>
  );
}

/**
 * La barre basse du rangement (KL-52).
 *
 * Elle occupe la place de la validation, et c'est le point : la barre est le seul
 * endroit de l'écran dont le pouce connaît la position (KL-39), et le mode dans
 * lequel on est doit se lire là plutôt qu'en haut. Un seul geste, donc — sortir —
 * et rien à valider : chaque déplacement est déjà écrit quand il s'affiche.
 */
function ArrangeDock({
  onHeight,
  onDone,
}: {
  onHeight: (height: number) => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => () => onHeight(0), [onHeight]);

  return (
    <View
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      style={[styles.dock, { paddingBottom: insets.bottom }]}
    >
      <View style={styles.dockAction}>
        <Button
          label="Terminer le rangement"
          size="lg"
          block
          accessibilityHint="Revenir au déroulé. L’ordre est déjà enregistré"
          onPress={onDone}
        />
      </View>
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
 * « Aujourd'hui » reste utile et ne rattrape plus rien : ce n'est plus la séance
 * en cours qu'il désignait — `replaceHistory()` la tient hors de cette table —
 * mais une **autre** séance du jour, faite et poussée le matin, qui est bien la
 * dernière fois qu'on a touché cet exercice. Au-delà d'hier, le quantième est plus
 * parlant qu'un décompte de jours : on se souvient d'un jeudi, pas d'un « il y a
 * 9 jours ».
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
 * Une série : une ligne, deux cibles.
 *
 * **Une ligne se lit, se corrige et se coche** (KL-30, revu). La zone de valeurs
 * ouvre la feuille, la case coche ou décoche — et c'est vrai **avant** comme
 * après, ce qui n'était pas le cas : la ligne pas encore faite cochait sur toute
 * sa largeur, et corriger une valeur demandait donc de cocher d'abord. Quatre
 * séries chargées autrement qu'écrit se réglaient en huit gestes, la moitié
 * consistant à déclarer faite une série qu'on n'avait pas encore commencée.
 *
 * La case garde une cible au plancher tactile de son côté, et la barre basse
 * reste le chemin court du cas nominal : on ne perd pas le geste rapide, on
 * cesse seulement de le faire déborder sur toute la ligne. C'est aussi ce qui
 * évite l'appui long, qui ne se voit nulle part.
 *
 * **Ce qu'une ligne affiche** est le fait quand il existe, la correction posée
 * d'avance sinon, le prescrit en dernier (`lineValues`) — et le prévu reste écrit
 * à côté dès que les deux divergent, avant comme après.
 *
 * **Rien ne déborde et rien ne se coupe, à aucune largeur.** Une ligne dont les
 * deux valeurs sont corrigées en porte quatre — « 17 reps 12 reps … 34 kg 40 kg »
 * — et sur un écran étroit elles passaient sous la case à cocher, puis hors du
 * filet.
 *
 * La cause tient en une ligne : **en React Native le `minWidth` par défaut vaut
 * 0**, là où le web applique `min-width: auto`, c'est-à-dire la largeur minimale
 * du contenu. Une boîte à qui l'on permet de se serrer peut donc descendre sous
 * la largeur de son propre texte, et Android coupe alors le mot où il peut — le
 * « rep / s » qu'aucun réglage de proportions ne rattrape. Tant qu'une boîte se
 * serre, aucune largeur d'écran n'est sûre, et régler la répartition du manque
 * de place entre deux boîtes ne fait que déplacer la coupure.
 *
 * Donc **aucun `flexShrink` dans les valeurs**. La seule élasticité est
 * `flexGrow`, qui n'ajoute que du vide, et `flexWrap`, qui déplace des blocs
 * mesurés à leur vraie largeur.
 *
 * Et surtout : **le prévu passe sous le saisi, barré et sans son unité**, au
 * lieu de s'écrire à côté de lui.
 *
 * ```
 * 01   10 reps      30 kg   ☐
 *      1̶2̶           2̶5̶
 * ```
 *
 * Ce que ça règle est la cause et non le symptôme. Une ligne corrigée ne
 * demandait pas la largeur d'une ligne ordinaire mais le double, parce qu'elle
 * écrivait « reps » et « kg » deux fois chacun pour des nombres qui se lisent
 * l'un sous l'autre ; elle demande maintenant exactement la même largeur qu'une
 * ligne qui va comme prévu, à toutes les tailles d'écran. La barre dit « c'était
 * ça » mieux qu'un mot ne le dirait, et sans dépenser un caractère. Ce qui
 * cède ensuite, s'il le faut vraiment, est la charge qui passe sous l'effort —
 * puis, seulement en dessous de toute largeur de téléphone, l'unité qui passe
 * sous son nombre.
 *
 * Mesuré sur émulateur, série corrigée sur les deux valeurs, de 420 à 260 dp.
 *
 * L'unité s'écrit enfin **un pas plus bas** (`Measure`, `text.numericMinor`) :
 * ce qu'on lit d'une série est le nombre, « reps » se reconnaît sans se lire.
 * La valeur barrée partage ce rôle — c'est un chiffre sous un chiffre, il
 * s'aligne au caractère près, donc en mono comme lui.
 *
 * **Pas de glyphe** : un « ✓ » dépendrait de ce que Barlow contient. Une case
 * pleine à l'encre dit la même chose et ne peut pas manquer.
 */
function SetRow({
  line,
  editable,
  record,
  onToggle,
  onAdjust,
}: {
  line: SessionSetLine;
  editable: boolean;
  /** Cette série bat le record de son exercice (`sessionRecords`). */
  record: boolean;
  onToggle: () => void;
  onAdjust: () => void;
}) {
  const checked = line.logged !== null;
  const values = lineValues(line);
  const effortParts = values ? setEffortParts(values.reps, values.durationSeconds) : null;
  // La ligne se **peint** en deux morceaux, elle ne se **dit** pas en deux
  // morceaux : les libellés lisent la phrase entière.
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

      {/* Le prévu reste à côté du saisi dès qu'ils divergent : c'est l'écart, et
          c'est la seule chose que la ligne ne peut pas se permettre de taire.
          Chaque valeur et son prévu forment une paire, et les deux paires se
          replient l'une sous l'autre plutôt que de se serrer (§ « rien ne
          déborde »). Aucun `spacer` ici : ce sont les paires qui poussent, un
          `spacer` en `flex: 1` disparaîtrait au moment du repli. */}
      <View style={styles.setPairs}>
        <View style={styles.setPair}>
          <Measure
            parts={effortParts}
            style={[styles.setEffort, !checked && !actionable && styles.setFaint]}
          />
          {setDeviates(line, 'reps') || setDeviates(line, 'durationSeconds') ? (
            <Text style={styles.setPlanned}>
              {setEffortParts(line.planned?.reps ?? null, line.planned?.durationSeconds ?? null)
                ?.value ?? ''}
            </Text>
          ) : null}
        </View>

        <View style={[styles.setPair, styles.setPairEnd]}>
          <Measure
            parts={load !== null ? weightParts(load) : null}
            empty=""
            style={[styles.setLoad, !checked && !actionable && styles.setFaint]}
          />
          {setDeviates(line, 'weightKg') ? (
            <Text style={styles.setPlanned}>{weightParts(line.planned?.weightKg ?? 0).value}</Text>
          ) : null}
        </View>
      </View>

      {/* Le record, dans une gouttière **toujours réservée** : une marque qui
          pousserait la ligne au moment où on la coche ferait bouger la cible
          juste sous le pouce. Une forme dessinée et non un glyphe, pour la
          raison du « ✓ » plus haut — un « ◆ » dépendrait de ce que Barlow
          contient. Rouge parce que c'est de l'intensité, l'un de ses trois sens. */}
      <View style={styles.setRecordSlot}>{record ? <View style={styles.setRecord} /> : null}</View>
    </>
  );

  // Une **série faite en trop** n'a pas de prescrit à corriger d'avance : la
  // feuille ne s'y ouvre que parce qu'elle est faite. Une ligne prescrite, elle,
  // se corrige avant comme après.
  const adjustable = editable && (checked || line.planned !== null);

  return (
    <View style={[styles.setRow, checked && styles.setRowChecked]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${setRowLabel(line, effort, load, record)}. ${
          checked ? 'Ajuster' : 'Corriger avant de la faire'
        }`}
        accessibilityHint={
          checked
            ? 'Corriger les valeurs, ou supprimer cette série'
            : 'Changer les valeurs de cette série. Elle reste à cocher'
        }
        disabled={!adjustable}
        onPress={onAdjust}
        style={({ pressed }) => [styles.setValues, pressed && adjustable && styles.setRowPressed]}
      >
        {body}
      </Pressable>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !actionable }}
        accessibilityLabel={
          checked ? 'Annuler cette série' : setRowLabel(line, effort, load, record)
        }
        accessibilityHint={
          actionable
            ? checked
              ? undefined
              : 'Consigner cette série'
            : // Dire *pourquoi* la case ne répond pas : sans ça, un appui sans
              // effet passe pour un écran figé.
              checked
              ? 'Seule la dernière série faite peut être annulée'
              : 'La série précédente n’est pas encore faite'
        }
        disabled={!actionable}
        onPress={onToggle}
        style={({ pressed }) => [styles.boxTarget, pressed && actionable && styles.setRowPressed]}
      >
        <View
          style={[
            styles.box,
            checked && styles.boxChecked,
            !checked && !actionable && styles.boxIdle,
          ]}
        />
      </Pressable>
    </View>
  );
}

/**
 * Une grandeur : le nombre, puis son unité **un pas plus petite**.
 *
 * « 17 » se lit, « reps » se reconnaît — et l'unité, qui se répète à chaque
 * ligne, cesse de prendre la place du chiffre suivant. Sur une ligne dont les
 * deux valeurs sont corrigées, ce sont quatre unités écrites sur une largeur qui
 * en portait déjà trop.
 *
 * Deux `Text` imbriqués et non deux voisins : TalkBack lit l'ensemble comme une
 * seule phrase (« dix-sept reps »), et la ligne de base reste commune — un
 * `Text` frère alignerait deux tailles par leur milieu.
 *
 * **L'espace y est ordinaire, et c'est délibéré.** Une espace insécable a été
 * essayée : elle fait exactement l'inverse de ce qu'on en attend. Elle ne
 * protège rien tant que rien ne se serre — et le jour où la largeur manque pour
 * de bon, elle transforme « 34,5 kg » en un seul mot que Android coupe alors où
 * il peut, « 34,5 k / g ». Avec une espace ordinaire, la coupure tombe là où
 * elle doit : « 34,5 » puis « kg ». C'est le dernier étage du repli, celui qui
 * ne se produit qu'en dessous de toute largeur de téléphone, et il vaut mieux
 * qu'il soit lisible que théoriquement interdit.
 */
function Measure({
  parts,
  empty = '—',
  style,
}: {
  parts: MeasureParts | null;
  /** Ce qui s'écrit quand il n'y a rien à écrire. */
  empty?: string;
  style: StyleProp<TextStyle>;
}) {
  if (parts === null) {
    return <Text style={style}>{empty}</Text>;
  }

  return (
    <Text style={style}>
      {parts.value}
      {parts.unit === null ? null : <Text style={styles.setUnit}>{` ${parts.unit}`}</Text>}
    </Text>
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
      {/* `summary` est une phrase, pas un nombre : elle passe à la ligne au lieu
          de pousser « À faire » et la case hors de l'écran. */}
      <Text style={[styles.setEffort, styles.setSummary, !checked && !editable && styles.setFaint]}>
        {summary}
      </Text>
      <View style={styles.spacer} />
      <Text style={styles.caption}>{checked ? 'Fait' : 'À faire'}</Text>
      <View style={[styles.box, checked && styles.boxChecked, !editable && styles.boxIdle]} />
    </Pressable>
  );
}

/**
 * La feuille d'une série (KL-30), avant comme après.
 *
 * Le prescrit est en tête, jamais remplacé par ce qu'on saisit : c'est la
 * dernière case du ticket, et c'est la seule façon de voir l'écart au moment où
 * on le crée.
 *
 * ## Deux moments, une seule feuille
 *
 * **Une série faite** s'y corrige, et la correction va en base (`updateSet`).
 * **Une série à faire** s'y prépare, et rien ne va en base : « Valider » note les
 * valeurs sur la ligne (`onOverride`), la série reste à cocher, et c'est la coche
 * qui consigne — la seule écriture de « une série a été faite » reste `checkSet`.
 *
 * Une seule feuille pour les deux, parce que c'est une seule question — quelles
 * valeurs pour cette série — posée à deux moments. Deux feuilles auraient
 * dupliqué la bascule d'axe, les compteurs et leurs bornes pour ne changer qu'un
 * verbe. Ce qui diffère est écrit là où ça diffère : le RPE, qui se ressent, n'a
 * rien à dire d'une série pas encore faite ; « Supprimer » devient « Rétablir le
 * prévu », parce qu'on ne supprime pas ce qui n'existe pas encore.
 *
 * Ce qu'on y gagne est ce qui manquait : charger la barre à 82,5 kg pour les
 * quatre séries se dit **une fois par série avant de commencer**, au lieu de
 * cocher-puis-corriger quatre fois — c'est-à-dire au lieu de déclarer faites,
 * quatre fois, des séries qui ne l'étaient pas.
 *
 * **Zéro veut dire « rien à dire », pas « zéro »**. Le compteur ne sait pas
 * représenter l'absence, et une série au poids du corps n'a pas de charge — la
 * distinction se perdrait dans un champ vide. Une série à 0 répétition n'existe
 * pas de toute façon : elle se supprime.
 *
 * **Le type de série ne s'édite pas** : il décide de la file d'appariement, le
 * changer déplacerait le rang de toutes les suivantes (`deviations.ts`).
 *
 * **L'axe de saisie, si** (KL-52), et c'est une autre question. Répétitions ou
 * durée n'est pas un rang, c'est ce que la série **compte** : un gainage se
 * chronomètre, un développé se compte. Le prescrit tranche quand il y en a un —
 * et il reste alors seul maître, sinon la valeur saisie ne se comparerait plus à
 * rien. Un exercice **hors programme** n'a personne pour trancher : il naissait
 * donc en répétitions et n'en sortait jamais, ce qui rendait la moitié de la
 * bibliothèque insaisissable. La bascule est ici, sur la série, parce que c'est
 * là qu'on s'en aperçoit ; la série suivante en hérite d'elle-même, le brouillon
 * se pré-remplissant sur la dernière faite (`draftSetValues`).
 *
 * Les deux axes ne coexistent jamais : basculer **efface** l'autre. Une série qui
 * porterait 10 répétitions *et* 45 secondes serait lue par les répétitions
 * partout — ici, dans l'historique, dans le résumé (`setEffort`) — donc le chrono
 * serait une valeur invisible qui voyagerait quand même jusqu'au serveur.
 */
function SetSheet({
  scheduledUuid,
  exercise,
  line,
  onOverride,
  onClose,
}: {
  scheduledUuid: string;
  exercise: SessionExercise;
  line: SessionSetLine;
  /** Pose la correction d'une série pas encore faite. `null` la retire. */
  onOverride: (values: SetValues | null) => void;
  onClose: () => void;
}) {
  const logged = line.logged;
  // Une série **pas encore faite** : la feuille ne consigne rien, elle note ce
  // qu'on va y mettre (§ en-tête).
  const pending = logged === null;
  // Ce sur quoi la feuille s'ouvre : le fait, la correction déjà posée, le
  // prescrit — le même ordre que la ligne (`lineValues`), sinon la feuille
  // afficherait autre chose que ce qu'on vient d'appuyer.
  const opening = lineValues(line);
  // Elle n'écoute plus la base ensuite : une saisie en cours ne doit pas être
  // réécrite sous les doigts. Elle est rendue par une clé (`openSet`), donc
  // remontée si la série change d'identité.
  const [values, setValues] = useState<LoggedSetValues>(() => ({
    reps: opening?.reps ?? null,
    weightKg: opening?.weightKg ?? null,
    durationSeconds: opening?.durationSeconds ?? null,
    rpe: logged?.rpe ?? null,
  }));

  // Reps ou durée : ce que la série porte, à défaut ce que le prescrit demandait.
  // Jamais les deux — un exercice se compte en répétitions ou en secondes.
  const patch = (part: Partial<LoggedSetValues>) =>
    setValues((current) => ({ ...current, ...part }));
  const zeroToNull = (value: number) => (value > 0 ? value : null);

  const [timed, setTimed] = useState(
    () => (opening?.durationSeconds ?? null) !== null && (opening?.reps ?? null) === null,
  );

  // La bascule ne s'offre que là où personne n'a déjà tranché : une ligne du
  // programme dit ce qu'elle demande, et saisir des secondes en face de « 8 reps »
  // ne serait plus une déviation, ce serait une réponse à une autre question.
  const switchable =
    (line.planned?.reps ?? null) === null && (line.planned?.durationSeconds ?? null) === null;

  // Basculer efface l'autre axe : les deux ne coexistent pas (§ en-tête).
  const switchTo = (next: boolean) => {
    setTimed(next);
    patch(next ? { reps: null } : { durationSeconds: null });
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Série ${String(line.index).padStart(2, '0')}${pending ? ' · à faire' : ''}`}
      footer={
        <View style={styles.sheetActions}>
          {/* Une série faite se supprime — elle n'a finalement pas eu lieu. Une
              série à faire n'a rien à supprimer : ce qu'on y défait est la
              correction, et le mot juste est donc « rétablir le prévu ». Elle
              n'apparaît qu'une fois qu'il y a quelque chose à rétablir. */}
          {pending ? (
            line.override ? (
              <Button
                label="Rétablir le prévu"
                variant="ghost"
                accessibilityHint="La série repart sur les valeurs du programme"
                onPress={() => {
                  onOverride(null);
                  onClose();
                }}
              />
            ) : null
          ) : (
            <Button
              label="Supprimer"
              variant="ghost"
              accessibilityHint="Cette série n’a finalement pas été faite"
              onPress={() => {
                deleteSet(scheduledUuid, exercise, line);
                onClose();
              }}
            />
          )}
          <View style={styles.spacer} />
          <Button
            label="Valider"
            accessibilityHint={
              pending ? 'Les valeurs sont notées sur la série. Elle reste à cocher' : undefined
            }
            onPress={() => {
              if (pending) {
                onOverride({
                  reps: values.reps,
                  weightKg: values.weightKg,
                  durationSeconds: values.durationSeconds,
                });
              } else {
                updateSet(scheduledUuid, line, values);
              }

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

      {/* Deux pilules de facette, pas un interrupteur : ce sont deux choix
          exclusifs qui se nomment, et `FilterChip` est déjà le contrôle de ce
          cas-là dans l'app (le sélecteur d'exercice). */}
      {switchable ? (
        <View style={styles.axis}>
          <FilterChip
            label="Répétitions"
            selected={!timed}
            accessibilityHint="Compter cette série en répétitions"
            onPress={() => switchTo(false)}
          />
          <FilterChip
            label="Durée"
            selected={timed}
            accessibilityHint="Chronométrer cette série. Les répétitions saisies sont effacées"
            onPress={() => switchTo(true)}
          />
        </View>
      ) : null}

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

      {/* Le RPE se **ressent** : il n'a rien à faire sur une série pas encore
          faite, et `checkSet` l'écrit `null` pour la même raison. Il apparaît
          une fois la série cochée, quand la question a un sens. */}
      {pending ? null : (
        <>
          <NumberStepper
            label="RPE ressenti"
            value={values.rpe ?? 0}
            onChange={(next) => patch({ rpe: zeroToNull(next) })}
            step={1}
            max={10}
          />
          <Text style={styles.caption}>RPE à 0 : non renseigné. Le prescrit garde le sien.</Text>
        </>
      )}
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
function setRowLabel(
  line: SessionSetLine,
  effort: string | null,
  load: number | null,
  record = false,
): string {
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

  // L'écart, à la voix. À l'écran il se lit d'une barre sous le chiffre ; une
  // barre ne s'entend pas, et le prévu a perdu son unité en passant dessous —
  // « 12 » seul ne dirait plus rien. C'est pourtant la chose que la ligne ne
  // peut pas taire, alors elle se dit ici en toutes lettres.
  const missed = [
    setDeviates(line, 'reps') || setDeviates(line, 'durationSeconds')
      ? setEffort(line.planned?.reps ?? null, line.planned?.durationSeconds ?? null)
      : null,
    setDeviates(line, 'weightKg') ? weight(line.planned?.weightKg ?? 0) : null,
  ].filter((value): value is string => value !== null);

  if (missed.length > 0) {
    parts.push(`au lieu de ${missed.join(' × ')}`);
  }

  // Le mot que le losange ne dit pas. À l'écran il se lit dans sa gouttière ;
  // une forme ne s'entend pas, et c'est la seule chose de la ligne qui soit une
  // nouvelle.
  if (record) {
    parts.push('record');
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
    gap: space[2],
    paddingHorizontal: space[8],
    paddingVertical: space[4],
    backgroundColor: colors.surfaceRaised,
    borderBottomWidth: layout.hairline,
    borderBottomColor: colors.border,
  },

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

  // La ligne du rangement (KL-52). Elle a le rembourrage d'un exercice et son
  // filet de séparation : c'est le même déroulé, vu de plus haut.
  // L'axe de saisie d'une série hors programme (KL-52), au-dessus de son compteur.
  axis: { flexDirection: 'row', gap: space[4] },

  // Le rangement est **une seule liste** pour la séance entière, donc les files
  // n'ont plus de conteneur qui les encadre : le cadre est reconstitué ligne à
  // ligne — côtés sur chacune, haut sur l'en-tête, bas sur la dernière.
  // Le `gap` de `page` est absent d'ici pour la même raison : appliqué au
  // conteneur d'une liste, il aurait écarté chaque ligne de sa voisine.
  arrangePage: { padding: space[8], paddingBottom: space[13] },
  arrangeLane: {
    marginTop: space[8],
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  /** Une file vide n'a aucune ligne pour la refermer : elle se ferme elle-même. */
  arrangeLaneClosed: { borderBottomWidth: layout.hairline },
  arrangeEmpty: {
    ...text.caption,
    color: colors.textSecondary,
    paddingHorizontal: space[7],
    paddingVertical: space[6],
  },

  arrange: {
    gap: space[4],
    paddingHorizontal: space[7],
    paddingVertical: space[6],
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
    borderLeftWidth: layout.hairline,
    borderRightWidth: layout.hairline,
    borderLeftColor: colors.border,
    borderRightColor: colors.border,
  },
  arrangeLast: { borderBottomWidth: layout.hairline, borderBottomColor: colors.border },
  arrangeHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  arrangeActions: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  // La poignée. Elle prend le plancher tactile en entier (`touchTarget`) alors
  // que l'icône fait 20 points : c'est la seule cible de la ligne, et on la vise
  // à bout de bras. Le décalage négatif lui rend ce qu'elle prend au rembourrage
  // de la ligne, sinon le nom se décalerait de dix points en mode rangement.
  grip: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    marginLeft: -space[5],
  },
  gripPressed: { backgroundColor: colors.fill },

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
  // Le cardio est une seule cible — fait ou pas fait, il n'y a rien à corriger —
  // donc le rembourrage est sur la ligne. Une série en porte deux, chacune avec
  // le sien (§ une ligne, deux cibles).
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
  // L'unité, dans le `Text` imbriqué du nombre : ni couleur ni graisse propres,
  // elle hérite de l'encre de la ligne — c'est la même valeur, pas une mention.
  //
  // **Sans `lineHeight`** : sur Android il ne s'applique pas au fragment mais à
  // la ligne qui le contient, et une hauteur calculée pour du 13 rognerait le
  // nombre en 16 juste à côté. Le rôle en pose un, l'imbrication le retire.
  setUnit: { ...text.numericMinor, lineHeight: undefined },
  // La valeur remplacée, **barrée sous celle qui la remplace** et sans son
  // unité : « kg » est déjà écrit au-dessus, à la même place, et une colonne de
  // deux nombres se compare sans qu'on les nomme deux fois. La barre porte à
  // elle seule le « c'était » — pas de mot, pas de couleur, et rien qui puisse
  // se confondre avec la valeur en cours.
  //
  // En mono comme le nombre qu'elle double, pas en `caption` : c'est un chiffre
  // sous un chiffre, il s'aligne au caractère près.
  setPlanned: {
    ...text.numericMinor,
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  // Les valeurs de la ligne : deux colonnes (le saisi, la valeur qu'il remplace
  // barrée dessous), côte à côte tant qu'elles tiennent.
  //
  // **Aucun `flexShrink` nulle part ici, et c'est la règle qui tient tout.** En
  // React Native le `minWidth` par défaut vaut 0 — le web applique `min-width:
  // auto`, soit la largeur minimale du contenu, React Native non. Une boîte qui
  // se serre peut donc passer sous la largeur de son texte, et Android coupe
  // alors le mot où il peut (« rep / s »). Tant qu'une boîte se serre, aucune
  // largeur d'écran n'est sûre. Ici rien ne se serre : la seule élasticité est
  // `flexGrow`, qui n'ajoute que du vide, et `flexWrap`, qui déplace des
  // colonnes entières mesurées à leur vraie largeur.
  //
  // L'empilement fait le reste : une ligne corrigée ne demande plus que « 10
  // reps » et « 30 kg » sur sa première ligne — ce que le prévu écrivait à côté
  // est passé dessous, sans unité. La largeur d'une ligne corrigée est devenue
  // celle d'une ligne ordinaire.
  setPairs: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    // `flex-start` et non `baseline` : les deux paires commencent par un `Text`
    // du même rôle, leurs lignes de base coïncident donc déjà, et une ligne de
    // base demandée à une boîte qui se replie se lit de son premier enfant —
    // une subtilité de plus pour un résultat identique.
    alignItems: 'flex-start',
    columnGap: space[4],
    rowGap: space[1],
  },
  // Une colonne : la valeur, et sous elle celle qu'elle remplace. `flexGrow` et
  // non un `spacer` : sur la ligne où les deux colonnes tiennent, le vide se
  // partage entre elles et les pousse aux deux bords ; sur une ligne où l'une
  // est seule, elle prend toute la largeur et son contenu s'aligne du bon côté.
  // Un `spacer` en `flex: 1` aurait tenu le premier cas et pas le second.
  //
  // `alignItems` place la valeur barrée **sous** le chiffre qu'elle double, du
  // côté où ce chiffre est écrit : à gauche pour l'effort, à droite pour la
  // charge. Sans ça la barre pendrait au milieu de rien.
  setPair: {
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'flex-start',
    rowGap: space[1],
  },
  setPairEnd: { alignItems: 'flex-end' },
  // Le seul `flexShrink` de la ligne, et il ne contredit pas la règle : le
  // résumé d'un cardio est une **phrase**, pleine d'espaces où passer à la
  // ligne. Une valeur n'en a aucun — c'est toute la différence, et c'est
  // pourquoi elle ne se serre pas et qu'une phrase le peut.
  setSummary: { flexShrink: 1 },

  setBadgeSlot: { width: 22, alignItems: 'center' },
  // La gouttière du record, en fin de valeurs. **Toujours là**, vide la plupart
  // du temps : elle se réserve une fois pour toutes plutôt que d'apparaître au
  // moment où l'on coche, ce qui décalerait la ligne sous le pouce. Étroite,
  // parce qu'elle prend sa place aux valeurs, qui n'en ont pas de trop
  // (§ « rien ne déborde »).
  setRecordSlot: { width: 12, alignItems: 'center' },
  // Un losange dessiné, pas un caractère : un « ◆ » dépendrait de ce que Barlow
  // contient, comme le « ✓ » de la case. Un carré tourné d'un huitième de tour,
  // que toutes les polices du monde rendent pareil.
  setRecord: {
    width: 8,
    height: 8,
    backgroundColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
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
