/**
 * Ce que le clavier recouvre, mesuré plutôt que deviné (KL-39).
 *
 * Le problème est réel et pas théorique : la feuille d'ajustement d'une série
 * est ancrée en bas de l'écran, et le clavier s'ouvre exactement là. Sans
 * dégagement, on tape une charge sans voir le champ qu'on remplit ni le bouton
 * qui valide.
 *
 * ## Pourquoi un recouvrement mesuré, et pas la hauteur du clavier
 *
 * Deux comportements coexistent sur Android et on ne sait pas lequel s'applique
 * depuis le JavaScript : la fenêtre se **redimensionne** au-dessus du clavier
 * (`adjustResize`, le défaut d'Expo), ou elle reste pleine et le clavier se pose
 * par-dessus — ce que fait une `Modal` en bord à bord, donc précisément le cas
 * de la feuille. Ajouter la hauteur du clavier dans le premier cas lèverait la
 * feuille **deux fois**, très haut, pour rien.
 *
 * D'où le calcul : le recouvrement est ce qui dépasse du bas de la vue hôte,
 * `hauteur de la vue − haut du clavier à l'écran`. Une fenêtre déjà
 * redimensionnée a un bas au-dessus du clavier, le recouvrement vaut zéro, et
 * le dégagement ne s'ajoute pas. La même valeur est donc juste dans les deux
 * cas, sans avoir à savoir lequel on est.
 *
 * L'hôte doit être posé **en haut de l'écran** pour que sa hauteur vaille sa
 * position basse — c'est le cas des deux emplois : la racine d'un écran, et la
 * racine d'une `Modal` translucide.
 *
 * Le `hide` est écouté en `Will`/`Did` : Android n'émet que `Did`, iOS émet les
 * deux, et rien ici ne dépend de la plateforme.
 */

import { useCallback, useEffect, useState } from 'react';
import { Keyboard, type LayoutChangeEvent } from 'react-native';

export type KeyboardOverlap = {
  /** Points de contenu recouverts par le clavier. Zéro quand il est fermé. */
  overlap: number;
  /** À poser sur la vue hôte : c'est elle qu'on mesure. */
  onLayout: (event: LayoutChangeEvent) => void;
};

export function useKeyboardOverlap(): KeyboardOverlap {
  const [height, setHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  }, []);

  return {
    overlap: keyboardTop === null ? 0 : Math.max(0, height - keyboardTop),
    onLayout,
  };
}
