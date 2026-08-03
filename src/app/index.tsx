import { count } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { Button, Card, Chip, EmptyState, Field, Header, NumberStepper, Sheet } from '@/components';
import { API_URL } from '@/config';
import {
  clearDatabase,
  db,
  exercise,
  loggedSet,
  mutationQueue,
  scheduledWorkout,
  seedDemo,
} from '@/db';
import { colors, space, text } from '@/theme';

// Écran de vérification du socle. Il montrait l'échelle typographique (KL-22),
// il montre désormais les huit composants de base : c'est le moyen le plus court
// de voir sur un vrai téléphone qu'une cible se vise au doigt, qu'un pas de
// 2,5 kg part au premier appui et qu'une feuille monte du bas. Il est remplacé
// par l'écran de connexion (KL-26) puis par « Aujourd'hui » (KL-28).
//
// KL-24 y ajoute le compteur de la base locale : c'est ce qui permet de voir que
// les migrations sont passées et que le jeu de démonstration s'injecte, sans
// écran dédié — il disparaîtra avec le reste de cet écran.
export default function IndexScreen() {
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
      <Header eyebrow="Composants — KL-23" title="Kadens" right={<Chip label="Local" rank={2} />} />

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

        <Card title="Configuration">
          <Text style={styles.label}>API</Text>
          <Text style={styles.value}>{API_URL ?? 'non configurée (.env)'}</Text>
        </Card>

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
});
