import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_URL } from '@/config';

// Écran de vérification du socle : il ne fait qu'afficher la configuration
// effective. Il est remplacé par l'écran de connexion (KL-26) puis par
// « Aujourd'hui » (KL-28). Aucune couleur en dur ici : les tokens arrivent
// en KL-22 (règle 1 du design system).
export default function IndexScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.block}>
        <Text style={styles.title}>Kadens</Text>
        <Text style={styles.line}>Socle mobile (KL-21)</Text>
        <Text style={styles.line}>API : {API_URL ?? 'non configurée (.env)'}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  block: { flex: 1, justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  title: { fontSize: 28, fontWeight: '700' },
  line: { fontSize: 15 },
});
