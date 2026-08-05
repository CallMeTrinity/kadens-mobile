import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deviceName, getApiBaseUrl, refreshMe, signOut, useSession } from '@/api';
import { Button, Card, Chip, Header, NumberStepper } from '@/components';
import { clearDatabase, localDate, patchPreferences, seedDemo } from '@/db';
import { dayOffset, REST_STEP, shortDate, startRest, usePreferences, useToday } from '@/session';
import {
  MAX_ATTEMPTS,
  rearmExhausted,
  resyncAll,
  syncNow,
  useMutationQueue,
  useSyncState,
  useSyncStatus,
  type QueuedMutation,
  type SyncPhase,
} from '@/sync';
import { colors, space, text } from '@/theme';

/**
 * Écran « Réglages » (KL-35).
 *
 * Il **remplace l'écran de diagnostic**, qui portait depuis KL-25 la seule
 * déconnexion de l'app, l'état de la file et les réglages de repos faute d'un
 * endroit à eux. Ce qui s'y vérifiait à la main (ping, bootstrap, compteurs de
 * tables) disparaît avec lui : c'était l'outillage d'un socle qu'on construisait,
 * pas une fonction de l'app. Seul le jeu de démonstration reste, sous `__DEV__`,
 * parce que rien d'autre ne remplit une base sans serveur.
 *
 * ## Ce qu'il montre, dans cet ordre
 *
 * Compte, synchronisation, repos, application. C'est l'ordre des questions qu'on
 * vient y poser : **qui suis-je pour ce serveur**, **est-ce que mes séances sont
 * parties**, **comment sonne le repos**, **quelle version je porte**. La
 * synchronisation vient en deuxième parce que c'est la seule chose qui puisse
 * mal aller sans qu'aucun autre écran le dise.
 *
 * ## Il se lit hors réseau, comme tout le reste
 *
 * Rien n'est demandé au serveur à l'ouverture, à une exception près : une session
 * **restaurée** n'a qu'un jeton, pas de compte (`api/session.ts`), et l'écran
 * complète alors l'identité en tâche de fond. L'échec est ignoré — l'écran
 * affiche ce qu'il a — et un `401` purge la session, ce qui est le comportement
 * voulu : un jeton révoqué depuis `/profile/settings` se découvre ici.
 *
 * ## Une seule action primaire, et elle bouge
 *
 * Règle 2 du design system. Le rouge va à « Synchroniser » **quand il y a
 * quelque chose à envoyer**, et à rien du tout sinon : un écran de réglages où
 * tout est à jour n'a aucune action urgente, et un bouton rouge permanent ne
 * dirait plus rien.
 */
export default function SettingsScreen() {
  return (
    <View style={styles.screen}>
      {/*
        Aucun retour arrière depuis KL-37 : les réglages sont une **destination**
        de la barre basse, plus un écran empilé. Un bouton « Retour » sur une
        destination renverrait vers l'onglet précédent, ce qu'un onglet fait
        déjà, mieux.
      */}
      <Header eyebrow="Cet appareil" title="Réglages" />

      <ScrollView contentContainerStyle={styles.page}>
        <AccountCard />
        <SyncCard />
        <RestCard />
        <AppCard />
      </ScrollView>
    </View>
  );
}

/* --- Compte ---------------------------------------------------------------- */

/**
 * Qui est connecté, sur quel serveur, depuis quel appareil — et le seul geste qui
 * défait tout ça.
 *
 * Les trois lignes ne sont pas décoratives : c'est la seule façon, depuis le
 * téléphone, de vérifier qu'on parle au bon serveur (une IP LAN de développement
 * et la production se ressemblent) et de retrouver l'appareil tel que
 * `/profile/settings` le nomme, pour savoir lequel révoquer.
 */
function AccountCard() {
  const session = useSession();
  const queue = useMutationQueue();

  useCompletedIdentity(session.user === null);

  function confirmSignOut() {
    const pending = queue.length;

    Alert.alert(
      'Se déconnecter ?',
      pending > 0
        ? `${pending} séance${pending > 1 ? 's' : ''} n’${pending > 1 ? 'ont' : 'a'} pas encore été envoyée${pending > 1 ? 's' : ''} au serveur. La déconnexion efface les données de cet appareil : ce qu’elle${pending > 1 ? 's contiennent' : ' contient'} serait perdu. Synchronise d’abord.`
        : 'Les séances téléchargées et le réalisé déjà envoyé sont effacés de cet appareil. Tout se retrouve sur le serveur à la prochaine connexion.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOutAndForget() },
      ],
    );
  }

  return (
    <Card title="Compte">
      <View style={styles.stack}>
        {/* Un email, une URL, un nom d'appareil ne sont pas des grandeurs : ils
            se rendent en Barlow comme tout contenu, la mono restant aux valeurs
            chiffrées (règle 4 et `theme/typography.ts`). */}
        <Row label="Compte" value={session.user?.email ?? 'connu au prochain passage en ligne'} />
        <Row label="Serveur" value={getApiBaseUrl() ?? 'aucun serveur appairé'} />
        <Row label="Appareil" value={deviceName()} />

        {/* Fantôme : se déconnecter n'est pas ce qu'on vient faire ici, et le
            rouge est réservé à l'action primaire (règle 2). La confirmation
            porte la mise en garde, pas la couleur du bouton. */}
        <Button label="Se déconnecter" variant="ghost" onPress={confirmSignOut} />
      </View>
    </Card>
  );
}

/**
 * Déconnexion : la base locale part **avant** le jeton.
 *
 * L'ordre est celui du moindre mal si l'app est tuée entre les deux. Une base
 * vide avec un jeton valide se remplit toute seule au lancement suivant ; un
 * jeton effacé sur une base pleine laisserait le réalisé d'un compte déconnecté
 * sur l'appareil, sans plus aucun écran pour y accéder ni pour le pousser.
 *
 * L'URL du serveur survit (`clearDatabase`) : elle vient de l'appairage, pas du
 * compte. Se reconnecter par mot de passe reste donc possible sans rescanner de
 * QR.
 */
async function signOutAndForget(): Promise<void> {
  clearDatabase();
  await signOut();
}

/**
 * Complète l'identité d'une session restaurée, une fois, sans bloquer l'écran.
 *
 * `restoreSession()` ne rend qu'un jeton (elle ne valide rien au démarrage, pour
 * que l'app s'ouvre hors ligne) : sans ce rattrapage, l'écran afficherait
 * indéfiniment un compte inconnu sur un téléphone parfaitement connecté. L'échec
 * ne se dit pas — il n'y a rien à faire de plus, et hors réseau est l'état
 * nominal.
 */
function useCompletedIdentity(missing: boolean): void {
  useEffect(() => {
    if (!missing) {
      return;
    }

    void refreshMe().catch(() => {});
  }, [missing]);
}

/* --- Synchronisation ------------------------------------------------------- */

/**
 * L'état de la synchronisation, et les trois gestes qui agissent dessus.
 *
 * **La dernière réussite se lit dans `sync_state`, pas dans le moteur.** L'état
 * du moteur vit en mémoire et repart vide à chaque lancement : après un
 * redémarrage, il annoncerait « jamais synchronisé » sur une base descendue une
 * heure plus tôt. Ce qui vient du moteur, c'est ce qui se passe *maintenant* — la
 * phase — et la dernière erreur.
 */
function SyncCard() {
  const status = useSyncStatus();
  const state = useSyncState();
  const queue = useMutationQueue();
  const today = useToday();

  const [working, setWorking] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const busy = status.phase !== 'idle' || working;
  const exhausted = queue.filter((row) => row.exhausted);

  async function run(action: () => Promise<string | null>) {
    setWorking(true);
    setReport(null);

    try {
      setReport(await action());
    } finally {
      setWorking(false);
    }
  }

  function synchronize() {
    void run(async () => {
      const outcome = await syncNow('manual');

      if (!outcome.ok || outcome.pull === null) {
        return null;
      }

      const pushed = outcome.push?.pushed ?? 0;
      const known = `${outcome.pull.schedule} séance${outcome.pull.schedule > 1 ? 's' : ''} à jour`;

      // « 0 envoyée » est du bruit : le cas nominal est justement qu'il n'y ait
      // rien à envoyer.
      return pushed > 0
        ? `${pushed} envoyée${pushed > 1 ? 's' : ''} · ${known}`
        : `${known}, rien à envoyer`;
    });
  }

  function retryExhausted() {
    void run(async () => {
      const rearmed = rearmExhausted();
      const outcome = await syncNow('manual');

      return outcome.ok
        ? `${rearmed} envoi${rearmed > 1 ? 's' : ''} rejoué${rearmed > 1 ? 's' : ''}`
        : null;
    });
  }

  function confirmResync() {
    Alert.alert(
      'Tout resynchroniser ?',
      'La base de cet appareil est effacée puis retéléchargée en entier. Rien n’est perdu tant que tout est parti au serveur — c’est justement ce qui est vérifié avant d’effacer.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Resynchroniser', onPress: () => void run(resync) },
      ],
    );
  }

  return (
    <Card title="Synchronisation" right={busy ? <Chip label={phaseLabel(status.phase)} /> : null}>
      <View style={styles.stack}>
        <Row label="Dernière réception" value={when(state?.lastPulledAt ?? null, today)} />
        <Row label="Dernier envoi" value={when(state?.lastPushedAt ?? null, today)} />
        <Row
          label="En attente"
          value={
            queue.length === 0 ? 'rien' : `${queue.length} séance${queue.length > 1 ? 's' : ''}`
          }
        />

        {state?.windowFrom && state.windowTo ? (
          <Text style={styles.caption}>
            Séances couvertes du {shortDate(state.windowFrom)} au {shortDate(state.windowTo)}.
          </Text>
        ) : null}

        {queue.length > 0 ? (
          <View style={styles.queue}>
            {queue.map((row) => (
              <QueueRow key={row.id} mutation={row} today={today} />
            ))}
          </View>
        ) : null}

        {/*
          L'unique action primaire de l'écran, et seulement quand il y a
          effectivement quelque chose à envoyer (règle 2).
        */}
        <Button
          label={busy ? 'Synchronisation…' : 'Synchroniser'}
          variant={queue.length > 0 ? 'primary' : 'secondary'}
          block
          disabled={busy}
          onPress={synchronize}
        />

        {exhausted.length > 0 ? (
          <Button
            label="Rejouer les envois marqués"
            variant="secondary"
            block
            disabled={busy}
            accessibilityHint="Remet à zéro leur compteur de tentatives et relance un envoi"
            onPress={retryExhausted}
          />
        ) : null}

        <Button
          label="Tout resynchroniser"
          variant="ghost"
          block
          disabled={busy}
          accessibilityHint="Efface la base de cet appareil et la retélécharge en entier"
          onPress={confirmResync}
        />

        {report ? <Text style={styles.body}>{report}</Text> : null}
        {/* Hors réseau n'est pas une panne : c'est l'état nominal en salle. */}
        {status.lastError ? (
          <Text style={status.offline ? styles.caption : styles.fault}>
            {status.offline ? `Hors réseau. ${status.lastError}` : status.lastError}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Une séance qui attend de partir.
 *
 * Le titre plutôt que l'uuid : la file est faite pour être lue par celui qui
 * s'est entraîné, pas par celui qui a écrit le moteur. Le compteur de tentatives
 * ne s'affiche **qu'à partir du premier refus** — le cas nominal (une séance qui
 * attend du réseau) n'a rien d'un échec et n'a pas à ressembler à un décompte
 * avant abandon.
 */
function QueueRow({ mutation, today }: { mutation: QueuedMutation; today: string }) {
  const name =
    mutation.title ?? (mutation.type === 'schedule.delete' ? 'Séance supprimée' : 'Séance libre');
  const day = mutation.date === null ? null : whenDay(mutation.date, today);

  return (
    <View style={styles.queueRow}>
      <View style={styles.queueHead}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.spacer} />
        {mutation.attempts > 0 ? (
          <Text style={mutation.exhausted ? styles.fault : styles.value}>
            {mutation.attempts}/{MAX_ATTEMPTS}
          </Text>
        ) : null}
      </View>
      {day ? <Text style={styles.caption}>{day}</Text> : null}
      {/* La raison ne se rend que si le serveur a **refusé** — c'est exactement
          ce que `attempts > 0` veut dire, un réseau absent n'incrémente rien
          (`sync/queue.ts`). Sans cette condition, chaque ligne afficherait un
          message réseau et ferait lire une panne là où il n'y a qu'un sous-sol. */}
      {mutation.attempts > 0 && mutation.lastError ? (
        <Text style={styles.fault}>{mutation.lastError}</Text>
      ) : null}
    </View>
  );
}

/**
 * Ce que le moteur est en train de faire. « En cours » couvre le moment où
 * l'écran travaille sans que le moteur tourne — la purge d'un « tout
 * resynchroniser », entre les deux cycles.
 */
function phaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case 'pushing':
      return 'Envoi';
    case 'pulling':
      return 'Réception';
    default:
      return 'En cours';
  }
}

/** Le rapport d'un « tout resynchroniser », en une phrase. */
async function resync(): Promise<string> {
  const outcome = await resyncAll();

  switch (outcome.refusedBy) {
    case 'pending':
      return `Rien n’a été effacé : ${outcome.pending} envoi${outcome.pending > 1 ? 's' : ''} attend${outcome.pending > 1 ? 'ent' : ''} encore. Rejoue-les d’abord.`;
    case 'unreachable':
      return `Rien n’a été effacé : ${outcome.error ?? 'le serveur n’a pas répondu.'}`;
    default:
      return outcome.ok
        ? 'Base locale reconstruite depuis le serveur.'
        : `Base effacée, mais le retéléchargement a échoué : ${outcome.error ?? 'raison inconnue'}. Il reprendra à la prochaine synchronisation.`;
  }
}

/* --- Repos ----------------------------------------------------------------- */

/**
 * Les réglages de repos (KL-31), enfin chez eux.
 *
 * Le pas est de 15 secondes, comme l'ajustement en séance : deux granularités
 * pour la même valeur donneraient des durées qui ne tombent jamais juste.
 *
 * Le test de notification n'est pas un outil de développement : c'est le seul
 * moyen de savoir **avant** une séance si ce téléphone laisse passer la
 * notification et la vibration — canal Android muet, mode silencieux, permission
 * refusée. Le découvrir barre en main serait le découvrir trop tard.
 */
function RestCard() {
  const preferences = usePreferences();

  return (
    <Card title="Repos">
      <View style={styles.stack}>
        <NumberStepper
          label="Durée par défaut"
          value={preferences.restSeconds}
          onChange={(next) => patchPreferences({ restSeconds: next })}
          step={REST_STEP}
          min={REST_STEP}
          max={3600}
          unit="s"
        />
        <Text style={styles.caption}>
          Elle ne sert que si la ligne du programme n’a pas son propre repos, qui l’emporte
          toujours.
        </Text>

        {/* Le même interrupteur qu'en séance, où il vit vraiment (barre basse) :
            ici il est **trouvable**, là-bas il est sous le pouce au moment où on
            s'aperçoit qu'un décompte n'a rien à faire dans ce qu'on fait. */}
        <Button
          label={
            preferences.autoRest ? 'Départ automatique : activé' : 'Départ automatique : désactivé'
          }
          variant="secondary"
          block
          accessibilityHint="Démarrer le repos en validant une série"
          onPress={() => patchPreferences({ autoRest: !preferences.autoRest })}
        />

        <Button
          label={preferences.vibrate ? 'Vibration : activée' : 'Vibration : désactivée'}
          variant="secondary"
          block
          accessibilityHint="Vibrer à la fin du repos"
          onPress={() => patchPreferences({ vibrate: !preferences.vibrate })}
        />

        <Button
          label="Tester un repos de 15 s"
          variant="ghost"
          accessibilityHint="Passe l’app en arrière-plan pour voir la notification arriver"
          onPress={() => startRest(REST_STEP, 'Test')}
        />
      </View>
    </Card>
  );
}

/* --- Application ----------------------------------------------------------- */

/**
 * La version, et rien d'autre qu'elle en production.
 *
 * **Lue dans le manifeste embarqué** (`expo-constants`) et non par
 * `expo-application` : l'app n'embarque pas `expo-updates`, le manifeste est donc
 * figé au build et ne peut pas diverger du binaire installé — et `expo-application`
 * est un module natif de plus, donc un rebuild, pour une valeur qu'on a déjà. Le
 * jour où KL-43 ira comparer cette version à celle du dépôt F-Droid, la question
 * se reposera avec un vrai besoin derrière.
 *
 * La section de développement n'existe que sous `__DEV__` : `seedDemo()` refuse
 * déjà de s'exécuter en production (elle pousserait de fausses séances au
 * serveur), le bouton n'a donc rien à faire dans un APK distribué.
 */
function AppCard() {
  const config = Constants.expoConfig;

  return (
    <Card title="Application" right={<Chip label="Kadens" rank={2} />}>
      <View style={styles.stack}>
        <Row label="Version" value={config?.version ?? 'inconnue'} mono />
        <Row label="Build" value={buildLabel()} mono />

        {__DEV__ ? (
          <>
            <Text style={styles.caption}>
              Développement uniquement : ces deux gestes n’existent pas dans l’app distribuée.
            </Text>
            <Button label="Injecter le jeu de démo" variant="secondary" block onPress={seedDemo} />
            <Button label="Vider la base" variant="ghost" block onPress={clearDatabase} />
          </>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Le numéro de build Android (`versionCode`), ou le mode d'exécution quand il n'y
 * en a pas — ce qui est le cas dès qu'on tourne sur Metro : le manifeste servi en
 * développement n'est pas celui d'un APK signé, et afficher « 1 » y ferait croire
 * à une version distribuée.
 */
function buildLabel(): string {
  if (__DEV__) {
    return 'développement';
  }

  const code = Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;

  return code === null || code === undefined ? 'inconnu' : String(code);
}

/* --- Briques d'affichage --------------------------------------------------- */

/** Une ligne « libellé / valeur », le motif de tout l'écran. */
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label} : ${value}`} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {/* `flexShrink` : une URL de serveur ou un email long doit se replier dans
          la carte, pas pousser le libellé dehors. */}
      <Text style={[mono ? styles.value : styles.body, styles.rowValue]}>{value}</Text>
    </View>
  );
}

/**
 * Un instant, en français, relatif au jour où on le lit.
 *
 * Écrit à la main comme tout le reste des libellés de date (`session/days.ts`) :
 * la présence d'ICU dans Hermes dépend de la variante embarquée, et un
 * `toLocaleString` qui retombe sur l'anglais donnerait « Aug 4 » au milieu d'une
 * identité qui n'a qu'une langue.
 */
function when(iso: string | null, today: string): string {
  if (iso === null) {
    return 'jamais';
  }

  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return 'jamais';
  }

  const hours = String(at.getHours()).padStart(2, '0');
  const minutes = String(at.getMinutes()).padStart(2, '0');

  return `${whenDay(localDate(at), today)} à ${hours}:${minutes}`;
}

/** « aujourd'hui », « hier », sinon « 4 août ». */
function whenDay(date: string, today: string): string {
  switch (dayOffset(date, today)) {
    case 0:
      return 'aujourd’hui';
    case -1:
      return 'hier';
    case 1:
      return 'demain';
    default:
      return shortDate(date);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  spacer: { flex: 1 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[4],
  },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  label: { ...text.eyebrow, color: colors.textSecondary },
  value: { ...text.numeric, color: colors.text },
  name: { ...text.name, color: colors.text, flexShrink: 1 },
  body: { ...text.body, color: colors.textSecondary },
  caption: { ...text.caption, color: colors.textSecondary },
  // Le rouge dit l'échec, et rien d'autre (§5 règle 2). `statusMissed` et non
  // `primary` : c'est le token que le web pose sur `.kd-flash--error`, et les
  // deux ne veulent pas dire la même chose — l'un est l'accent d'une action,
  // l'autre l'échec. Ils partagent leur valeur aujourd'hui, pas leur sens.
  fault: { ...text.body, color: colors.primaryOnTint },

  queue: { gap: space[5] },
  // Un filet gauche, comme les écarts de la clôture : la ligne se détache sans
  // introduire de teinte, l'identité n'ayant qu'une couleur et elle est prise.
  queueRow: {
    gap: space[1],
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: space[5],
  },
  queueHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[4] },
});
