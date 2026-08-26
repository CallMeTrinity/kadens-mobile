/**
 * Les unités, sous leurs deux formes.
 *
 * Une grandeur s'écrit désormais de deux façons : la phrase (« 17 reps »), que
 * lisent les libellés d'accessibilité, la barre basse et tout ce qui compose ;
 * les deux morceaux (« 17 » + « reps »), que peint une ligne de séance pour
 * écrire l'unité plus petite que le nombre. Le risque de deux écritures est
 * qu'elles divergent — sur un pluriel, sur une virgule décimale, sur l'espace —
 * et personne ne le verrait avant d'entendre la ligne parler autrement qu'elle
 * ne s'affiche.
 *
 * Ce qui se vérifie ici est donc **le recollement** : la phrase est exactement
 * les deux morceaux mis bout à bout, sur tout ce qu'une série peut porter.
 */

import { setEffort, setEffortParts, weight, weightParts } from '@/components';

/** Les deux morceaux, recollés comme le fait le formateur. */
function joined(parts: { value: string; unit: string | null } | null): string | null {
  if (parts === null) {
    return null;
  }

  return parts.unit === null ? parts.value : `${parts.value} ${parts.unit}`;
}

describe('la charge', () => {
  it.each([
    [80, '80', '80 kg'],
    // La demi-plaque, en virgule française : c'est le cas qui casserait si les
    // deux formes ne partageaient pas `formatNumber`.
    [82.5, '82,5', '82,5 kg'],
    [0, '0', '0 kg'],
  ])('%p s’écrit en deux morceaux comme en une phrase', (kg, value, sentence) => {
    expect(weightParts(kg)).toEqual({ value, unit: 'kg' });
    expect(weight(kg)).toBe(sentence);
    expect(joined(weightParts(kg))).toBe(weight(kg));
  });
});

describe('l’effort d’une série', () => {
  it('compte les répétitions, et accorde le pluriel dans les deux formes', () => {
    expect(setEffortParts(1, null)).toEqual({ value: '1', unit: 'rep' });
    expect(setEffortParts(12, null)).toEqual({ value: '12', unit: 'reps' });

    expect(joined(setEffortParts(1, null))).toBe(setEffort(1, null));
    expect(joined(setEffortParts(12, null))).toBe(setEffort(12, null));
  });

  it('n’écrit pas d’unité derrière un chrono', () => {
    // « 0:45 » se lit seul, et « 0:45 min » serait faux au-delà d'une heure :
    // c'est tout l'objet de `unit: null`, qui laisse la ligne peindre le chrono
    // d'un seul corps.
    expect(setEffortParts(null, 45)).toEqual({ value: '0:45', unit: null });
    expect(setEffortParts(null, 3661)).toEqual({ value: '1:01:01', unit: null });

    expect(joined(setEffortParts(null, 45))).toBe(setEffort(null, 45));
  });

  it('fait primer les répétitions sur la durée, comme la phrase', () => {
    expect(setEffortParts(8, 60)).toEqual({ value: '8', unit: 'reps' });
    expect(joined(setEffortParts(8, 60))).toBe(setEffort(8, 60));
  });

  it('n’invente rien quand la série ne dit ni compte ni chrono', () => {
    expect(setEffortParts(null, null)).toBeNull();
    expect(setEffort(null, null)).toBeNull();
  });
});
