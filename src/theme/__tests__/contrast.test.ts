/**
 * Les contrastes de l'app, vérifiés à AA (KL-39).
 *
 * Le contexte d'usage rend la question moins théorique qu'ailleurs : un écran
 * gras, une salle mal éclairée, un téléphone tenu à bout de bras. Un gris trop
 * clair qui « passe » sur un écran de bureau ne se lit plus du tout entre deux
 * séries.
 *
 * ## Ce que cette suite tient, et ce qu'elle ne peut pas tenir
 *
 * Elle tient une **table déclarée** des couples encre/fond que l'app pose
 * vraiment, avec le rôle typographique de chacun — c'est lui qui fixe le seuil,
 * 4,5:1 en corps courant et 3:1 dès qu'un texte est grand au sens WCAG. Un token
 * changé côté serveur, un rôle qui grossit ou maigrit, et la table retombe
 * dessus toute seule.
 *
 * Elle ne peut pas déduire seule sur quel fond une couleur atterrit : c'est la
 * mise en page qui le dit, et aucune analyse statique raisonnable ne la lit. La
 * table est donc **à tenir à la main**, comme celle des douze statuts de KL-38 —
 * un couple nouveau s'y ajoute quand on l'introduit.
 *
 * Deux exemptions assumées, l'une et l'autre prévues par WCAG :
 *
 * - **les contours décoratifs** (`--color-border` sur une carte, un filet de
 *   séparation) ne portent aucune information : l'identité Presse les emploie
 *   comme le papier emploie un trait de règle. Ceux qui **identifient un
 *   contrôle**, eux, sont dans la table à 3:1 — la case d'une série d'abord, qui
 *   est la cible qu'on vise sans regarder ;
 * - **les contrôles inactifs** (`boxIdle`, un bouton désactivé) sont hors du
 *   champ de `§1.4.11`, et c'est heureux : leur pâleur **est** l'information.
 *
 * Le rang catégoriel (`cat1..cat4`) n'y est pas non plus. Une échelle de gris qui
 * code cinq activités a forcément des membres pâles ; ils sont toujours doublés
 * du mot qu'ils qualifient (le libellé de la pilule), donc jamais seuls porteurs
 * du sens.
 */

import { AA_LARGE, AA_TEXT, contrastRatio, isLargeText } from '@/test/contrast';
import { colors, text, type ColorToken, type TextRole } from '@/theme';

type InkCase = {
  /** L'encre posée. */
  ink: ColorToken;
  /** Le fond qu'elle rencontre à l'écran. */
  on: ColorToken;
  /** Le rôle typographique, qui décide du seuil. */
  role: TextRole;
  where: string;
};

/**
 * Les couples que l'app pose. Ordre de lecture : le socle, puis l'écran de
 * séance, puis les composants.
 */
const INK: InkCase[] = [
  // Le corps de texte, sur les trois fonds de l'identité.
  { ink: 'text', on: 'surfaceRaised', role: 'name', where: "nom d'exercice" },
  { ink: 'text', on: 'surfaceRaised', role: 'numeric', where: 'charge et répétitions' },
  { ink: 'text', on: 'surfaceSubtle', role: 'numeric', where: "séries de l'exercice courant" },
  { ink: 'text', on: 'surfaceRaised', role: 'sectionTitle', where: 'titre de section' },
  { ink: 'text', on: 'surfaceRaised', role: 'inputValue', where: 'chrono de repos' },
  { ink: 'text', on: 'fill', role: 'blockRole', where: 'rôle de bloc' },
  { ink: 'textStrong', on: 'surfaceRaised', role: 'body', where: 'valeur saisie dans un champ' },
  { ink: 'textStrong', on: 'surfaceRaised', role: 'inputValue', where: 'valeur du compteur' },

  // L'encre secondaire : tout ce qui accompagne, et qui a remplacé l'encre
  // faible en KL-39 (elle tombait à 3,4:1 sur le papier).
  { ink: 'textSecondary', on: 'bg', role: 'caption', where: 'mention sur le papier' },
  { ink: 'textSecondary', on: 'bg', role: 'eyebrow', where: 'sur-titre sur le papier' },
  { ink: 'textSecondary', on: 'surface', role: 'caption', where: 'mention dans une feuille' },
  { ink: 'textSecondary', on: 'surfaceRaised', role: 'caption', where: 'mention dans un bloc' },
  { ink: 'textSecondary', on: 'surfaceRaised', role: 'eyebrow', where: "libellé d'un chip" },
  { ink: 'textSecondary', on: 'surfaceRaised', role: 'numeric', where: "tableau d'historique" },
  {
    ink: 'textSecondary',
    on: 'surfaceSubtle',
    role: 'numeric',
    where: 'historique, exercice courant',
  },
  { ink: 'textSecondary', on: 'fill', role: 'caption', where: "libellé d'un en-tête de bloc" },
  { ink: 'textSecondary', on: 'fill', role: 'numeric', where: 'rang de bloc' },
  { ink: 'textSecondary', on: 'fill', role: 'eyebrow', where: 'bandeau hors ligne' },
  { ink: 'textSecondary', on: 'surfaceRaised', role: 'tabLabel', where: 'onglet au repos' },
  { ink: 'textSoft', on: 'surfaceRaised', role: 'eyebrow', where: "unité d'un compteur" },
  { ink: 'textSoft', on: 'surfaceRaised', role: 'body', where: "invite d'un champ" },
  { ink: 'textSoft', on: 'bg', role: 'sectionTitle', where: "titre d'un état vide" },

  // L'encre inversée.
  { ink: 'onInk', on: 'surfaceInk', role: 'eyebrow', where: 'facette retenue' },
  { ink: 'onInk', on: 'surfaceInk', role: 'numeric', where: 'jour choisi' },
  { ink: 'surfaceRaised', on: 'text', role: 'action', where: 'bouton secondaire pressé' },
  { ink: 'surfaceRaised', on: 'text', role: 'blockRole', where: 'glyphe de compteur pressé' },

  // Le rouge : plein sous un libellé blanc, foncé quand il écrit.
  { ink: 'onPrimary', on: 'primary', role: 'action', where: 'bouton primaire' },
  { ink: 'onPrimary', on: 'primaryHover', role: 'action', where: 'bouton primaire pressé' },
  {
    // Le chrono a maigri (une ligne fine au lieu d'un étage) : il n'est plus un
    // « grand texte » au sens WCAG, donc le rouge plein n'y suffit plus. C'est
    // exactement la règle « le rouge qui écrit est `primaryOnTint` ».
    ink: 'primaryOnTint',
    on: 'surfaceRaised',
    role: 'inputValue',
    where: 'chrono de repos échu',
  },
  { ink: 'primaryOnTint', on: 'bg', role: 'body', where: "message d'échec" },
  { ink: 'primaryOnTint', on: 'bg', role: 'caption', where: "aide d'un champ en erreur" },
  { ink: 'primaryOnTint', on: 'surface', role: 'caption', where: 'champ en erreur, en feuille' },
  { ink: 'primaryOnTint', on: 'surfaceRaised', role: 'eyebrow', where: 'chip « manquée »' },
  { ink: 'statusDone', on: 'surfaceRaised', role: 'eyebrow', where: 'chip « faite »' },
];

/**
 * Les objets graphiques qui **identifient un contrôle** (`§1.4.11`, 3:1). Rien
 * de décoratif ici : ce sont les formes qu'il faut voir pour savoir où appuyer.
 */
const SHAPES: { color: ColorToken; on: ColorToken; where: string }[] = [
  { color: 'textSecondary', on: 'surfaceRaised', where: "case d'une série à cocher" },
  { color: 'text', on: 'surfaceRaised', where: "case d'une série cochée" },
  { color: 'statusPlanned', on: 'surfaceRaised', where: 'pastille de statut' },
  { color: 'statusMissed', on: 'surfaceRaised', where: "filet d'un champ en erreur" },
  { color: 'text', on: 'surfaceRaised', where: 'filet de la barre basse' },
];

describe('les contrastes de texte', () => {
  it.each(INK)('$ink sur $on — $where', ({ ink, on, role }) => {
    const style = text[role];
    const large = isLargeText(style.fontSize ?? 0, String(style.fontWeight ?? '400'));
    const floor = large ? AA_LARGE : AA_TEXT;

    expect(contrastRatio(colors[ink], colors[on])).toBeGreaterThanOrEqual(floor);
  });
});

describe('les contrastes de forme', () => {
  it.each(SHAPES)('$color sur $on — $where', ({ color, on }) => {
    expect(contrastRatio(colors[color], colors[on])).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe("l'encre faible", () => {
  it('ne porte plus de texte nulle part', () => {
    // Elle passe sur du blanc et échoue sur le papier (3,4:1) comme sur un fond
    // appuyé (4,2:1) : un token dont la validité dépend du fond où il tombe est
    // un piège, et la vue qui le pose ne le sait pas. KL-39 l'a donc retiré
    // partout au profit de `textSecondary`, et cette table le constate.
    expect(contrastRatio(colors.textFaint, colors.bg)).toBeLessThan(AA_TEXT);
    expect(INK.some((entry) => entry.ink === 'textFaint')).toBe(false);
  });
});
