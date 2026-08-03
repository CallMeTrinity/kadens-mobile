import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useDatabaseMigrations } from '@/db';
import { colors, space, text, useKadensFonts } from '@/theme';

// L'écran de démarrage reste affiché tant que les polices ne sont pas prêtes.
// Sans ça le premier rendu sort en police système puis bascule : la mise en
// page saute, et un titre condensé change de largeur du tout au tout.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useKadensFonts();
  // Les migrations locales (KL-24) : une fois par version de schéma, journal
  // tenu par Drizzle. Elles doivent avoir tourné avant qu'un écran lise quoi
  // que ce soit — une requête sur une table pas encore créée ne « charge »
  // pas, elle échoue.
  const { success: dbReady, error: dbError } = useDatabaseMigrations();

  const fontsSettled = fontsLoaded || fontError !== null;
  const dbSettled = dbReady || dbError !== undefined;

  useEffect(() => {
    // On masque aussi en cas d'erreur : une police manquante dégrade
    // l'affichage, elle ne doit pas bloquer l'app sur un démarrage sans fin.
    // Même chose pour la base — mais elle, elle se **dit** (ci-dessous), parce
    // qu'elle porte le réalisé pas encore poussé.
    if (fontsSettled && dbSettled) {
      SplashScreen.hideAsync();
    }
  }, [fontsSettled, dbSettled]);

  if (!fontsSettled || !dbSettled) {
    return null;
  }

  if (dbError) {
    return (
      <SafeAreaProvider>
        <View style={styles.fault}>
          <Text style={styles.faultTitle}>Base locale indisponible</Text>
          <Text style={styles.faultBody}>
            Les migrations n’ont pas pu s’appliquer. Rien n’a été perdu : le réalisé déjà consigné
            reste dans le fichier.
          </Text>
          <Text style={styles.faultDetail}>{dbError.message}</Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // Le rouge ne sort que sur un échec — ici c'en est un (§5 règle 2).
  fault: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: space[8],
    gap: space[4],
  },
  faultTitle: { ...text.sectionTitle, color: colors.primary },
  faultBody: { ...text.body, color: colors.textSecondary },
  faultDetail: { ...text.caption, color: colors.textFaint },
});
