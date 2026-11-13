/**
 * L'exercice **bouclé** : toutes ses séries prévues sont faites.
 *
 * Pur, comme `records.ts` : il lit le déroulé déjà croisé, rien d'autre. Deux
 * questions, et l'écran de séance les pose à chaque rendu :
 *
 * 1. **Cet exercice est-il bouclé ?** Il change alors de peau — compteur au vert,
 *    pastille « Bouclé », filet de fin. C'est un état, il se lit sur chaque
 *    exercice qui le vérifie, dans n'importe quel ordre.
 * 2. **Lequel vient de l'être ?** Celui-là seul annonce la suite (« Ensuite :
 *    Fentes bulgares »). Annoncer sous chaque exercice bouclé répéterait le même
 *    nom trois fois dans le déroulé, et il ne dirait plus « maintenant ».
 *
 * ## Bouclé n'est pas « fait » au sens du statut
 *
 * Le statut `done` appartient à la **séance** et se pose à la clôture. Bouclé ne
 * concerne qu'un exercice, ne s'écrit nulle part et se défait avec la dernière
 * série décochée. Il emprunte la couleur du statut fait parce que c'est la même
 * nouvelle à une autre échelle, pas parce qu'il en serait un.
 */

import { allExercises, findExercise, type SessionExercise, type SessionProgram } from './program';

/**
 * Toutes les séries prévues sont faites, et aucune n'attend encore.
 *
 * Trois exclusions qui viennent du décompte (`buildExercise`) : un exercice
 * **sauté** est réglé sans être bouclé (son `total` vaut 0), un exercice **hors
 * programme** ne réclamait rien (0 aussi), et une **série annoncée** en plus
 * (`draft`) attend d'être faite — elle ne compte pas dans `total`, d'où le
 * parcours des lignes en plus du compteur.
 */
export function isWrapped(exercise: SessionExercise): boolean {
  if (exercise.total === 0 || exercise.done < exercise.total) {
    return false;
  }

  return (exercise.lines ?? []).every((line) => line.logged !== null);
}

/**
 * La clé de l'exercice que la **dernière série cochée** de la séance a bouclé,
 * ou `null`.
 *
 * La dernière série se lit à son horodatage (`completedAt`, ISO UTC, donc
 * comparable en texte), pas à sa position : on mène une séance dans le désordre
 * (KL-52), et c'est la série faite à l'instant qui doit parler. Si elle n'a pas
 * bouclé son exercice — on en est au milieu — rien n'est annoncé.
 *
 * Un cardio n'a pas de série horodatée : il ne s'annonce pas de suite. La barre
 * basse, elle, propose déjà la cible suivante dans tous les cas.
 */
export function lastWrapped(program: SessionProgram): string | null {
  let latest: { at: string; key: string } | null = null;

  for (const exercise of allExercises(program)) {
    for (const line of exercise.lines ?? []) {
      const at = line.logged?.completedAt ?? null;

      if (at !== null && (latest === null || at > latest.at)) {
        latest = { at, key: exercise.key };
      }
    }
  }

  if (latest === null) {
    return null;
  }

  const exercise = findExercise(program, latest.key);

  return exercise !== null && isWrapped(exercise) ? exercise.key : null;
}
