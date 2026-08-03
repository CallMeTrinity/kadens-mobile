import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Socle de navigation. Le thème (polices, tokens) arrive en KL-22, les
// composants de base en KL-23 : rien de visuel ne se décide ici.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
