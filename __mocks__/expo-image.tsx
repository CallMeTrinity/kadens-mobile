/**
 * `expo-image` sous Jest.
 *
 * Même raison que `expo-notifications.ts` : le module vrai **refuse de se
 * charger** dans l'environnement de test. Son point d'entrée branche une
 * intégration native (`expo-observe`) que le préréglage de `jest-expo` ne simule
 * pas, et lève à l'import. Toute suite qui importe `@/components` en hérite,
 * puisque `MessageSheet.tsx` l'importe.
 *
 * Le double rend le module **importable**, rien de plus : jouer un GIF se
 * vérifie sur un téléphone. La surface reprise est exactement celle qu'appelle
 * `src/components/MessageSheet.tsx`.
 */

import { View, type ViewProps } from 'react-native';

export function Image(props: ViewProps): React.JSX.Element {
  return <View {...props} />;
}

Image.prefetch = async (): Promise<boolean> => true;
