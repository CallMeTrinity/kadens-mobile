import { count } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  bootstrap,
  describeError,
  getApiBaseUrl,
  ping,
  refreshMe,
  signOut,
  useSession,
} from '@/api';
import { Button, Card, Chip, EmptyState, Field, Header, NumberStepper, Sheet } from '@/components';
import {
  clearDatabase,
  db,
  exercise,
  loggedSet,
  mutationQueue,
  scheduledWorkout,
  seedDemo,
} from '@/db';
import { isExhausted, MAX_ATTEMPTS, rearmExhausted, syncNow, useSyncStatus } from '@/sync';
import { colors, space, text } from '@/theme';

// Écran de vérification du socle. Il montrait l'échelle typographique (KL-22),
// il montre les huit composants de base, le compteur de la base locale (KL-24),
// la carte « API » (KL-25) et la carte « Synchro » (KL-27) : c'est le moyen le
// plus court de voir sur un vrai téléphone qu'une cible se vise au doigt, que
// les migrations sont passées, qu'un jeton révoqué depuis `/profile/settings`
// renvoie bien à l'écran de connexion, et que le cycle de synchronisation tourne
// sur un vrai réseau. Rien de tout ça n'est observable hors appareil.
//
// **Il occupait la route `index` jusqu'à KL-28**, qui l'a déplacé ici pour que
// « Aujourd'hui » prenne l'accueil. Le supprimer aurait été plus propre s'il ne
// portait pas encore la **seule déconnexion de l'app** et les seuls contrôles
// d'appareil du chantier : KL-35 le remplace par le vrai écran de réglages, qui
// reprendra la déconnexion, l'état de synchronisation et la file en échec.
export default function DiagnosticsScreen() {
  const [weight, setWeight] = useState(82.5);
  const [reps, setReps] = useState(8);
  const [rest, setRest] = useState(2);
  const [note, setNote] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Comptés en requête vive : la base ouverte avec `enableChangeListener`
  // republie à chaque écriture, donc injecter le jeu de démo remet les chiffres à
  // jour sans qu'on ait à les redemander. C'est aussi la vérification la plus
  // courte que le drapeau est bien posé (cf. `db/client.ts`).
  const rows = {
    exercices: useRowCount(exercise),
    séances: useRowCount(scheduledWorkout),
    séries: useRowCount(loggedSet),
    'file de push': useRowCount(mutationQueue),
  };

  return (
    <View style={styles.screen}>
      <Header
        eyebrow="Socle et synchronisation"
        title="Diagnostic"
        onBack={() => router.back()}
        right={<Chip label="Local" rank={2} />}
      />

      <ScrollView contentContainerStyle={styles.page}>
        <Card title="Actions">
          <View style={styles.stack}>
            <Button label="Démarrer la séance" onPress={() => setSheetOpen(true)} block />
            <Button label="Reprendre" variant="secondary" block />
            <Button label="Plus tard" variant="ghost" />
            <Button label="Indisponible" variant="secondary" disabled />
          </View>
        </Card>

        <Card title="Marques" right={<Chip label="Fait" tone="done" dot />}>
          <View style={styles.row}>
            <Chip label="Muscu" rank={2} />
            <Chip label="Course" rank={1} />
            <Chip label="Prévu" tone="planned" dot />
            <Chip label="Manqué" tone="missed" dot />
            <Chip label="Objectif" tone="accent" />
          </View>
        </Card>

        <Card title="Saisie">
          <View style={styles.stack}>
            <NumberStepper label="Charge" value={weight} onChange={setWeight} unit="kg" />
            <NumberStepper label="Répétitions" value={reps} onChange={setReps} step={1} max={50} />
            <Field
              label="Note d'écart"
              placeholder="Épaule droite sensible"
              value={note}
              onChangeText={setNote}
              hint="Visible sur la séance datée, jamais dans l'export."
              multiline
            />
            <Field label="Email" placeholder="toi@exemple.fr" error="Identifiants incorrects." />
          </View>
        </Card>

        <ApiCard />

        <SyncCard />

        <Card title="Base locale" right={<Chip label="KL-24" rank={3} />}>
          <View style={styles.stack}>
            {Object.entries(rows).map(([label, n]) => (
              <View key={label} style={styles.countRow}>
                <Text style={styles.label}>{label}</Text>
                <Text style={styles.value}>{n}</Text>
              </View>
            ))}
            <Button label="Injecter le jeu de démo" onPress={seedDemo} block />
            <Button label="Vider la base" variant="secondary" onPress={clearDatabase} block />
          </View>
        </Card>

        <EmptyState
          title="Rien de prévu aujourd'hui"
          hint="Une séance libre se démarre sans programme."
          action={{ label: 'Séance libre', onPress: () => setSheetOpen(true) }}
        />
      </ScrollView>

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Repos"
        footer={<Button label="Valider" onPress={() => setSheetOpen(false)} block />}
      >
        <Text style={styles.body}>
          Une feuille monte du bas, sur un voile, bornée à 78 % de l’écran. Le contenu défile
          dessous ; l’en-tête et le pied restent en place.
        </Text>
        <NumberStepper label="Minutes" value={rest} onChange={setRest} step={0.5} unit="min" />
      </Sheet>
    </View>
  );
}

/**
 * La carte de vérification du client API (KL-25).
 *
 * Trois appels qui couvrent ce que le ticket pose : `ping` (le plus court chemin
 * jusqu'au réseau), `/api/me` (qui complète la session restaurée et affiche
 * l'appareil tel que `/profile/settings` le nomme), et `bootstrap` (le seul
 * appel volumineux, donc le seul qui exerce vraiment le timeout).
 */
function ApiCard() {
  const session = useSession();
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<string>) {
    setPending(label);
    setError(null);
    setResult(null);

    try {
      setResult(await action());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card title="API" right={<Chip label="KL-25" rank={3} />}>
      <View style={styles.stack}>
        <View style={styles.countRow}>
          <Text style={styles.label}>serveur</Text>
          <Text style={styles.value}>{getApiBaseUrl() ?? 'aucune URL'}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.label}>compte</Text>
          <Text style={styles.value}>{session.user?.email ?? 'jeton restauré'}</Text>
        </View>

        <Button
          label={pending === 'ping' ? 'Ping…' : 'Ping'}
          variant="secondary"
          block
          disabled={pending !== null}
          onPress={() =>
            void run('ping', async () => {
              const payload = await ping();

              return `ok — ${payload.user}`;
            })
          }
        />
        <Button
          label={pending === 'me' ? 'Compte…' : 'Compte et appareil'}
          variant="secondary"
          block
          disabled={pending !== null}
          onPress={() =>
            void run('me', async () => {
              const user = await refreshMe();

              return `${user.email} — ${user.roles.join(', ')}`;
            })
          }
        />
        <Button
          label={pending === 'bootstrap' ? 'Bootstrap…' : 'Bootstrap'}
          variant="secondary"
          block
          disabled={pending !== null}
          onPress={() =>
            void run('bootstrap', async () => {
              const payload = await bootstrap();

              return [
                `${payload.exercises.length} exercices`,
                `${payload.schedule.length} séances`,
                `fenêtre ${payload.window.from} → ${payload.window.to}`,
              ].join(' · ');
            })
          }
        />
        <Button
          label="Se déconnecter"
          variant="ghost"
          disabled={pending !== null}
          onPress={() => void signOut()}
        />

        {result ? <Text style={styles.body}>{result}</Text> : null}
        {error ? <Text style={styles.fault}>{error}</Text> : null}
      </View>
    </Card>
  );
}

/**
 * La carte de vérification du moteur de synchronisation (KL-27).
 *
 * Elle montre ce qu'aucun contrôle hors téléphone ne montre : que le cycle
 * complet tourne sur un vrai réseau, que la file se vide, et que les compteurs de
 * la carte « Base locale » bougent juste après — c'est-à-dire que la transaction
 * du pull a bien écrit. La file en échec s'affiche entrée par entrée : c'est
 * l'esquisse de ce que KL-35 rendra pour de bon.
 */
function SyncCard() {
  const status = useSyncStatus();
  const { data: queue } = useLiveQuery(db.select().from(mutationQueue).orderBy(mutationQueue.id));
  const [report, setReport] = useState<string | null>(null);

  const busy = status.phase !== 'idle';

  return (
    <Card title="Synchro" right={<Chip label="KL-27" rank={3} />}>
      <View style={styles.stack}>
        <View style={styles.countRow}>
          <Text style={styles.label}>phase</Text>
          <Text style={styles.value}>{busy ? `${status.phase} (${status.trigger})` : 'idle'}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.label}>dernier succès</Text>
          <Text style={styles.value}>{status.lastSuccessAt?.slice(11, 19) ?? '—'}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.label}>en attente</Text>
          <Text style={styles.value}>{queue.length}</Text>
        </View>

        <Button
          label={busy ? 'Synchronisation…' : 'Synchroniser'}
          variant="secondary"
          block
          disabled={busy}
          onPress={() =>
            void syncNow('manual').then((outcome) =>
              setReport(
                outcome.ok
                  ? [
                      `${outcome.push?.pushed ?? 0} poussée(s)`,
                      `${outcome.pull?.exercises ?? 0} exercices`,
                      `${outcome.pull?.schedule ?? 0} séances`,
                      `${outcome.pull?.protectedSchedule ?? 0} protégée(s)`,
                      `${outcome.pull?.removedSchedule ?? 0} purgée(s)`,
                    ].join(' · ')
                  : null,
              ),
            )
          }
        />

        {queue.map((row) => (
          <View key={row.id} style={styles.countRow}>
            <Text style={styles.label}>
              {row.type} · {row.payload.uuid.slice(0, 8)}
            </Text>
            <Text style={isExhausted(row) ? styles.fault : styles.value}>
              {row.attempts}/{MAX_ATTEMPTS}
            </Text>
          </View>
        ))}
        {queue.some(isExhausted) ? (
          <Button label="Réarmer les échecs" variant="ghost" onPress={() => rearmExhausted()} />
        ) : null}

        {report ? <Text style={styles.body}>{report}</Text> : null}
        {status.lastError ? <Text style={styles.fault}>{status.lastError}</Text> : null}
      </View>
    </Card>
  );
}

/** Le nombre de lignes d'une table, tenu à jour à chaque écriture. */
function useRowCount(table: SQLiteTable): number {
  const { data } = useLiveQuery(db.select({ n: count() }).from(table));

  return data[0]?.n ?? 0;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  page: { padding: space[8], gap: space[8] },
  stack: { gap: space[6] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  label: { ...text.eyebrow, color: colors.textFaint },
  value: { ...text.numeric, color: colors.text },
  body: { ...text.body, color: colors.textSecondary },
  // Le rouge dit l'échec, et rien d'autre (§5 règle 2).
  fault: { ...text.body, color: colors.primary },
});
