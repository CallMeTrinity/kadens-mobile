import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_URL } from '@/config';
import { colors, space, text } from '@/theme';

// Écran de vérification du socle : il affiche la configuration effective et un
// échantillon de l'échelle typographique — le seul moyen de voir d'un coup
// d'œil que les onze polices sont chargées et que la règle de casse tient. Il
// est remplacé par l'écran de connexion (KL-26) puis par « Aujourd'hui »
// (KL-28).
const SAMPLES: { role: keyof typeof text; label: string; sample: string }[] = [
  { role: 'pageTitle', label: 'Titre d’écran', sample: 'Aujourd’hui' },
  { role: 'sectionTitle', label: 'Titre de section', sample: 'Bloc principal' },
  { role: 'action', label: 'Bouton, onglet', sample: 'Démarrer' },
  { role: 'eyebrow', label: 'Sur-titre mono', sample: 'Séance du jour' },
  { role: 'name', label: 'Nom saisi', sample: 'Développé couché haltères' },
  { role: 'body', label: 'Corps', sample: 'Trois séries de huit, deux minutes de repos.' },
  { role: 'numeric', label: 'Valeur', sample: '82,5 kg × 8' },
];

export default function IndexScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.row}>
          <Text style={styles.label}>Socle de design — KL-22</Text>
          <Text style={styles.hero}>Kadens</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>API</Text>
          <Text style={styles.value}>{API_URL ?? 'non configurée (.env)'}</Text>
        </View>

        <Text style={styles.sectionTitle}>Échelle</Text>

        {SAMPLES.map(({ role, label, sample }) => (
          <View key={role} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={text[role]}>{sample}</Text>
          </View>
        ))}

        <View style={styles.row}>
          <Text style={styles.label}>Tonnage</Text>
          <Text style={styles.kpi}>4 260 kg</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  page: { padding: space[10], gap: space[7] },
  hero: { ...text.hero, color: colors.text },
  sectionTitle: { ...text.sectionTitle, color: colors.text },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[7],
    gap: space[2],
  },
  row: { gap: space[1] },
  label: { ...text.eyebrow, color: colors.textFaint },
  value: { ...text.numeric, color: colors.text },
  kpi: { ...text.kpi, color: colors.text },
});
