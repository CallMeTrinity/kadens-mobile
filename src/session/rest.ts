/**
 * Le repos entre deux séries : décompte, notification, vibration (KL-31).
 *
 * ## Un magasin de module, pas un état d'écran
 *
 * Même patron que la session d'`@/api`, et pour une raison voisine : le repos
 * doit survivre à ce qui l'affiche. On ouvre la feuille d'ajustement, on revient
 * à « Aujourd'hui » pour vérifier la séance de demain, on verrouille le
 * téléphone — le compte à rebours continue, parce qu'il n'appartient à aucun
 * composant. Un `useState` dans l'écran de séance serait remis à zéro à chaque
 * démontage, et un contexte ne se lirait pas depuis le module qui programme la
 * notification.
 *
 * Il n'y a qu'**un** repos à la fois : on ne se repose pas de deux séries en
 * parallèle. Démarrer en remplace un en cours, ce qui est exactement ce que fait
 * cocher la série suivante d'un superset.
 *
 * ## L'échéance est un instant, jamais un compteur qui décrémente
 *
 * `endsAt` est un horodatage absolu et le restant se **recalcule** à chaque tick.
 * Un compteur décrémenté d'une seconde par tick dériverait de plusieurs secondes
 * sur un repos de trois minutes, et surtout il serait faux au retour d'
 * arrière-plan : Android suspend la boucle JS, les intervalles ne rattrapent pas
 * leur retard. Avec un instant, revenir dans l'app rend la bonne valeur, ou zéro.
 *
 * ## Le repos ne se persiste pas, et c'est un choix
 *
 * Rien de tout ça ne va en base. Un repos n'est pas du réalisé : il ne part pas
 * au serveur, le contrat n'a nulle part où le mettre, et le persister ferait
 * ressurgir un décompte de 90 secondes trois heures après, au prochain
 * lancement. Conséquence assumée : une app **tuée** pendant un repos perd son
 * décompte. La notification déjà programmée, elle, survit — c'est le système qui
 * la tient — et c'est bien ce qu'on veut de la part d'une app tuée en
 * arrière-plan. Si l'app est **relancée**, en revanche, cette notification n'a
 * plus rien à signaler : `initRestNotifications()` la purge au démarrage.
 *
 * ## Qui décide d'afficher la notification
 *
 * Personne, dans ce fichier. La notification est programmée **dès le début du
 * repos**, et c'est le gestionnaire global (`setNotificationHandler`) qui la tait
 * si l'app se trouve au premier plan à l'échéance — l'écran a déjà son décompte,
 * une bannière par-dessus serait du bruit. Décider nous-mêmes au moment de
 * l'échéance, en lisant `AppState`, supposerait que la boucle JS tourne encore à
 * cet instant précis : c'est justement ce qu'Android ne garantit pas.
 */

import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { AppState, Platform, Vibration, type NativeEventSubscription } from 'react-native';

import { getPreferences } from '@/db';

import type { SessionExercise } from './program';

/** Le pas d'ajustement, en secondes. « + 15 s / - 15 s », mot pour mot du ticket. */
export const REST_STEP = 15;

/**
 * Bornes d'un repos. Le plancher est le pas lui-même : en dessous, le décompte
 * n'a plus le temps d'être lu. Le plafond est l'heure — au-delà, ce n'est plus un
 * repos entre deux séries, c'est un rappel, et l'app n'en fait pas.
 */
const REST_MIN = REST_STEP;
const REST_MAX = 3_600;

/**
 * Au-delà de ce retard, on ne vibre plus à l'échéance.
 *
 * Le cas : l'app était en arrière-plan, sa boucle JS suspendue, la notification a
 * déjà averti. Au retour au premier plan le premier tick découvre un repos fini
 * depuis longtemps — vibrer là serait un contretemps, l'information est vieille.
 */
const VIBRATE_GRACE_MS = 2_000;

/** Deux impulsions courtes, séparées : ça se distingue d'un message reçu. */
const VIBRATION_PATTERN = [0, 250, 150, 250];

/**
 * Les deux canaux Android, et pourquoi ils sont deux.
 *
 * Un canal de notification Android est **figé après sa création** : seuls son nom
 * et sa description restent modifiables, jamais sa vibration. Une préférence
 * « vibration » à un seul canal n'aurait donc plus aucun effet dès la deuxième
 * ouverture de l'app. On crée les deux, et c'est la notification qui choisit le
 * sien au moment d'être programmée.
 */
const CHANNEL_VIBRATE = 'rest';
const CHANNEL_SILENT = 'rest-silent';

/** Ce qui distingue une notification de repos des autres. Il n'y en a pas d'autres, pour l'instant. */
const REST_NOTIFICATION_KIND = 'rest';

/** Le repos en cours, tel que l'écran le peint. */
export interface RestState {
  /** Durée totale, ajustements compris. Sert la barre de progression, pas le calcul. */
  totalSeconds: number;
  /** L'échéance, en millisecondes epoch. La seule vérité du décompte. */
  endsAt: number;
  /** Secondes restantes, planchées à zéro. Zéro = repos terminé, la barre le dit. */
  remaining: number;
  /** L'exercice d'où vient ce repos. Affiché pour qu'on sache de quoi on se repose. */
  exerciseName: string | null;
}

let state: RestState | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let foreground: NativeEventSubscription | null = null;

const listeners = new Set<() => void>();

function publish(next: RestState | null): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** L'instantané du repos. `null` quand il n'y en a pas. */
export function getRest(): RestState | null {
  return state;
}

/**
 * Le repos en cours, en lecture vive.
 *
 * Le tick vit dans le magasin et non dans le hook : deux écrans montés en même
 * temps (la séance et sa feuille) partagent le même intervalle, et le décompte ne
 * se dédouble pas.
 */
export function useRestTimer(): RestState | null {
  return useSyncExternalStore(subscribe, getRest, getRest);
}

/**
 * Démarre le repos qui suit une série de cet exercice.
 *
 * **La ligne prescrite l'emporte sur le réglage.** `restSeconds` vient du
 * programme : le coach — ou soi-même au compositeur — a écrit 180 secondes sur du
 * lourd et 45 sur de l'accessoire, et une durée par défaut qui écraserait ça
 * viderait le champ de son sens. Le réglage ne sert que là où le programme se
 * tait, ce qui est le cas de la quasi-totalité des séances et de toutes les
 * séances libres.
 *
 * **Le démarrage automatique se débranche** (`autoRest`, basculé depuis la barre
 * basse). C'est la seule chose que le réglage coupe : un repos lancé à la main
 * part quand même, et celui qui court garde ses ajustements. La coupure est ici
 * plutôt que dans l'écran parce que « cocher démarre le repos » est une règle du
 * domaine, et que trois appelants la partagent.
 *
 * Rend `false` quand il n'y a rien à démarrer : un repos de zéro seconde est une
 * consigne d'enchaîner (superset), la respecter c'est ne pas afficher de barre.
 */
export function startRestAfterSet(exercise: SessionExercise): boolean {
  const preferences = getPreferences();

  if (!preferences.autoRest) {
    return false;
  }

  const prescribed = exercise.prescribed?.restSeconds ?? null;

  if (prescribed !== null && prescribed <= 0) {
    return false;
  }

  return startRest(prescribed ?? preferences.restSeconds, exercise.name);
}

/** Démarre un repos d'une durée donnée, en remplaçant celui qui court. */
export function startRest(seconds: number, exerciseName: string | null = null): boolean {
  const total = clamp(Math.round(seconds));

  if (total <= 0) {
    return false;
  }

  publish({
    totalSeconds: total,
    endsAt: Date.now() + total * 1_000,
    remaining: total,
    exerciseName,
  });

  startTicking();
  void scheduleRestNotification(total, exerciseName);

  return true;
}

/**
 * Allonge ou raccourcit le repos en cours, sans toucher au réglage par défaut.
 *
 * Deux choses distinctes : « ce repos-ci sera plus long » et « mes repos durent
 * 2 minutes ». Reporter l'ajustement d'une série sur le réglage ferait dériver le
 * défaut au fil d'une séance, sans que personne ne l'ait demandé — le réglage se
 * change dans les réglages (KL-35).
 *
 * Un ajustement qui passe sous le restant **termine** le repos, sans vibrer : on
 * regardait l'écran, on vient d'en décider, avertir n'apprendrait rien.
 */
export function adjustRest(deltaSeconds: number): boolean {
  if (state === null) {
    return false;
  }

  const remaining = remainingOf(state.endsAt) + deltaSeconds;

  if (remaining <= 0) {
    stopRest();

    return true;
  }

  const total = clamp(state.totalSeconds + deltaSeconds);

  publish({
    ...state,
    totalSeconds: total,
    endsAt: Date.now() + remaining * 1_000,
    remaining,
  });

  // Le tick a pu s'arrêter : « + 15 s » sur un repos **terminé** le relance, et
  // c'est le geste naturel quand on décide de souffler un peu plus.
  startTicking();
  void scheduleRestNotification(remaining, state.exerciseName);

  return true;
}

/** Termine le repos : « Passer », ou l'écran de séance qu'on quitte. Rien n'est averti. */
export function stopRest(): void {
  stopTicking();
  void cancelRestNotification();
  publish(null);
}

// --- Le tick -----------------------------------------------------------------

function startTicking(): void {
  if (ticker === null) {
    ticker = setInterval(tick, 1_000);
  }

  if (foreground === null) {
    // Le retour au premier plan est le seul moment où l'écart peut être grand :
    // la boucle JS a été suspendue, le prochain tick naturel afficherait une
    // valeur périmée pendant une seconde entière.
    foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        tick();
      }
    });
  }
}

function stopTicking(): void {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }

  foreground?.remove();
  foreground = null;
}

function tick(): void {
  if (state === null) {
    stopTicking();

    return;
  }

  const remaining = remainingOf(state.endsAt);

  if (remaining > 0) {
    if (remaining !== state.remaining) {
      publish({ ...state, remaining });
    }

    return;
  }

  // Fini. La barre reste, à zéro : elle disparaîtra au prochain repos ou d'un
  // appui. Un affichage qui s'évapore pile au moment où on rattrape le téléphone
  // laisserait douter de ce qui s'est passé.
  const late = Date.now() - state.endsAt;

  stopTicking();
  publish({ ...state, remaining: 0 });

  if (late <= VIBRATE_GRACE_MS && AppState.currentState === 'active') {
    buzz();
  }
}

function remainingOf(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));
}

function clamp(seconds: number): number {
  return Math.min(REST_MAX, Math.max(REST_MIN, seconds));
}

/**
 * La vibration de fin de repos, si elle n'est pas désactivée.
 *
 * `Vibration` du cœur de React Native plutôt qu'`expo-haptics` : le haptique est
 * un retour tactile sous le doigt, calibré pour être discret. Ici le téléphone
 * est posé sur le banc ou dans une poche, et l'information doit traverser un
 * survêtement.
 */
function buzz(): void {
  if (getPreferences().vibrate) {
    Vibration.vibrate(VIBRATION_PATTERN);
  }
}

// --- La notification ---------------------------------------------------------

let notificationId: string | null = null;
/**
 * Le numéro de la programmation en cours.
 *
 * `scheduleNotificationAsync` rend son identifiant **après coup** : un repos
 * ajusté ou passé pendant ce délai laisserait une notification que plus rien ne
 * référence, donc impossible à annuler. Chaque programmation prend un numéro ; à
 * la résolution, un numéro périmé annule immédiatement ce qu'il vient de créer.
 */
let epoch = 0;
let permissionAsked = false;

/**
 * Prépare les notifications de repos. À appeler **une fois**, au démarrage.
 *
 * Trois choses, dans cet ordre : le gestionnaire global qui tait la bannière
 * quand l'app est au premier plan, les deux canaux Android, et la purge de ce qui
 * resterait programmé. Cette purge est ce qui rend « le repos ne se persiste pas »
 * cohérent : l'app relancée n'a plus de décompte à l'écran, une notification qui
 * sonnerait quand même annoncerait la fin de quelque chose d'invisible.
 */
export async function initRestNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const rest = notification.request.content.data?.kind === REST_NOTIFICATION_KIND;
      const foregrounded = AppState.currentState === 'active';
      // Une notification de repos reçue au premier plan est redondante : la barre
      // de repos est déjà à l'écran et la vibration part du tick.
      const show = !(rest && foregrounded);

      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_VIBRATE, {
      name: 'Fin de repos',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: VIBRATION_PATTERN,
      enableVibrate: true,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_SILENT, {
      name: 'Fin de repos (sans vibration)',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: false,
    });
  }

  // Tout, et pas seulement « la nôtre » : au démarrage il n'y a pas d'identifiant
  // en mémoire à annuler, et l'app ne programme rien d'autre que des fins de
  // repos. Le jour où elle en programmera, ce balai devra se restreindre.
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Rien à purger, ou permission refusée : dans les deux cas il n'y a rien à
    // faire, et le démarrage de l'app ne doit pas s'arrêter là-dessus.
  }
}

/**
 * Programme l'avertissement de fin de repos, et annule le précédent.
 *
 * La permission se demande **ici**, à la première programmation, et une seule
 * fois : c'est le moment où elle sert, et le contexte est lisible sans écran
 * d'explication — on vient de cocher une série, l'app propose de prévenir quand
 * le repos est fini. Un refus ne casse rien : le décompte et la vibration au
 * premier plan ne demandent aucune permission.
 */
async function scheduleRestNotification(
  seconds: number,
  exerciseName: string | null,
): Promise<void> {
  const mine = ++epoch;

  await cancelRestNotification();

  if (!(await allowedToNotify())) {
    return;
  }

  const vibrate = getPreferences().vibrate;

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Repos terminé',
        body: exerciseName ? `Série suivante : ${exerciseName}` : 'Série suivante',
        data: { kind: REST_NOTIFICATION_KIND },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        channelId: vibrate ? CHANNEL_VIBRATE : CHANNEL_SILENT,
      },
    });

    if (mine === epoch) {
      notificationId = id;
    } else {
      // Le repos a changé pendant la programmation : ce qui vient d'être créé est
      // déjà périmé.
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {
    // Une notification qu'on ne peut pas programmer ne doit pas faire échouer un
    // repos : le décompte à l'écran est la fonction, l'avertissement est le
    // confort.
  }
}

async function cancelRestNotification(): Promise<void> {
  const id = notificationId;

  notificationId = null;

  if (id === null) {
    return;
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Déjà tirée, déjà annulée : dans les deux cas il n'y a rien à faire.
  }
}

/** La permission, demandée au plus une fois par lancement. */
async function allowedToNotify(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();

    if (current.granted) {
      return true;
    }

    if (permissionAsked || !current.canAskAgain) {
      return false;
    }

    permissionAsked = true;

    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
