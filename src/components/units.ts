/**
 * Les unités de Kadens, mises en forme pour l'œil (KL-29).
 *
 * Pendant natif d'`UnitFormatter` (dépôt serveur), et **volontairement** aligné
 * dessus : une charge et une durée doivent se lire à l'identique sur le téléphone
 * et sur `/schedule/{id}`, sinon comparer les deux écrans demanderait de traduire
 * de tête. La base ne stocke que des valeurs brutes — kg, mètres, secondes — et
 * c'est ici, au dernier moment, qu'elles deviennent lisibles.
 *
 * ## Pourquoi ce fichier est dans `components/` et pas dans `session/`
 *
 * Parce que c'est de la mise en forme, pas du domaine : `@/session` décide de ce
 * qui est fait, pas de la façon dont un nombre s'écrit. Et parce que le rendu
 * français des nombres existe déjà ici (`formatNumber`, posé par le
 * `NumberStepper` en KL-23) — deux implémentations d'une virgule décimale
 * finiraient par diverger sur un arrondi.
 */

import { formatNumber } from './NumberStepper';

/**
 * Une grandeur, nombre et unité **séparés**.
 *
 * Une ligne de séance écrit l'unité plus petite que le nombre (`text.numericUnit`)
 * : ce qu'on lit d'une série est le chiffre, l'unité dit seulement de quoi il
 * parle, et elle se répète à chaque ligne d'un tableau qui n'en a pas la place.
 * Deux `Text` imbriqués demandent donc les deux morceaux, pas la phrase.
 *
 * `unit` est `null` quand la grandeur n'en porte pas : « 0:45 » se lit tout
 * seul, et « 0:45 min » serait faux au-delà d'une heure.
 */
export type Measure = { value: string; unit: string | null };

/** « 80 kg », « 82,5 kg ». Jamais de décimale inutile : les charges se comptent en demi-kilos. */
export function weight(kg: number): string {
  return join(weightParts(kg));
}

/** `weight()`, en deux morceaux. */
export function weightParts(kg: number): Measure {
  return { value: formatNumber(kg), unit: 'kg' };
}

/**
 * Secondes → `m:ss`, ou `h:mm:ss` au-delà d'une heure.
 *
 * Le même format que le serveur, y compris pour les durées courtes : un gainage
 * de 45 secondes s'affiche « 0:45 » ici comme dans le tableau de séries du web.
 * « 45 s » se lirait mieux isolément, mais une colonne où certaines lignes sont
 * en `m:ss` et d'autres en secondes ne s'aligne plus.
 */
export function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  const padded = String(rest).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${padded}`;
  }

  return `${minutes}:${padded}`;
}

/**
 * L'effort d'une série : ce qu'elle demande de faire, charge exclue.
 *
 * Les répétitions priment sur la durée quand les deux sont là — le modèle du
 * réalisé n'a pas de `PrescriptionType` pour trancher, il porte ses valeurs et on
 * lit celle qui est renseignée, exactement comme `PerformanceHistory` côté
 * serveur. Rend `null` quand il n'y a rien à dire : une série au poids du corps
 * sans compte ni chrono existe, et « ? » ne l'améliorerait pas.
 */
export function setEffort(reps: number | null, durationSeconds: number | null): string | null {
  const parts = setEffortParts(reps, durationSeconds);

  return parts === null ? null : join(parts);
}

/** `setEffort()`, en deux morceaux. Un chrono n'a pas d'unité à écrire. */
export function setEffortParts(
  reps: number | null,
  durationSeconds: number | null,
): Measure | null {
  if (reps !== null) {
    return { value: String(reps), unit: `rep${reps > 1 ? 's' : ''}` };
  }

  if (durationSeconds !== null) {
    return { value: duration(durationSeconds), unit: null };
  }

  return null;
}

/**
 * Les deux morceaux recollés. C'est cette phrase que lisent les libellés
 * d'accessibilité et tout ce qui compose (la barre basse, l'historique) : une
 * grandeur ne s'écrit qu'ici, sous les deux formes, sinon la version parlée et
 * la version peinte finiraient par diverger sur un pluriel.
 */
function join({ value, unit }: Measure): string {
  return unit === null ? value : `${value} ${unit}`;
}
