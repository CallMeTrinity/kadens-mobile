import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors, useKadensFonts } from '@/theme';

// L'écran de démarrage reste affiché tant que les polices ne sont pas prêtes.
// Sans ça le premier rendu sort en police système puis bascule : la mise en
// page saute, et un titre condensé change de largeur du tout au tout.
SplashScreen.preventAutoHideAsync();

// Les composants de base arrivent en KL-23 : ici, rien d'autre que le socle de
// navigation et le fond papier.
export default function RootLayout() {
  const [fontsLoaded, fontError] = useKadensFonts();

  useEffect(() => {
    // On masque aussi en cas d'erreur : une police manquante dégrade
    // l'affichage, elle ne doit pas bloquer l'app sur un démarrage sans fin.
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
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
