/**
 * Le croisement préférence × système, et la parité des deux jeux.
 *
 * `resolveTheme` est pure, donc vérifiable sans rendu — c'est la raison pour
 * laquelle elle est exportée séparément du fournisseur. Ce qu'elle protège est
 * une règle courte mais facile à retourner par mégarde : la préférence gagne
 * toujours, sauf quand elle dit « système », et une absence de réponse du
 * système retombe sur le papier.
 */

import { palettes, resolveTheme } from '@/theme';

describe('resolveTheme', () => {
  it('laisse la préférence gagner, quoi que dise le téléphone', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', null)).toBe('light');
    expect(resolveTheme('dark', null)).toBe('dark');
  });

  it('suit le téléphone quand on le lui demande', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('retombe sur le papier quand le système ne se prononce pas', () => {
    // `null` et « unspecified » disent la même chose : personne n'a répondu.
    // L'identité Presse est du papier, c'est elle le défaut.
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('light');
  });
});

describe('les deux palettes', () => {
  it('portent exactement les mêmes tokens', () => {
    // Le serveur l'assère, le générateur le revérifie, et ceci le constate une
    // troisième fois — parce que le fichier est généré et qu'une édition à la
    // main resterait sinon invisible jusqu'à une couleur transparente en salle.
    expect(Object.keys(palettes.dark)).toEqual(Object.keys(palettes.light));
  });

  it('ne disent pas la même chose', () => {
    const same = Object.keys(palettes.light).filter(
      (token) =>
        palettes.light[token as keyof typeof palettes.light] ===
        palettes.dark[token as keyof typeof palettes.dark],
    );

    // Une poignée de tokens **doit** rester identique : le rouge veut dire la
    // même chose sur les deux papiers. Mais pas la majorité — deux jeux
    // identiques signifieraient que le bloc sombre n'a pas été régénéré.
    expect(same.length).toBeLessThan(Object.keys(palettes.light).length / 2);
    expect(palettes.dark.primary).toBe(palettes.light.primary);
    expect(palettes.dark.bg).not.toBe(palettes.light.bg);
  });
});
