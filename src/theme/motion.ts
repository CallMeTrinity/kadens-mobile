/**
 * Le réglage système « réduire les animations » (KL-39).
 *
 * Il n'est **pas** tokenisé, comme `layout.ts` : ce n'est pas une valeur de la
 * feuille de style du serveur mais une préférence de l'appareil. Le web la lit
 * en `@media (prefers-reduced-motion: reduce)` ; Android l'expose par
 * `AccessibilityInfo`, et c'est le même réglage — « Supprimer les animations »
 * dans les options d'accessibilité.
 *
 * Ce que ça change dans cette app, et c'est court parce qu'elle bouge peu : la
 * feuille modale monte ou apparaît, et le déroulé d'une séance rejoint la série
 * courante d'un glissement ou d'un saut. Rien d'autre n'est animé — aucun
 * `Animated`, aucun `LayoutAnimation`, et ce n'est pas un oubli.
 *
 * **La valeur de départ est « pas de réduction », et elle se corrige au premier
 * rendu.** La lecture est asynchrone : partir de `true` ferait sauter la
 * première feuille de la session chez tout le monde, partir de `false` fait au
 * pire une animation de trop chez qui les a désactivées. On préfère la seconde
 * erreur, qui se corrige en quelques millisecondes.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) {
        setReduced(enabled);
      }
    });

    // Le réglage se change sans quitter l'app — on revient des paramètres
    // système et l'app doit déjà l'appliquer.
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
