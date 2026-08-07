/**
 * La carte musculaire, et la seule chose qui puisse casser en silence : l'accord
 * entre les zones de Kadens et les tracés figés.
 *
 * TypeScript tient déjà la moitié de la promesse — `AREA_TO_SLUG` ne compile pas
 * s'il manque une `TargetArea`, ni si un `slug` n'appartient pas au jeu. Ce qu'il
 * ne peut pas tenir, c'est que ces `slug`-là soient encore **dessinés** : une
 * régénération de `bodyPaths.ts` depuis une version amont qui renomme un muscle
 * laisserait une zone grise pour toujours, sans erreur ni test rouge ailleurs.
 * D'où les deux sens vérifiés ici.
 *
 * Le rendu, lui, n'est pas testé : un `Svg` de vingt-deux tracés ne se vérifie
 * pas par une assertion, il se regarde sur un téléphone.
 */

import { AREA_TO_SLUG, bodyLevelColor, type BodyLevel } from '@/components/BodyMap';
import { BODY_PLATES, type MuscleSlug } from '@/components/bodyPaths';

/** Tous les muscles réellement dessinés, les quatre planches confondues. */
const DRAWN = new Set<MuscleSlug>(
  Object.values(BODY_PLATES).flatMap((plate) => plate.muscles.map((muscle) => muscle.slug)),
);

/** Les formes qui ne se peignent pas, par planche. */
const INERT = Object.entries(BODY_PLATES).map(
  ([key, plate]) => [key, plate.inert.map((shape) => shape.slug)] as const,
);

describe('la correspondance zone ↔ tracé', () => {
  it('donne à chaque zone un muscle qui est effectivement dessiné', () => {
    const missing = Object.entries(AREA_TO_SLUG).filter(
      ([, slug]) => !DRAWN.has(slug as MuscleSlug),
    );

    expect(missing).toEqual([]);
  });

  it('n’oublie aucun muscle dessiné', () => {
    // L'inverse du précédent : un muscle sans zone en face ne s'allumerait
    // jamais, et le dessin porterait une forme que la séance ne peut pas peindre.
    const mapped = new Set(Object.values(AREA_TO_SLUG));

    expect([...DRAWN].filter((slug) => !mapped.has(slug))).toEqual([]);
  });

  it('n’envoie pas deux zones sur le même muscle', () => {
    const slugs = Object.values(AREA_TO_SLUG);

    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('ce qui ne se peint pas', () => {
  it('n’est jamais confondu avec un muscle', () => {
    // Un `hair` qui passerait dans `muscles` prendrait une teinte de charge à la
    // première séance de traction. Les deux listes ne se croisent nulle part.
    for (const [, slugs] of INERT) {
      expect(slugs.filter((slug) => DRAWN.has(slug as unknown as MuscleSlug))).toEqual([]);
    }
  });

  it('dessine la chevelure en dernier, sur les quatre planches', () => {
    // La source déclare `hair` avant `head` côté féminin : dessinée dans cet
    // ordre, la chevelure disparaîtrait sous le crâne. C'est ce que l'ordre
    // imposé de `bodyPaths.ts` corrige, et ce que ce test garde corrigé.
    for (const [key, slugs] of INERT) {
      expect([key, slugs.at(-1)]).toEqual([key, 'hair']);
    }
  });

  it('donne une tête et des mains à chaque planche', () => {
    for (const [key, slugs] of INERT) {
      expect([key, slugs.includes('hands')]).toEqual([key, true]);
      // De dos, la chevelure EST la tête : la source ne dessine pas de crâne là.
      expect([key, slugs.includes('head')]).toEqual([key, key !== 'female-back']);
    }
  });
});

describe('les planches', () => {
  it('portent les quatre corps, avec un contour et des muscles', () => {
    for (const [key, plate] of Object.entries(BODY_PLATES)) {
      expect(plate.outline.length).toBeGreaterThan(0);
      expect(plate.muscles.length).toBeGreaterThan(0);
      // Quatre nombres, sinon le calcul de largeur rendrait `NaN` et la planche
      // disparaîtrait sans erreur.
      expect(plate.viewBox.split(' ').map(Number).filter(Number.isFinite)).toHaveLength(4);
      expect(key).toMatch(/^(male|female)-(front|back)$/);
    }
  });
});

describe('les paliers', () => {
  it('ont trois teintes distinctes', () => {
    const levels: BodyLevel[] = [1, 2, 3];
    const fills = levels.map(bodyLevelColor);

    expect(new Set(fills).size).toBe(3);
  });
});
