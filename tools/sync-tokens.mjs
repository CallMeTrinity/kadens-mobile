/**
 * Génère `src/theme/tokens.ts` depuis `design-tokens.json` publié par le
 * serveur (KL-20).
 *
 *   npm run sync:tokens
 *   npm run sync:tokens -- --source=../kadens/public
 *
 * Ce que ce script fait, et ce qu'il ne fait pas :
 *
 * - `tokens.css` reste la source unique. Le JSON en est une projection, ce
 *   fichier-ci en est la traduction native. Une valeur inventée ici serait une
 *   deuxième identité.
 * - **L'adaptation aux API natives vit ici**, c'est la contrepartie du choix de
 *   `app:tokens:export`, qui résout les `var()` et ne traduit rien d'autre.
 *   React Native ne connaît ni `color-mix()`, ni les piles de polices, ni les
 *   longueurs en `px` ou en `em` : chacune de ces formes est convertie, et
 *   **toute valeur non reconnue échoue la commande**. Un token muet qui
 *   deviendrait `undefined` peindrait du transparent sans rien signaler.
 * - Les primitives de **couleur** et de **police** ne sont pas émises : la
 *   couche sémantique les a déjà résolues, les exposer ouvrirait un second
 *   chemin vers la même valeur (règle 1 du design system). Les primitives
 *   d'espacement, de rayon, de graisse et d'interlettrage, elles, n'ont pas de
 *   couche sémantique — `components.css` les consomme directement, le natif
 *   fait pareil.
 * - Rendu **déterministe** : pas d'horodatage, ordre du JSON préservé. Le
 *   fichier généré est versionné, un diff doit refléter un changement de
 *   design, rien d'autre.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveSource } from './source.mjs';

const OUTPUT = path.resolve(process.cwd(), 'src/theme/tokens.ts');

/* --------------------------------------------------------------------------
   Conversions
   -------------------------------------------------------------------------- */

const HEX = /^#[0-9a-f]{3,8}$/i;
const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]*\.?\d+)\s*)?\)$/i;
const COLOR_MIX =
  /^color-mix\(\s*in\s+srgb\s*,\s*(#[0-9a-f]{3,8})\s+([\d.]+)%\s*,\s*transparent\s*\)$/i;

/**
 * Rend une couleur consommable par React Native.
 *
 * `color-mix(… , transparent)` est un fondu vers le vide : il équivaut
 * exactement à appliquer le pourcentage en alpha, et c'est la seule forme de
 * `color-mix()` qu'on sait traduire sans écrire un moteur de couleur. Une autre
 * forme doit échouer plutôt que d'être approchée.
 */
function toColor(name, value) {
  if (HEX.test(value)) {
    return value.toLowerCase();
  }

  const rgba = value.match(RGBA);
  if (rgba) {
    const [, r, g, b, a] = rgba;
    // `.60` est une notation CSS valide que RN accepte, mais que personne ne
    // relit sans hésiter : on la normalise en `0.6`.
    return a === undefined
      ? `rgb(${Number(r)}, ${Number(g)}, ${Number(b)})`
      : `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${Number(a)})`;
  }

  const mix = value.match(COLOR_MIX);
  if (mix) {
    const [, hex, percent] = mix;
    const [r, g, b] = expandHex(name, hex);
    return `rgba(${r}, ${g}, ${b}, ${round(Number(percent) / 100)})`;
  }

  throw new Error(
    `${name} = « ${value} » : forme de couleur non traduisible en natif. ` +
      'Ajouter la conversion ici, ou revoir la valeur côté tokens.css.',
  );
}

function expandHex(name, hex) {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;

  if (full.length !== 6) {
    throw new Error(`${name} = « ${hex} » : hexadécimal à 6 chiffres attendu.`);
  }

  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * Réduit une pile de polices à sa première famille.
 *
 * Le web décline vers `system-ui` si le téléchargement échoue ; en natif la
 * police est embarquée dans l'APK, il n'y a rien vers quoi décliner. Le nom
 * retenu est la **famille**, pas le nom du fichier chargé : c'est
 * `src/theme/fonts.ts` qui associe famille + graisse à une police enregistrée.
 */
function toFamily(name, value) {
  const first = value
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');

  if (first === '') {
    throw new Error(`${name} = « ${value} » : pile de polices vide.`);
  }

  return first;
}

function toPx(name, value) {
  const match = value.match(/^(-?[\d.]+)px$/);
  if (!match) {
    throw new Error(`${name} = « ${value} » : longueur en px attendue.`);
  }
  return Number(match[1]);
}

/**
 * L'interlettrage est exposé en **em**, pas en points.
 *
 * `letterSpacing` est absolu en React Native : une valeur figée serait juste
 * pour une taille de police et fausse pour toutes les autres. La conversion se
 * fait donc au point d'usage, par `letterSpacing()` dans `typography.ts`.
 */
function toEm(name, value) {
  const match = value.match(/^(-?\.?[\d.]+)em$/);
  if (!match) {
    throw new Error(`${name} = « ${value} » : longueur en em attendue.`);
  }
  return Number(match[1]);
}

function toWeight(name, value) {
  if (!/^[1-9]00$/.test(value)) {
    throw new Error(`${name} = « ${value} » : graisse numérique attendue.`);
  }
  return `'${value}'`;
}

/** Rayons et ombres sont nuls par identité : on vérifie, on ne recopie pas. */
function assertZero(name, value) {
  if (value !== '0') {
    throw new Error(
      `${name} = « ${value} » : l'identité Presse n'a pas de rayon. ` +
        'Si le web en gagne un, décider ici ce qu’il devient en natif.',
    );
  }
  return 0;
}

function assertNone(name, value) {
  if (value !== 'none') {
    throw new Error(
      `${name} = « ${value} » : l'identité Presse n'a pas d'ombre — un élément ` +
        'flottant se détache par un contour. Décider ici ce que cette valeur devient.',
    );
  }
  return null;
}

/* --------------------------------------------------------------------------
   Répartition des tokens
   -------------------------------------------------------------------------- */

// Couche sémantique : tout doit être classé. Un préfixe inconnu est une
// nouveauté de design que le mobile n'a pas encore traduite — elle doit sortir
// au build, pas se perdre.
const SEMANTIC = [
  { prefix: '--color-', group: 'colors', convert: toColor },
  { prefix: '--font-', group: 'fontStacks', convert: toFamily },
  { prefix: '--shadow-', group: null, convert: assertNone },
];

// Couche primitive : seules ces familles sont émises, le reste est ignoré par
// construction (cf. l'en-tête).
const PRIMITIVE = [
  { prefix: '--kd-space-', group: 'space', convert: toPx },
  { prefix: '--kd-radius-', group: 'radius', convert: assertZero },
  { prefix: '--kd-weight-', group: 'weight', convert: toWeight },
  { prefix: '--kd-tracking-', group: 'tracking', convert: toEm },
];

function camel(key) {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function classify(entries, rules, { strict }) {
  const groups = new Map();

  for (const [name, value] of Object.entries(entries)) {
    const rule = rules.find((candidate) => name.startsWith(candidate.prefix));

    if (!rule) {
      if (strict) {
        throw new Error(
          `${name} : préfixe non pris en charge. Ajouter une règle de conversion ` +
            'dans tools/sync-tokens.mjs.',
        );
      }
      continue;
    }

    const converted = rule.convert(name, value);
    if (rule.group === null) {
      continue;
    }

    const key = camel(name.slice(rule.prefix.length));
    if (!groups.has(rule.group)) {
      groups.set(rule.group, new Map());
    }
    groups.get(rule.group).set(key, converted);
  }

  return groups;
}

function round(value) {
  return Number(value.toFixed(4));
}

/* --------------------------------------------------------------------------
   Émission
   -------------------------------------------------------------------------- */

function literal(value) {
  if (typeof value === 'number') {
    return String(value);
  }
  // `toWeight` rend déjà un littéral de chaîne : le réencadrer le doublerait.
  return String(value).startsWith("'") ? String(value) : `'${value}'`;
}

function block(name, entries, comment, tail = 'as const') {
  const lines = [...entries].map(([key, value]) => `  ${key}: ${literal(value)},`);

  return [comment, `export const ${name} = {`, ...lines, `} ${tail};`, ''].join('\n');
}

function render(groups) {
  const head = `/**
 * GÉNÉRÉ par \`npm run sync:tokens\` — NE JAMAIS ÉDITER À LA MAIN.
 *
 * Traduction native de \`design-tokens.json\`, lui-même projeté depuis
 * \`assets/styles/tokens.css\` (dépôt kadens). Toute évolution visuelle part de
 * cette feuille, puis se régénère ici.
 *
 * Les couleurs et les polices ne sont exposées que par leur nom **sémantique** :
 * jamais de couleur ni de police en dur dans un composant (règle 1 du design
 * system). L'échelle typographique, elle, n'est pas tokenisée côté web (le CSS
 * la porte en \`clamp()\`) : elle vit dans \`typography.ts\`.
 */
`;

  return [
    head,
    block(
      'light',
      groups.get('colors'),
      `/**
 * Couleurs sémantiques — jeu **clair**, celui du papier.
 *
 * C'est la forme de référence : \`ColorToken\` en dérive, et le jeu sombre est
 * tenu de porter exactement les mêmes clés.
 */`,
    ),
    block(
      'dark',
      groups.get('colorsDark'),
      `/**
 * Couleurs sémantiques — jeu **sombre**.
 *
 * \`satisfies ColorSet\` n'est pas décoratif : c'est le compilateur qui redit ici
 * l'invariant que \`app:tokens:export\` tient déjà côté serveur. Une clé de trop ou
 * en moins est une erreur de build, pas une couleur transparente sur un téléphone.
 */`,
      'as const satisfies ColorSet',
    ),
    block(
      'fontStacks',
      groups.get('fontStacks'),
      '/** Familles de polices. La graisse se choisit par `fontFamily()`, cf. fonts.ts. */',
    ),
    block('space', groups.get('space'), '/** Échelle d’espacement, base 4px. */'),
    block(
      'radius',
      groups.get('radius'),
      '/** Rayons — tous nuls. Les noms subsistent pour que les composants se lisent. */',
    ),
    block(
      'weight',
      groups.get('weight'),
      '/** Graisses disponibles dans les polices embarquées. */',
    ),
    block(
      'tracking',
      groups.get('tracking'),
      '/** Interlettrage en **em** : à convertir en points par `letterSpacing()`. */',
    ),
    `/** Les deux jeux, indexés par leur nom. \`contrast.test.ts\` les parcourt. */
export const palettes = { light, dark } as const;

export type ThemeName = keyof typeof palettes;
export type ColorToken = keyof typeof light;
/** Un jeu complet. Ce que reçoit une fabrique \`themed()\`. */
export type ColorSet = Readonly<Record<ColorToken, string>>;
export type SpaceToken = keyof typeof space;
export type FontStack = keyof typeof fontStacks;
export type Weight = (typeof weight)[keyof typeof weight];
`,
  ].join('\n');
}

/* --------------------------------------------------------------------------
   Programme
   -------------------------------------------------------------------------- */

async function main() {
  const source = resolveSource();
  const document = JSON.parse((await source.read('design-tokens.json')).toString('utf8'));

  if (!document.primitives || !document.semantic) {
    throw new Error(
      'design-tokens.json ne porte pas les deux couches attendues (primitives / semantic).',
    );
  }

  if (!document.themes?.light || !document.themes?.dark) {
    throw new Error(
      'design-tokens.json ne porte pas les deux jeux attendus (themes.light / themes.dark) : ' +
        'le serveur est-il à jour ?',
    );
  }

  const groups = new Map([
    ...classify(document.semantic, SEMANTIC, { strict: true }),
    ...classify(document.primitives, PRIMITIVE, { strict: false }),
  ]);

  for (const expected of ['colors', 'fontStacks', 'space', 'radius', 'weight', 'tracking']) {
    if (!groups.has(expected)) {
      throw new Error(`Aucun token « ${expected} » dans la source : génération abandonnée.`);
    }
  }

  groups.set('colorsDark', darkOf(document, groups.get('colors')));

  await writeFile(OUTPUT, render(groups), 'utf8');

  const counts = [...groups]
    .filter(([name]) => name !== 'colorsDark')
    .map(([name, entries]) => `${entries.size} ${name}`)
    .join(', ');

  console.log(`src/theme/tokens.ts régénéré depuis ${source.label} — ${counts} × 2 thèmes.`);
}

/**
 * Le jeu sombre, converti et **aligné sur les clés du jeu clair**.
 *
 * L'ordre vient du clair et non du JSON sombre : le bloc `[data-theme="dark"]`
 * du serveur groupe ses immobiles pour se relire comme une table de décisions,
 * ce qui est un bon ordre de lecture et un mauvais ordre de diff. Deux blocs
 * générés dans le même ordre se comparent ligne à ligne.
 *
 * Trois refus, dans l'esprit du fichier — le mobile ne fait jamais confiance à
 * ce qu'il reçoit :
 *
 * 1. une clé qui manque d'un côté ou de l'autre (le serveur l'assère déjà, mais
 *    un `design-tokens.json` peut arriver d'un serveur plus ancien) ;
 * 2. un jeu clair qui ne dirait pas la même chose que la couche `semantic` — le
 *    serveur publierait alors deux jeux clairs différents, et on ne saurait pas
 *    lequel croire ;
 * 3. deux jeux identiques, signe que le bloc sombre n'a pas été régénéré. Une
 *    app livrée avec un mode sombre qui ne change rien est pire qu'aucun mode
 *    sombre : personne ne saurait où chercher.
 */
function darkOf(document, light) {
  const converted = new Map();

  for (const [name, value] of Object.entries(document.themes.dark)) {
    converted.set(camel(name.slice('--color-'.length)), toColor(name, value));
  }

  const lightOfTheme = new Map();

  for (const [name, value] of Object.entries(document.themes.light)) {
    lightOfTheme.set(camel(name.slice('--color-'.length)), toColor(name, value));
  }

  const dark = new Map();

  for (const key of light.keys()) {
    if (!converted.has(key)) {
      throw new Error(`${key} n'existe pas dans le jeu sombre : le serveur est-il à jour ?`);
    }

    if (lightOfTheme.get(key) !== light.get(key)) {
      throw new Error(
        `${key} vaut ${light.get(key)} dans « semantic » et ${lightOfTheme.get(key)} dans ` +
          '« themes.light » : le serveur publie deux jeux clairs différents.',
      );
    }

    dark.set(key, converted.get(key));
  }

  const extra = [...converted.keys()].filter((key) => !dark.has(key));

  if (extra.length > 0) {
    throw new Error(
      `Le jeu sombre déclare des couleurs que le clair ignore : ${extra.join(', ')}.`,
    );
  }

  if ([...dark].every(([key, value]) => light.get(key) === value)) {
    throw new Error('Les deux jeux sont identiques : le bloc sombre n’a pas été régénéré.');
  }

  return dark;
}

main().catch((error) => {
  console.error(`sync:tokens — ${error.message}`);
  process.exitCode = 1;
});
