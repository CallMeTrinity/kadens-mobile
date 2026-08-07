/**
 * Les formes que l'API rend et accepte (KL-25).
 *
 * C'est la transcription littérale de `docs/api-mobile.md` §6, un type par
 * charge utile, et **rien d'autre** : ce fichier ne connaît ni la base locale ni
 * React Native. Le vocabulaire du domaine (`ScheduledStatus`, `SetType`,
 * `PrescribedBlock`…) n'est pas redéfini ici, il vient de `@/db` — en
 * `import type`, donc entièrement effacé à la compilation : le client API ne
 * tire pas SQLite derrière lui. `src/db/types.ts` l'annonçait déjà.
 *
 * Deux familles se distinguent, et il ne faut pas les confondre :
 *
 * - les `…Payload` **descendent** (ce que le serveur produit) ;
 * - les `…Input` **montent** (ce que le téléphone envoie). Ils ne sont pas le
 *   miroir des premiers, parce que le partage d'autorité est net par champ
 *   (§4.1) : `position` et les champs dérivés n'existent pas à la montée, le
 *   serveur les pose.
 */

import type {
  ActivityType,
  ExerciseLanguage,
  PerformanceBest,
  PerformanceSession,
  PlanRef,
  PrescribedBlock,
  ScheduledStatus,
  SetType,
  TargetArea,
} from '@/db';

// --- Le socle ----------------------------------------------------------------

/** Un champ refusé par la validation, sur un `422`. */
export interface Violation {
  /** Chemin exact, `log[0].sets[0].reps` par exemple. */
  field: string;
  message: string;
}

/** Le corps d'une réponse d'erreur (RFC 9457). `type` est toujours `about:blank`. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  violations?: Violation[];
}

// --- Authentification --------------------------------------------------------

export interface ApiUser {
  id: number;
  email: string;
  roles: string[];
  /**
   * Dérivable de `roles`, exposé pour que le client n'ait pas à connaître la
   * convention de nommage de Symfony.
   */
  coach: boolean;
}

/**
 * La réponse de `login` et de `pair`. Le secret n'existe que **dans cette
 * réponse** : le serveur n'en garde que l'empreinte SHA-256.
 */
export interface AuthPayload {
  token: string;
  user: ApiUser;
}

/** L'appareil courant, tel que `/api/me` le décrit. */
export interface DevicePayload {
  name: string;
  /** Bouge à **chaque** requête : « ce téléphone répond ». */
  lastUsedAt: string | null;
  /** Bouge au seul `GET /api/bootstrap` : « ce téléphone est à jour ». */
  lastBootstrapAt: string | null;
  /** Échéance glissante à 90 jours. */
  expiresAt: string;
}

export interface MePayload {
  user: ApiUser;
  device: DevicePayload;
}

/** `GET /api/ping` : une sonde muette sur l'identité, à un détail près. */
export interface PingPayload {
  ok: boolean;
  user: string;
}

/**
 * `GET /api/app-version` (KL-43) : ce que le serveur attend comme version d'app.
 *
 * Deux nombres qui ne disent pas la même chose. `versionCode` est la dernière
 * version publiée — au-dessus de la sienne, on **propose** ; `minimumVersionCode`
 * est le plancher — en dessous, on **s'arrête**. Zéro vaut « rien de publié » et
 * « aucun plancher » : c'est l'élément neutre des deux comparaisons, donc l'état
 * tant qu'aucune release n'existe.
 */
export interface AppVersionPayload {
  versionCode: number;
  versionName: string;
  minimumVersionCode: number;
  /** L'APK en direct. Nul tant qu'aucune version n'est publiée. */
  apkUrl: string | null;
  storeUrl: string;
  /** La page d'installation du site, en absolu : ce que le bandeau ouvre. */
  installUrl: string;
}

// --- La bibliothèque ---------------------------------------------------------

export interface ExercisePayload {
  id: number;
  name: string;
  /** Le nom anglais, `null` quand le français EST déjà l'anglais (« Dips »). */
  nameEn: string | null;
  description: string | null;
  activity: ActivityType;
  targetAreas: TargetArea[];
  mediaUrl: string | null;
  /** `true` = bibliothèque globale de l'app, en lecture seule ici. */
  global: boolean;
  updatedAt: string | null;
}

// --- La séance datée ---------------------------------------------------------

export interface LoggedSetPayload {
  uuid: string;
  /** Posée par le serveur : l'ordre de la liste envoyée fait foi. */
  position: number | null;
  type: SetType;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  rpe: number | null;
  completedAt: string | null;
}

export interface LoggedExercisePayload {
  exerciseId: number | null;
  name: string | null;
  /** La ligne du programme dont ce réalisé découle. Le seul lien prévu ↔ fait. */
  sourcePrescribedId: number | null;
  position: number | null;
  skipped: boolean;
  notes: string | null;
  sets: LoggedSetPayload[];
}

/**
 * Une séance datée, dans la **seule** structure que l'API produise : celle du
 * bootstrap, du `GET` et de la réponse au `PUT`. Un test serveur compare les
 * corps entiers, il n'y a donc qu'un désérialiseur à écrire ici.
 */
export interface ScheduledWorkoutPayload {
  uuid: string;
  date: string | null;
  status: ScheduledStatus | null;
  /** Toujours rempli : titre vivant, snapshot, ou « Séance libre ». */
  title: string;
  /** `true` = sans programme. `blocks` vaut alors `[]`, ce n'est pas une erreur. */
  freeform: boolean;
  startedAt: string | null;
  endedAt: string | null;
  completionNotes: string | null;
  plan: PlanRef | null;
  blocks: PrescribedBlock[];
  /** `null` tant que rien n'a été consigné. */
  log: LoggedExercisePayload[] | null;
}

// --- Bootstrap et historique -------------------------------------------------

/** Une entrée du tableau `history` : le dernier point et le record, sans la trajectoire. */
export interface HistoryEntryPayload {
  exerciseId: number;
  last: PerformanceSession | null;
  best: PerformanceBest | null;
}

/** La fenêtre de séances datées annoncée par le bootstrap. Elle **fait autorité**. */
export interface BootstrapWindow {
  from: string;
  to: string;
}

export interface BootstrapPayload {
  /**
   * L'horloge du **serveur**. C'est cette valeur qu'on stocke et qu'on renvoie
   * en `since` : se fier à la pendule du téléphone ferait dépendre la synchro
   * d'une horloge qu'on ne contrôle pas.
   */
  serverTime: string;
  since: string | null;
  /**
   * Sous quelle langue le **compte** lit les noms d'exercices.
   *
   * Les deux libellés descendent toujours (`name` et `nameEn`) : le serveur n'en
   * choisit aucun, et c'est délibéré — `?since` allège la bibliothèque, un nom
   * traduit à la descente resterait figé sur toutes les lignes qu'un delta ne
   * remonte pas. La résolution est ici, dans `@/session/naming.ts`.
   */
  exerciseLanguage: ExerciseLanguage;
  window: BootstrapWindow;
  /** Allégée par `?since`, et elle seule. */
  exercises: ExercisePayload[];
  /** Toute la fenêtre, toujours. Elle remplace le local **en entier**. */
  schedule: ScheduledWorkoutPayload[];
  history: HistoryEntryPayload[];
  /** Vide sans `since` : un jeu complet remplace tout, il n'y a rien à défalquer. */
  deleted: {
    exercises: number[];
    schedule: string[];
  };
}

export interface ExerciseHistoryPayload {
  exerciseId: number;
  /** Exactement `sessions[0]`. Exposé parce que le bootstrap le donne sous ce nom. */
  last: PerformanceSession | null;
  best: PerformanceBest | null;
  /** Dix entrées au plus, la plus récente d'abord. */
  sessions: PerformanceSession[];
}

// --- Ce qui monte ------------------------------------------------------------

/** Une série réalisée. `uuid` est posé par le client : c'est le pivot de l'idempotence. */
export interface LoggedSetInput {
  uuid: string;
  type?: SetType;
  /** 0 – 200. */
  reps?: number | null;
  /** 0 – 1000. */
  weightKg?: number | null;
  /** 0 – 86 400. */
  durationSeconds?: number | null;
  /** 1 – 10. */
  rpe?: number | null;
  /** ISO 8601, **en UTC** (`…Z`) — voir la limite connue du §7. */
  completedAt?: string | null;
}

export interface LoggedExerciseInput {
  /** Doit désigner un exercice **visible**. C'est ce qui fait entrer le réalisé dans l'historique. */
  exerciseId?: number | null;
  /** Requis quand aucun exercice de la bibliothèque n'est référencé. */
  name?: string | null;
  sourcePrescribedId?: number | null;
  skipped?: boolean;
  notes?: string | null;
  /** 100 séries au plus. */
  sets?: LoggedSetInput[];
}

/**
 * Le document complet d'une séance datée, tel que `PUT /api/schedule/{uuid}`
 * l'accepte.
 *
 * **On envoie toujours le document entier**, jamais une série à la fois : après
 * l'appel, le réalisé de la séance **est** ce document. Les champs de
 * programmation (`date`, `title`) ne servent qu'à la création, `status` ne peut
 * que clôturer, `completionNotes` n'efface jamais l'existante — le serveur fait
 * autorité sur la programmation (§4.1).
 */
export interface ScheduleUpsertInput {
  /** Facultatif, mais s'il est là il doit être **égal** à celui de l'URL. */
  uuid?: string;
  /** `AAAA-MM-JJ`. Requise, utilisée à la création seulement. */
  date: string;
  title?: string | null;
  /** Seul `done` a un effet. Le reste passe la validation sans rien faire. */
  status?: ScheduledStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  completionNotes?: string | null;
  /** Remplace **intégralement** le réalisé. 100 exercices au plus. */
  log?: LoggedExerciseInput[];
}

/**
 * Le résultat d'un upsert. `created` distingue le `201` du `200`, et cette
 * différence est une information utile : elle dit à la file de mutations quelles
 * de ses entrées étaient déjà passées.
 */
export interface ScheduleUpsertResult {
  created: boolean;
  workout: ScheduledWorkoutPayload;
}
