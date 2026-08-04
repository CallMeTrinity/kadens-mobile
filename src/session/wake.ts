/**
 * La veille de l'écran pendant une séance (KL-31).
 *
 * Le contexte du ticket, une fois de plus : on pose le téléphone sur le banc,
 * on fait sa série, on le reprend. Entre les deux il s'est écoulé une minute, et
 * l'écran s'est éteint — voire le téléphone s'est verrouillé, et il faut le
 * code, les mains moites, pour cocher une case. La veille n'est donc pas un
 * confort, c'est ce qui rend l'app utilisable au-delà de la première série.
 *
 * ## Pourquoi pas `useKeepAwake()`
 *
 * Le hook d'`expo-keep-awake` tient la veille tant que le composant est **monté**,
 * sans condition. Or l'écran de séance se monte aussi pour une séance close ou
 * pas encore commencée — regarder ce qu'on a fait hier n'a aucune raison de
 * garder l'écran allumé jusqu'à ce que la batterie tombe. Il faut donc une veille
 * **conditionnée**, ce que seul le couple activer/relâcher permet.
 *
 * ## Le verrou porte une étiquette, et c'est ce qui le rend sûr
 *
 * `expo-keep-awake` compte ses verrous par étiquette : deux activations sous la
 * même étiquette se relâchent d'un seul appel. En nommant celle-ci, on garantit
 * que quitter l'écran de séance ne relâche pas un verrou posé par quelqu'un
 * d'autre, et qu'un remontage ne laisse pas un verrou orphelin derrière lui —
 * ce qui, dans le cas contraire, garderait l'écran allumé jusqu'au prochain
 * redémarrage de l'app.
 */

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

/** L'étiquette du verrou de séance. Une seule dans toute l'app. */
const WORKOUT_TAG = 'kadens-workout';

/**
 * Garde l'écran allumé tant que `active` est vrai.
 *
 * Relâché au démontage **et** dès que `active` retombe : une séance qu'on clôture
 * (KL-33) rend la main à l'extinction automatique sans qu'il faille quitter
 * l'écran.
 */
export function useKeepScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    // Les deux promesses sont volontairement ignorées : l'échec possible est
    // « le module natif n'est pas disponible » (le rendu web du dépôt), et un
    // écran qui s'éteint n'est pas une raison d'interrompre une séance.
    void activateKeepAwakeAsync(WORKOUT_TAG).catch(() => {});

    return () => {
      void deactivateKeepAwake(WORKOUT_TAG).catch(() => {});
    };
  }, [active]);
}
