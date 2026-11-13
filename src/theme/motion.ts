/**
 * Le réglage système « réduire les animations » (KL-39), et la seule façon
 * d'animer dans cette app.
 *
 * Il n'est **pas** tokenisé, comme `layout.ts` : ce n'est pas une valeur de la
 * feuille de style du serveur mais une préférence de l'appareil. Le web la lit
 * en `@media (prefers-reduced-motion: reduce)` ; Android l'expose par
 * `AccessibilityInfo`, et c'est le même réglage — « Supprimer les animations »
 * dans les options d'accessibilité.
 *
 * ## Ce qui bouge, et c'est une liste fermée
 *
 * L'app a longtemps tenu en deux mouvements : la feuille modale monte, et le
 * déroulé d'une séance rejoint la série courante. La refonte « éléments plus
 * chaleureux » en ajoute quatre, tous des **accusés de réception** d'un geste :
 *
 * - la case d'une série rebondit quand on la coche ;
 * - un exercice bouclé tire son filet de fin, de gauche à droite ;
 * - « Bouclé » et « Ensuite » montent en place quand l'exercice se termine ;
 * - le bonhomme de forme choisi sautille sur l'écran Ressenti.
 *
 * Ils passent tous par `useEntrance`, et c'est ce qui leur donne trois règles
 * qu'on n'a pas à se rappeler :
 *
 * 1. **Ils ne jouent qu'à la transition, jamais au montage.** Rouvrir une séance
 *    aux trois quarts faite ne fait pas rebondir douze cases : ce qui était
 *    déjà vrai à l'arrivée s'affiche dans son état final.
 * 2. **Ils ne touchent que `transform` et `opacity`.** Rien ne pousse la mise en
 *    page : une ligne qui grandirait sous le pouce au moment où on la coche
 *    serait exactement ce que KL-39 interdit. D'où le pilote natif.
 * 3. **« Réduire les animations » les éteint tous**, et ils sautent alors à leur
 *    état final — l'information reste, seul le mouvement part.
 *
 * Toujours aucun `LayoutAnimation`, et ce n'est pas un oubli.
 *
 * **La valeur de départ est « pas de réduction », et elle se corrige au premier
 * rendu.** La lecture est asynchrone : partir de `true` ferait sauter la
 * première feuille de la session chez tout le monde, partir de `false` fait au
 * pire une animation de trop chez qui les a désactivées. On préfère la seconde
 * erreur, qui se corrige en quelques millisecondes.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

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

/** Le `ease-out` du CSS, pour que le téléphone et la maquette aient le même geste. */
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

let reducedNow = false;
let watching = false;

/**
 * Le réglage, lu **sans hook**, tenu à jour par un seul abonnement pour l'app.
 *
 * `useEntrance` est monté par chaque ligne de série — trente, soixante dans une
 * grosse séance. Passer par `useReducedMotion` ouvrirait autant d'abonnements
 * système et autant de lectures asynchrones pour une valeur qui ne sert qu'au
 * moment d'une transition. L'abonnement n'est jamais retiré : il vit autant que
 * l'app, comme le réglage qu'il suit.
 */
function reducedMotionNow(): boolean {
  if (!watching) {
    watching = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reducedNow = enabled;
    });
    AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reducedNow = enabled;
    });
  }

  return reducedNow;
}

/**
 * Une progression de 0 à 1 qui se joue quand `on` **devient** vrai.
 *
 * L'appelant en tire ce qu'il veut par `interpolate` — une échelle, un décalage,
 * une opacité — mais seulement sur `transform` et `opacity` (règle 2 ci-dessus) :
 * la valeur est pilotée nativement, et le pilote natif refuse le reste.
 *
 * Au montage, la valeur est déjà à son terme si `on` est vrai, à zéro sinon.
 * Repasser à faux la remet à zéro sans mouvement : décocher une série n'a rien à
 * célébrer.
 */
export function useEntrance(on: boolean, duration: number): Animated.Value {
  const [value] = useState(() => {
    // Le premier montage lance la lecture du réglage, bien avant la première
    // transition : elle sera juste au moment où elle servira.
    reducedMotionNow();

    return new Animated.Value(on ? 1 : 0);
  });
  const previous = useRef(on);

  useEffect(() => {
    const was = previous.current;
    previous.current = on;

    if (on === was) {
      return;
    }

    if (!on || reducedMotionNow()) {
      value.setValue(on ? 1 : 0);

      return;
    }

    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();

    return () => animation.stop();
  }, [on, duration, value]);

  return value;
}
