import { sql } from 'drizzle-orm';

import { db } from './client';
import {
  exercise,
  exerciseHistory,
  loggedExercise,
  loggedSet,
  mutationQueue,
  prescribedSnapshot,
  scheduledWorkout,
  SYNC_STATE_ID,
  syncState,
} from './schema';
import { localDate, nowIso } from './time';
import type { PrescribedBlock } from './types';
import { uuidv7 } from './uuid';

/**
 * Le jeu de données de démonstration (KL-24).
 *
 * ## À quoi il sert
 *
 * Les écrans du lot 4 se construisent avant que le moteur de synchronisation
 * existe (KL-27) : sans données locales, « Aujourd'hui » n'a rien à afficher et
 * « Séance en cours » n'a rien à dérouler. Ce jeu remplit la base avec ce que le
 * bootstrap descendrait, et il le remplit **avec les cas qui cassent** — un
 * superset, un exercice sauté, une séance libre, une séance faite dont l'écart au
 * prévu est visible, une mutation en attente de push.
 *
 * ## Ce qu'il n'est pas
 *
 * Ni une fixture de test (KL-36 les écrira, avec ses propres jeux minimaux), ni
 * un chemin de production : `seedDemo()` est gardée par `__DEV__` et refuse de
 * s'exécuter dans un build de production. Injecter de fausses séances dans le
 * réalisé de quelqu'un les enverrait au serveur au push suivant.
 *
 * ## Les dates sont relatives
 *
 * Tout est daté par rapport à aujourd'hui, jamais en dur : la fenêtre du
 * bootstrap va de J-30 à J+14, un jeu figé en sortirait au bout d'un mois et
 * l'écran « Aujourd'hui » se retrouverait vide sans qu'on comprenne pourquoi.
 */

function dayOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return localDate(date);
}

/** Un instant, à `hour`:`minute` locales, `days` jours d'ici. Rendu en UTC. */
function instant(days: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);

  return date.toISOString();
}

const EXERCISES = [
  {
    id: 106,
    name: 'Développé couché',
    description: 'Barre au niveau des pectoraux, coudes à 45°, pause à la poitrine.',
    activity: 'gym' as const,
    targetAreas: ['chest', 'triceps', 'shoulders'] as const,
    global: true,
  },
  {
    id: 107,
    name: 'Développé incliné à la machine convergente',
    description: null,
    activity: 'gym' as const,
    targetAreas: ['chest', 'shoulders'] as const,
    global: true,
  },
  {
    id: 112,
    name: 'Tractions pronation',
    description: 'Amplitude complète, bras tendus en bas.',
    activity: 'gym' as const,
    targetAreas: ['back', 'biceps'] as const,
    global: true,
  },
  {
    id: 118,
    name: 'Rowing barre buste penché',
    description: null,
    activity: 'gym' as const,
    targetAreas: ['back', 'lower_back', 'biceps'] as const,
    global: true,
  },
  {
    id: 124,
    name: 'Squat barre haute',
    description: null,
    activity: 'gym' as const,
    targetAreas: ['quadriceps', 'glutes', 'lower_back'] as const,
    global: true,
  },
  {
    id: 131,
    name: 'Gainage ventral',
    description: null,
    activity: 'gym' as const,
    targetAreas: ['abs', 'obliques'] as const,
    global: true,
  },
  {
    // Un exercice perso, pour que l'affichage distingue « exercice de l'app » de
    // « mon exercice » sur autre chose qu'un cas théorique.
    id: 402,
    name: 'Développé couché prise serrée (barre EZ)',
    description: 'Ma variante, coudes au corps.',
    activity: 'gym' as const,
    targetAreas: ['triceps', 'chest'] as const,
    global: false,
  },
  {
    // Du cardio : il s'affiche, il se coche, il ne se saisit pas.
    id: 210,
    name: 'Sortie footing',
    description: null,
    activity: 'running' as const,
    targetAreas: ['full_body'] as const,
    global: true,
  },
];

/** Séries prescrites identiques, déroulées une par ligne comme l'API les rend. */
function setsReps(count: number, reps: number, weightKg: number, warmups = 0) {
  const lines = [];
  for (let i = 0; i < warmups; i += 1) {
    lines.push({
      index: i + 1,
      type: 'warmup' as const,
      reps: 10,
      weightKg: Math.round(weightKg * 0.5 * 2) / 2,
      durationSeconds: null,
    });
  }
  for (let i = 0; i < count; i += 1) {
    lines.push({
      index: warmups + i + 1,
      type: 'normal' as const,
      reps,
      weightKg,
      durationSeconds: null,
    });
  }

  return lines;
}

const UPPER_BLOCKS: PrescribedBlock[] = [
  {
    id: 135,
    label: 'Échauffement',
    role: 'warmup',
    rounds: 1,
    exercises: [
      {
        prescribedId: 320,
        exerciseId: 131,
        name: 'Gainage ventral',
        type: 'sets_time',
        summary: '2 × 45 s',
        groupLabel: null,
        restSeconds: 30,
        rpe: null,
        notes: null,
        sets: [
          { index: 1, type: 'normal', reps: null, weightKg: null, durationSeconds: 45 },
          { index: 2, type: 'normal', reps: null, weightKg: null, durationSeconds: 45 },
        ],
      },
    ],
  },
  {
    id: 136,
    label: 'Bloc principal',
    role: 'main',
    rounds: 1,
    exercises: [
      {
        prescribedId: 325,
        exerciseId: 106,
        name: 'Développé couché',
        type: 'sets_reps',
        summary: '4 × 8 @ 80 kg · RPE 8',
        groupLabel: null,
        restSeconds: 180,
        rpe: 8,
        notes: 'Coudes serrés, pause à la poitrine.',
        sets: setsReps(4, 8, 80, 2),
      },
      // Deux exercices liés : le superset est une liaison DANS un bloc, et le
      // libellé A1/A2 est dérivé de l'ordre — on se fie à l'égalité de préfixe.
      {
        prescribedId: 326,
        exerciseId: 112,
        name: 'Tractions pronation',
        type: 'sets_reps',
        summary: '4 × 6',
        groupLabel: 'A1',
        restSeconds: 0,
        rpe: null,
        notes: null,
        sets: setsReps(4, 6, 0),
      },
      {
        prescribedId: 327,
        exerciseId: 118,
        name: 'Rowing barre buste penché',
        type: 'sets_reps',
        summary: '4 × 10 @ 60 kg',
        groupLabel: 'A2',
        restSeconds: 120,
        rpe: null,
        notes: null,
        sets: setsReps(4, 10, 60),
      },
      {
        prescribedId: 328,
        exerciseId: 402,
        name: 'Développé couché prise serrée (barre EZ)',
        type: 'sets_reps',
        summary: '3 × 12 @ 35 kg',
        groupLabel: null,
        restSeconds: 90,
        rpe: null,
        notes: null,
        sets: setsReps(3, 12, 35),
      },
    ],
  },
];

const LOWER_BLOCKS: PrescribedBlock[] = [
  {
    id: 140,
    label: 'Bloc principal',
    role: 'main',
    rounds: 1,
    exercises: [
      {
        prescribedId: 340,
        exerciseId: 124,
        name: 'Squat barre haute',
        type: 'sets_reps',
        summary: '5 × 5 @ 100 kg · RPE 8',
        groupLabel: null,
        restSeconds: 240,
        rpe: 8,
        notes: null,
        sets: setsReps(5, 5, 100, 2),
      },
      {
        prescribedId: 341,
        exerciseId: 131,
        name: 'Gainage ventral',
        type: 'sets_time',
        summary: '3 × 60 s',
        groupLabel: null,
        restSeconds: 45,
        rpe: null,
        notes: null,
        sets: [
          { index: 1, type: 'normal', reps: null, weightKg: null, durationSeconds: 60 },
          { index: 2, type: 'normal', reps: null, weightKg: null, durationSeconds: 60 },
          { index: 3, type: 'normal', reps: null, weightKg: null, durationSeconds: 60 },
        ],
      },
    ],
  },
];

const CARDIO_BLOCKS: PrescribedBlock[] = [
  {
    id: 145,
    label: null,
    role: 'main',
    rounds: 1,
    exercises: [
      {
        prescribedId: 350,
        exerciseId: 210,
        name: 'Sortie footing',
        type: 'distance_pace',
        summary: '8 km @ 5:15/km',
        groupLabel: null,
        restSeconds: null,
        rpe: null,
        notes: 'Allure endurance, ne pas dériver.',
        // Pas de séries : ce type de prescription n'en compte pas. `null`, pas
        // un tableau vide — la distinction est celle de l'API.
        sets: null,
      },
    ],
  },
];

/**
 * Vide la base, puis la remplit.
 *
 * **Transaction synchrone**, et c'est le piège central de cette couche : le
 * pilote `expo-sqlite` de Drizzle est en mode `sync`, `db.transaction()` valide
 * dès que le rappel **retourne**. Un rappel `async` rendrait une promesse
 * aussitôt considérée comme le résultat, la transaction serait validée avant la
 * première écriture, et les suivantes se feraient hors transaction sans que rien
 * ne le signale. D'où le rappel non-`async` et les `.run()` / `.get()` explicites
 * partout ici — pas d'`await` à l'intérieur.
 */
export function seedDemo(): void {
  if (!__DEV__) {
    throw new Error(
      "Le jeu de démonstration n'existe qu'en développement : il serait poussé au serveur.",
    );
  }

  db.transaction((tx) => {
    // Relue **avant** le vidage : `wipe()` emporte `sync_state`, donc l'URL du
    // serveur posée par l'appairage. Elle est réécrite plus bas.
    const apiUrl = tx.select({ apiUrl: syncState.apiUrl }).from(syncState).get()?.apiUrl ?? null;

    wipe(tx);

    tx.insert(exercise)
      .values(
        EXERCISES.map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          activity: e.activity,
          targetAreas: [...e.targetAreas],
          mediaUrl: null,
          global: e.global,
          updatedAt: nowIso(),
        })),
      )
      .run();

    // --- Une séance faite avant-hier, avec son écart au prévu ----------------
    const doneUuid = uuidv7();
    tx.insert(scheduledWorkout)
      .values({
        uuid: doneUuid,
        date: dayOffset(-2),
        status: 'done',
        title: 'Bas du corps — force',
        freeform: false,
        startedAt: instant(-2, 18, 4),
        endedAt: instant(-2, 19, 11),
        completionNotes: 'Dernière série courte, genou droit sensible.',
        plan: { id: 12, title: 'Prépa force — bloc 1' },
      })
      .run();
    tx.insert(prescribedSnapshot).values({ scheduledUuid: doneUuid, blocks: LOWER_BLOCKS }).run();

    const squatLog = tx
      .insert(loggedExercise)
      .values({
        scheduledUuid: doneUuid,
        exerciseId: 124,
        exerciseName: 'Squat barre haute',
        sourcePrescribedId: 340,
        position: 0,
        skipped: false,
        notes: null,
      })
      .returning({ id: loggedExercise.id })
      .get();

    // Cinq séries prévues, quatre tenues puis une allégée : l'écart doit être
    // visible dès l'ouverture de l'écran, sinon on ne teste rien.
    const squatSets = [
      { type: 'warmup' as const, reps: 8, weightKg: 50 },
      { type: 'warmup' as const, reps: 5, weightKg: 80 },
      { type: 'normal' as const, reps: 5, weightKg: 100, rpe: 7 },
      { type: 'normal' as const, reps: 5, weightKg: 100, rpe: 8 },
      { type: 'normal' as const, reps: 5, weightKg: 100, rpe: 8 },
      { type: 'normal' as const, reps: 5, weightKg: 100, rpe: 9 },
      { type: 'normal' as const, reps: 3, weightKg: 100, rpe: 10 },
    ];
    tx.insert(loggedSet)
      .values(
        squatSets.map((set, i) => ({
          uuid: uuidv7(),
          loggedExerciseId: squatLog.id,
          position: i,
          type: set.type,
          reps: set.reps,
          weightKg: set.weightKg,
          durationSeconds: null,
          rpe: set.rpe ?? null,
          completedAt: instant(-2, 18, 10 + i * 6),
        })),
      )
      .run();

    // Un exercice sauté : une déclaration de l'athlète, pas un trou.
    tx.insert(loggedExercise)
      .values({
        scheduledUuid: doneUuid,
        exerciseId: 131,
        exerciseName: 'Gainage ventral',
        sourcePrescribedId: 341,
        position: 1,
        skipped: true,
        notes: 'Plus de place au sol.',
      })
      .run();

    // --- La séance d'aujourd'hui, prévue, jamais ouverte ---------------------
    const todayUuid = uuidv7();
    tx.insert(scheduledWorkout)
      .values({
        uuid: todayUuid,
        date: dayOffset(0),
        status: 'planned',
        title: 'Haut du corps — force',
        freeform: false,
        startedAt: null,
        endedAt: null,
        completionNotes: null,
        plan: { id: 12, title: 'Prépa force — bloc 1' },
      })
      .run();
    tx.insert(prescribedSnapshot).values({ scheduledUuid: todayUuid, blocks: UPPER_BLOCKS }).run();

    // --- Une séance libre d'hier, en attente de push -------------------------
    // Elle n'a pas de programme : `blocks` est absent, ce n'est pas une anomalie.
    const freeUuid = uuidv7();
    tx.insert(scheduledWorkout)
      .values({
        uuid: freeUuid,
        date: dayOffset(-1),
        status: 'done',
        title: 'Séance libre',
        freeform: true,
        startedAt: instant(-1, 12, 30),
        endedAt: instant(-1, 13, 5),
        completionNotes: null,
        plan: null,
      })
      .run();

    const benchLog = tx
      .insert(loggedExercise)
      .values({
        scheduledUuid: freeUuid,
        exerciseId: 106,
        exerciseName: 'Développé couché',
        sourcePrescribedId: null,
        position: 0,
        skipped: false,
        notes: null,
      })
      .returning({ id: loggedExercise.id })
      .get();

    tx.insert(loggedSet)
      .values(
        [
          { reps: 10, weightKg: 60 },
          { reps: 8, weightKg: 75 },
          { reps: 8, weightKg: 75 },
        ].map((set, i) => ({
          uuid: uuidv7(),
          loggedExerciseId: benchLog.id,
          position: i,
          type: 'normal' as const,
          reps: set.reps,
          weightKg: set.weightKg,
          durationSeconds: null,
          rpe: null,
          completedAt: instant(-1, 12, 35 + i * 8),
        })),
      )
      .run();

    // La mutation qui va avec : elle ne porte que l'uuid, le document se relit
    // au moment du push.
    tx.insert(mutationQueue)
      .values({
        type: 'schedule.put',
        payload: { uuid: freeUuid },
        attempts: 0,
        lastError: null,
        createdAt: instant(-1, 13, 5),
      })
      .run();

    // --- Une séance de cardio à venir ---------------------------------------
    const cardioUuid = uuidv7();
    tx.insert(scheduledWorkout)
      .values({
        uuid: cardioUuid,
        date: dayOffset(1),
        status: 'planned',
        title: 'Footing endurance',
        freeform: false,
        startedAt: null,
        endedAt: null,
        completionNotes: null,
        plan: null,
      })
      .run();
    tx.insert(prescribedSnapshot)
      .values({ scheduledUuid: cardioUuid, blocks: CARDIO_BLOCKS })
      .run();

    // --- L'historique, tel que le bootstrap le descend -----------------------
    tx.insert(exerciseHistory)
      .values([
        {
          exerciseId: 124,
          last: {
            date: dayOffset(-2),
            workingSets: 5,
            tonnageKg: 2300,
            topWeightKg: 100,
            sets: [
              {
                type: 'normal',
                count: 4,
                reps: 5,
                weightKg: 100,
                durationSeconds: null,
                firstIndex: 1,
                lastIndex: 4,
              },
              {
                type: 'normal',
                count: 1,
                reps: 3,
                weightKg: 100,
                durationSeconds: null,
                firstIndex: 5,
                lastIndex: 5,
              },
            ],
          },
          best: {
            date: dayOffset(-16),
            type: 'normal',
            reps: 5,
            weightKg: 105,
            durationSeconds: null,
          },
        },
        {
          exerciseId: 106,
          last: {
            date: dayOffset(-1),
            workingSets: 3,
            tonnageKg: 1800,
            topWeightKg: 75,
            sets: [
              {
                type: 'normal',
                count: 1,
                reps: 10,
                weightKg: 60,
                durationSeconds: null,
                firstIndex: 1,
                lastIndex: 1,
              },
              {
                type: 'normal',
                count: 2,
                reps: 8,
                weightKg: 75,
                durationSeconds: null,
                firstIndex: 2,
                lastIndex: 3,
              },
            ],
          },
          best: {
            date: dayOffset(-9),
            type: 'normal',
            reps: 8,
            weightKg: 82.5,
            durationSeconds: null,
          },
        },
      ])
      .run();

    // --- L'état de synchronisation ------------------------------------------
    // La fenêtre est celle qu'annoncerait le serveur : J-30 → J+14.
    //
    // **`serverTime` reste nul, et ce n'est pas un oubli.** C'est l'horloge du
    // serveur au dernier bootstrap *réussi*, et c'est ce que le moteur renvoie en
    // `?since` (KL-27). Le jeu de démonstration n'a rien descendu : y écrire
    // `nowIso()` ferait demander un **delta** au premier vrai pull, alors que la
    // base locale ne contient que ces huit exercices fabriqués. Le serveur
    // n'allège que la bibliothèque — l'historique et la fenêtre de séances datées
    // partent toujours en entier (`BootstrapPayload`) — donc la réponse
    // référencerait des exercices qui ne sont pas là, et la transaction du pull
    // échouerait en `FOREIGN KEY constraint failed` sans jamais pouvoir se
    // rattraper. Nul, le premier pull est complet, et il l'est aussi longtemps
    // qu'il faut. Même raison pour `lastPulledAt`.
    //
    // `apiUrl` survit au vidage : elle vient du QR d'appairage (KL-48) et
    // n'appartient pas au jeu de données. La perdre ici déconnecterait l'app du
    // serveur au prochain lancement, pour avoir injecté des séances de test.
    tx.insert(syncState)
      .values({
        id: SYNC_STATE_ID,
        apiUrl,
        serverTime: null,
        windowFrom: dayOffset(-30),
        windowTo: dayOffset(14),
        lastPulledAt: null,
        lastPushedAt: null,
      })
      .run();
  });
}

/**
 * Vide toutes les tables. Sert au jeu de démonstration et à l'écran de réglages
 * (KL-35), où « se déconnecter » doit effacer le réalisé local avec le jeton.
 *
 * L'ordre suit les dépendances : les `ON DELETE CASCADE` s'en chargeraient, mais
 * les énumérer rend la liste des tables lisible en un coup d'œil et évite de
 * dépendre d'un `PRAGMA foreign_keys` qu'une future connexion oublierait de
 * poser.
 *
 * **Le `where(sql`1 = 1`)` n'est pas décoratif, et il ne se devine pas.**
 * `DELETE FROM t` **sans** clause `WHERE` déclenche l'optimisation « truncate »
 * de SQLite : la table est vidée d'un bloc, sans visiter les lignes — et
 * `sqlite3_update_hook` **n'est donc jamais appelé**. Toute vue montée sur
 * `useLiveQuery` reste alors figée sur l'ancien contenu, sans erreur ni
 * avertissement. La clause suffit à désactiver l'optimisation.
 *
 * Le piège ne touche que `mutation_queue` et `sync_state` — les deux seules
 * tables sans aucune clé étrangère, entrante ou sortante : partout ailleurs,
 * SQLite doit déjà parcourir les lignes pour appliquer les contraintes, donc le
 * signal part. Autrement dit, la seule table qu'un écran de réglages voudra
 * observer en direct est précisément celle qui se taisait. Observé sur
 * l'appareil : après un vidage, la base était à zéro et le compteur affichait
 * encore 1.
 */
function wipe(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): void {
  const all = sql`1 = 1`;

  tx.delete(mutationQueue).where(all).run();
  tx.delete(loggedSet).where(all).run();
  tx.delete(loggedExercise).where(all).run();
  tx.delete(prescribedSnapshot).where(all).run();
  tx.delete(scheduledWorkout).where(all).run();
  tx.delete(exerciseHistory).where(all).run();
  tx.delete(exercise).where(all).run();
  tx.delete(syncState).where(all).run();
}

/** Vide la base, sans rien réinjecter. */
export function clearDatabase(): void {
  db.transaction((tx) => wipe(tx));
}
