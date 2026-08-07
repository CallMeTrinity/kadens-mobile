import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BodyMap,
  bodyLevelColor,
  Button,
  Chip,
  duration,
  EmptyState,
  Field,
  Header,
  useKeyboardOverlap,
  weight,
  type BodyLevel,
} from '@/components';
import type { BodySilhouette, TargetArea } from '@/db';
import {
  buildBodyLoad,
  buildSessionSummary,
  closeWorkout,
  isClosed,
  isRunning,
  longDate,
  targetAreaLabel,
  useElapsedSeconds,
  useExerciseAreas,
  usePreferences,
  useSessionProgram,
  useWorkout,
  useWorkoutPendingSync,
  type BodyLoad,
  type DeviationAxis,
  type DeviationState,
  type ExerciseOutcome,
  type SessionSummary,
} from '@/session';
import { colors, layout, space, text } from '@/theme';

/**
 * Écran « Clôture de séance » (KL-33) — le dernier geste de la séance, et le
 * seul qui ne se défait pas.
 *
 * Il répond à deux questions dans cet ordre : **qu'est-ce que je viens de
 * faire**, et **est-ce que je le déclare terminé**. Le résumé passe donc avant le
 * bouton : clôturer sans avoir vu ce qu'on clôture n'a aucun intérêt, et c'est le
 * seul moment où le prévu et le fait se lisent ensemble sur le téléphone.
 *
 * ## Tout est calculé en local, comme partout ailleurs
 *
 * Le résumé sort de `buildSessionSummary` (`@/session`), qui croise le déroulé
 * déjà en base. Aucun appel réseau : l'écran s'ouvre dans un sous-sol, et un
 * résumé qui attendrait le serveur serait vide au moment précis où il sert. Le
 * verdict est aligné sur `LogComparator` — mêmes axes, mêmes six états, mêmes
 * libellés — pour qu'il ne dise pas autre chose que `/schedule/{id}` une heure
 * plus tard.
 *
 * ## L'abandon n'écrit rien, et c'est pour ça qu'il n'a pas de bouton
 *
 * « Abandon possible sans clôture » est une case du ticket, et la façon la plus
 * sûre de la tenir est de **ne rien faire** : on remonte, la séance reste
 * ouverte, son statut ne bouge pas, elle se reprend depuis « Aujourd'hui ». Un
 * bouton « Abandonner » laisserait croire qu'on jette le réalisé — alors qu'il
 * est déjà écrit, déjà en file, déjà en sécurité. Le retour s'appelle donc
 * « Reprendre la séance ».
 *
 * ## Ce que la clôture change à l'écran
 *
 * Rien ne se démonte : le même écran passe en « Séance terminée ». La note
 * devient un texte, le bouton devient « Terminer », et la marque « À
 * synchroniser » vit en lecture vive — elle apparaît si le réseau manquait et
 * disparaît **d'elle-même** dès que le push aboutit, sans que rien n'ait à
 * prévenir l'écran. C'est la démonstration visible de « rien n'est perdu », et
 * c'est aussi ce qui la rend vérifiable en mode avion.
 */
export default function SessionCloseScreen() {
  const { uuid } = useLocalSearchParams<{ uuid: string }>();
  const workout = useWorkout(uuid);
  const program = useSessionProgram(uuid);
  const pendingSync = useWorkoutPendingSync(uuid);
  const insets = useSafeAreaInsets();
  // La note est en bas de page, la barre d'action en dessous : c'est exactement
  // ce que le clavier recouvre (KL-39). L'écran entier remonte de ce qu'il
  // mange, donc le champ et le bouton restent visibles pendant la frappe.
  const keyboard = useKeyboardOverlap();

  // La saisie prime dès qu'on a tapé, et pas avant : `null` veut dire « rien de
  // saisi », ce que la note déjà enregistrée vient alors combler. Sans cette
  // distinction il faudrait un effet pour recopier la valeur à l'arrivée — et
  // cet effet réécrirait le champ sous les doigts au prochain pull.
  const [draft, setDraft] = useState<string | null>(null);

  // `ended_at` et non `isClosed()` : cet écran-ci parle de la clôture **faite
  // ici**, la seule qui produise une durée, un résumé et une note. Une séance
  // cochée « faite » sur le web est fermée elle aussi, mais elle n'a rien de tout
  // ça — elle tombe dans le garde-fou « rien à clôturer » plus bas.
  const closed = workout ? workout.endedAt !== null : false;
  const open = workout ? isRunning(workout) : false;
  const closedElsewhere = workout ? isClosed(workout) && workout.endedAt === null : false;
  const notes = draft ?? workout?.completionNotes ?? '';

  // Le résumé se recalcule quand le déroulé bouge, pas à chaque seconde : la
  // durée, elle, vit dans son propre composant (voir `Elapsed`).
  const summary = useMemo(
    () =>
      buildSessionSummary(program, {
        startedAt: workout?.startedAt ?? null,
        endedAt: workout?.endedAt ?? null,
      }),
    [program, workout?.startedAt, workout?.endedAt],
  );

  const deviations = useMemo(
    () => summary.outcomes.filter((outcome) => outcome.state !== 'held'),
    [summary],
  );

  // La carte musculaire (`areas.ts`) : les zones viennent de la bibliothèque
  // locale, que le prescrit ne fait que référencer. Le réglage de silhouette est
  // local, il n'appartient pas au compte — voir `preference.silhouette`.
  const areas = useExerciseAreas(program);
  const { silhouette } = usePreferences();
  const load = useMemo(() => buildBodyLoad(program, areas), [program, areas]);

  if (workout === undefined) {
    return <View style={styles.screen} />;
  }

  if (workout === null) {
    return (
      <View style={styles.screen}>
        <Header title="Clôture" onBack={() => router.back()} />
        <EmptyState
          title="Séance introuvable"
          hint="Elle a pu être supprimée depuis le web, ou sortir de la fenêtre synchronisée."
          action={{ label: 'Retour', onPress: () => router.back() }}
        />
      </View>
    );
  }

  // Ni ouverte ni close : elle n'a jamais été commencée. Il n'y a rien à
  // clôturer, et poser `ended_at` sur une séance sans début décrirait une séance
  // qu'on n'a pas faite. Une séance déjà déclarée faite ailleurs tombe ici aussi,
  // pour la même raison et avec ses mots à elle.
  if (!open && !closed) {
    return (
      <View style={styles.screen}>
        <Header title="Clôture" onBack={() => router.back()} />
        <EmptyState
          title={closedElsewhere ? 'Séance déjà déclarée faite' : 'Séance pas commencée'}
          hint={
            closedElsewhere
              ? 'Elle a été marquée faite ailleurs. Rien ne la déclôture, et rien ne s’y consigne.'
              : 'Il n’y a rien à clôturer tant qu’elle n’a pas été démarrée.'
          }
          action={{ label: 'Retour', onPress: () => router.back() }}
        />
      </View>
    );
  }

  function confirmClose() {
    Alert.alert(
      'Clôturer la séance ?',
      'Elle passe en « faite » et ne se reprend plus. Refaire la même aujourd’hui, ce sera une séance libre.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Clôturer',
          // Rien de destructeur : le réalisé n'est pas perdu, il est déclaré.
          onPress: () => closeWorkout(uuid, notes),
        },
      ],
    );
  }

  return (
    <View onLayout={keyboard.onLayout} style={[styles.screen, { paddingBottom: keyboard.overlap }]}>
      <Header
        eyebrow={longDate(workout.date)}
        title={closed ? 'Séance terminée' : 'Clôture'}
        onBack={() => router.back()}
        right={closed ? <Chip label="Terminée" tone="done" dot /> : null}
      />

      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.head}>
          {/* Un nom saisi : Barlow, casse normale (règle 4). */}
          <Text style={styles.name}>{workout.title ?? 'Séance libre'}</Text>
          {closed ? <SyncMark pending={pendingSync} /> : null}
        </View>

        <Metrics summary={summary} startedAt={workout.startedAt} endedAt={workout.endedAt} />

        <Muscles load={load} silhouette={silhouette} />

        <Deviations outcomes={deviations} counts={summary.counts} />

        {closed ? (
          notes.length > 0 ? (
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Note de séance
              </Text>
              <Text style={styles.body}>{notes}</Text>
            </View>
          ) : null
        ) : (
          <Field
            label="Note de séance"
            value={notes}
            onChangeText={setDraft}
            multiline
            placeholder="Sensations, douleur, matériel, ce qu’il faudra retenir…"
            hint="Elle part avec la séance et se lit sur le web."
          />
        )}
      </ScrollView>

      {/* Le clavier recouvre déjà la barre gestuelle : ne compter que l'un des
          deux, sinon la barre d'action flotte au-dessus du clavier. */}
      <View
        style={[
          styles.actions,
          { paddingBottom: space[6] + (keyboard.overlap > 0 ? 0 : insets.bottom) },
        ]}
      >
        {closed ? (
          <Button
            label="Terminer"
            block
            accessibilityHint="Revenir à l’écran du jour"
            onPress={leaveToToday}
          />
        ) : (
          <>
            <Button label="Clôturer la séance" block onPress={confirmClose} />
            <Button
              label="Reprendre la séance"
              variant="ghost"
              block
              accessibilityHint="Rien n’est clôturé, la séance reste ouverte et reprenable"
              onPress={() => router.back()}
            />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Sortir d'une séance clôturée.
 *
 * On **vide la pile** au lieu de revenir en arrière : derrière cet écran il y a
 * la séance, qu'on ne peut plus dérouler (§2.3 point 5), et y retomber donnerait
 * un écran mort. Le repli couvre le cas d'une pile qui n'aurait rien à jeter — un
 * lancement direct sur cette route.
 */
function leaveToToday(): void {
  if (router.canDismiss()) {
    router.dismissAll();

    return;
  }

  router.replace('/');
}

/**
 * Les quatre repères de la séance, en grands chiffres.
 *
 * **Durée, tonnage, séries, exercices** — dans cet ordre, qui est celui de la
 * question qu'on se pose en sortant de la salle. Le tonnage et les séries sont
 * ceux du **travail** : l'échauffement est exclu ici comme partout ailleurs dans
 * le projet, et il se dit en légende plutôt que de gonfler un chiffre qui se
 * compare d'une séance à l'autre.
 *
 * Une série cochée sans aucune valeur suit exactement le même traitement que
 * l'échauffement : hors du chiffre, dite en légende. Sans cette mention elle
 * disparaîtrait du décompte sans explication, alors qu'on vient de la cocher.
 */
function Metrics({
  summary,
  startedAt,
  endedAt,
}: {
  summary: SessionSummary;
  startedAt: string | null;
  endedAt: string | null;
}) {
  const planned = summary.plannedWorkingSets;
  const blank = summary.unmeasuredSets;
  const legend = [
    summary.warmupSets > 0 ? `+ ${summary.warmupSets} d’échauffement` : null,
    blank > 0 ? `+ ${blank} sans valeur` : null,
    planned > 0 ? `sur ${planned} prévue${planned > 1 ? 's' : ''}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <View style={styles.metrics}>
      <Elapsed startedAt={startedAt} endedAt={endedAt} />
      <Metric
        label="Tonnage"
        value={summary.tonnageKg > 0 ? weight(summary.tonnageKg) : '—'}
        legend={summary.tonnageKg > 0 ? 'séries de travail' : 'aucune charge consignée'}
      />
      <Metric
        label="Séries faites"
        value={String(summary.workingSets)}
        legend={legend.length > 0 ? legend : null}
      />
      <Metric
        label="Exercices"
        value={String(summary.exerciseCount)}
        legend={
          summary.skipped > 0 ? `${summary.skipped} sauté${summary.skipped > 1 ? 's' : ''}` : null
        }
      />
    </View>
  );
}

/**
 * La durée, dans son propre composant.
 *
 * **Volontairement isolée** : elle se rafraîchit chaque seconde tant que la
 * séance est ouverte (`useElapsedSeconds`), et faire re-rendre l'écran entier à
 * ce rythme ferait sauter la saisie de la note juste en dessous. Une fois la
 * séance close, l'intervalle s'arrête et la valeur ne bouge plus : c'est la durée
 * qui part au serveur.
 */
function Elapsed({ startedAt, endedAt }: { startedAt: string | null; endedAt: string | null }) {
  const seconds = useElapsedSeconds(startedAt, endedAt);

  return (
    <Metric
      label="Durée"
      value={seconds === null ? '—' : duration(seconds)}
      legend={endedAt === null ? 'en cours' : null}
    />
  );
}

/** Un chiffre et ce qu'il mesure. Le chiffre d'abord : c'est ce qu'on vient lire. */
function Metric({
  label,
  value,
  legend,
}: {
  label: string;
  value: string;
  legend?: string | null;
}) {
  return (
    <View accessible accessibilityLabel={`${label} : ${value}`} style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {legend ? <Text style={styles.caption}>{legend}</Text> : null}
    </View>
  );
}

/**
 * Ce que la séance a chargé, sur une silhouette.
 *
 * ## La section disparaît quand il n'y a rien à cartographier
 *
 * Pas d'état vide dessiné, et c'est l'exception assumée à la règle du projet : un
 * corps entièrement gris sous le titre « Muscles chargés » ne dirait rien de plus
 * qu'un silence, et il le dirait à une sortie course — qui n'a pas de zones parce
 * qu'elle n'a pas de séries, pas parce que quelque chose a échoué. Le résumé
 * au-dessus a déjà tout dit d'elle.
 *
 * ## Le dessin est une aide, la légende est la source
 *
 * Trois nuances de rouge ne se comptent pas à l'œil et ne survivent pas à un
 * daltonisme : **chaque zone est écrite, chiffrée et ordonnée** en dessous, du
 * plus chargé au moins chargé. La carte donne la forme, la liste donne les
 * nombres — et rien n'existe seulement dans la carte.
 *
 * Les deux compteurs de bas de section suivent la règle de l'écran : ce qui sort
 * du dessin se dit, jamais ne s'escamote. « Corps entier » n'y peint rien
 * (`areas.ts`), une zone inconnue non plus.
 */
function Muscles({ load, silhouette }: { load: BodyLoad; silhouette: BodySilhouette }) {
  const levels = useMemo(
    () => new Map<TargetArea, BodyLevel>(load.areas.map((area) => [area.area, area.level])),
    [load],
  );

  if (load.areas.length === 0 && load.fullBody === 0 && load.unmapped === 0) {
    return null;
  }

  const aside = [
    load.fullBody > 0 ? `${sets(load.fullBody)} corps entier` : null,
    load.unmapped > 0 ? `${sets(load.unmapped)} sans zone déclarée` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Muscles chargés
      </Text>
      <Text style={styles.caption}>D’après les séries de travail consignées.</Text>

      <BodyMap levels={levels} silhouette={silhouette} />

      {load.areas.map((area) => (
        <View
          key={area.area}
          accessible
          accessibilityLabel={`${targetAreaLabel(area.area)} : ${sets(area.sets)}, ${area.percent} %`}
          style={styles.areaRow}
        >
          <View style={[styles.areaDot, { backgroundColor: bodyLevelColor(area.level) }]} />
          <Text style={styles.name} numberOfLines={1}>
            {targetAreaLabel(area.area)}
          </Text>
          <View style={styles.spacer} />
          <Text style={styles.areaValue}>{area.sets}</Text>
          <Text style={styles.areaShare}>{Math.round(area.percent)} %</Text>
        </View>
      ))}

      {aside.length > 0 ? <Text style={styles.caption}>+ {aside}</Text> : null}
    </View>
  );
}

/** « 1 série », « 4 séries ». Le pluriel se pose une fois. */
function sets(count: number): string {
  return `${count} série${count > 1 ? 's' : ''}`;
}

/** Les six états de `LogDeviation`, mot pour mot ceux du serveur. */
const STATE_LABELS: Record<DeviationState, string> = {
  held: 'Tenu',
  exceeded: 'Dépassé',
  lightened: 'Allégé',
  skipped: 'Sauté',
  not_logged: 'Non réalisé',
  unplanned: 'Hors programme',
};

/**
 * Les écarts au prescrit, un par exercice.
 *
 * **Seuls les écarts sont listés** : « tenu » est le cas nominal, et une liste
 * qui répète douze fois « tenu » enterre les deux lignes qui comptent. Le compte
 * des exercices tenus se dit en une phrase au-dessus, ce qui suffit à savoir que
 * rien n'a été oublié.
 *
 * Un exercice **sauté** ou **hors programme** est une déclaration, pas une
 * mesure : il n'a pas de valeurs à confronter, et la ligne se réduit à son état.
 */
function Deviations({
  outcomes,
  counts,
}: {
  outcomes: ExerciseOutcome[];
  counts: Record<DeviationState, number>;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Écarts au prescrit
      </Text>

      {outcomes.length === 0 ? (
        // Deux vides qui ne veulent pas dire la même chose : tout a été tenu, ou
        // il n'y avait rien à tenir. Le second n'est pas une réussite.
        <EmptyState
          compact
          title={counts.held > 0 ? 'Rien à signaler' : 'Rien à comparer'}
          hint={
            counts.held > 0
              ? `${counts.held} exercice${counts.held > 1 ? 's' : ''} tenu${counts.held > 1 ? 's' : ''}, tel${counts.held > 1 ? 's' : ''} que prévu${counts.held > 1 ? 's' : ''}.`
              : 'Cette séance n’avait pas de programme.'
          }
        />
      ) : (
        <>
          {counts.held > 0 ? (
            <Text style={styles.caption}>
              {counts.held} exercice{counts.held > 1 ? 's' : ''} tenu{counts.held > 1 ? 's' : ''},
              le reste ci-dessous.
            </Text>
          ) : null}
          {outcomes.map((outcome) => (
            <DeviationRow key={outcome.key} outcome={outcome} />
          ))}
        </>
      )}
    </View>
  );
}

/** Un exercice qui n'a pas fait ce qui était écrit : ce qui était prévu, ce qui a été fait. */
function DeviationRow({ outcome }: { outcome: ExerciseOutcome }) {
  const detail =
    outcome.axis === null || outcome.planned === null || outcome.logged === null
      ? null
      : `${axisValue(outcome.axis, outcome.logged)} au lieu de ${axisValue(outcome.axis, outcome.planned)}`;

  return (
    <View
      accessible
      accessibilityLabel={`${outcome.name}, ${STATE_LABELS[outcome.state]}${detail ? `, ${detail}` : ''}`}
      style={styles.deviation}
    >
      <View style={styles.deviationHead}>
        <Text style={styles.name} numberOfLines={1}>
          {outcome.name}
        </Text>
        <View style={styles.spacer} />
        <Chip label={STATE_LABELS[outcome.state]} />
      </View>
      {detail ? <Text style={styles.deviationDetail}>{detail}</Text> : null}
    </View>
  );
}

/**
 * Une valeur d'axe, mise en forme.
 *
 * Le domaine rend des grandeurs brutes (kg, répétitions, secondes) — c'est ici
 * qu'elles deviennent lisibles, avec les mêmes fonctions que le reste de l'app
 * (`@/components`, pendant natif d'`UnitFormatter`).
 */
function axisValue(axis: DeviationAxis, value: number): string {
  switch (axis) {
    case 'tonnage':
    case 'weight':
      return weight(value);
    case 'reps':
      return `${value} rep${value > 1 ? 's' : ''}`;
    case 'duration':
      return duration(value);
    case 'sets':
      return `${value} série${value > 1 ? 's' : ''}`;
  }
}

/**
 * L'état de synchronisation d'une séance clôturée.
 *
 * Ce n'est pas une erreur, donc pas de rouge : la séance est en sécurité en base
 * et attend du réseau. La marque disparaît d'elle-même quand le push aboutit — la
 * lecture est vive, rien n'a à prévenir l'écran.
 */
function SyncMark({ pending }: { pending: boolean }) {
  return pending ? <Chip label="À synchroniser" /> : <Chip label="Synchronisée" tone="done" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[8], gap: space[8] },
  spacer: { flex: 1 },

  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[4] },
  name: { ...text.name, color: colors.text, flexShrink: 1 },
  body: { ...text.body, color: colors.textSecondary },
  caption: { ...text.caption, color: colors.textSecondary },

  // Deux colonnes : quatre chiffres en ligne seraient illisibles à cette taille,
  // et la grille tient sans média-requête — l'app n'a qu'une largeur.
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.hairline },
  metric: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: space[1],
    paddingVertical: space[6],
    paddingHorizontal: space[7],
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.border,
  },
  metricLabel: { ...text.eyebrow, color: colors.textSecondary },
  // Le grand chiffre du design system. `adjustsFontSizeToFit` le protège du seul
  // cas qui déborde : un tonnage à cinq chiffres sur une petite largeur.
  metricValue: { ...text.kpi, color: colors.text },

  section: {
    gap: space[4],
    paddingVertical: space[7],
    paddingHorizontal: space[7],
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.border,
  },
  sectionTitle: { ...text.sectionTitle, color: colors.text },

  // Une ligne de légende de la carte musculaire. La pastille reprend la teinte du
  // dessin ; elle est bordée, sinon le palier le plus clair s'effacerait sur le
  // papier — et elle ne porte aucune information que la ligne n'écrive déjà.
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  areaDot: {
    width: space[5],
    height: space[5],
    borderWidth: layout.hairline,
    borderColor: colors.borderStrong,
  },
  areaValue: { ...text.numeric, color: colors.text },
  // Une part se lit en second : c'est le rang qui compte, pas le pourcent exact.
  areaShare: { ...text.numeric, color: colors.textSecondary, minWidth: 44, textAlign: 'right' },

  // Un filet gauche, pas un fond : l'écart se signale sans introduire de teinte,
  // et l'identité n'a qu'une couleur — elle est prise (règle 2).
  deviation: {
    gap: space[2],
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    paddingLeft: space[5],
  },
  deviationHead: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  deviationDetail: { ...text.numeric, color: colors.textSecondary },

  // La barre d'action ne défile pas : clôturer doit être atteignable sans
  // remonter la liste des écarts, et c'est là que le pouce arrive.
  actions: {
    gap: space[4],
    paddingTop: space[6],
    paddingBottom: space[6],
    paddingHorizontal: space[8],
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: layout.hairline,
    borderTopColor: colors.border,
  },
});
