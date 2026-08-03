/**
 * Récupère les polices de l'identité Presse dans `assets/fonts/`.
 *
 *   npm run sync:fonts
 *   npm run sync:fonts -- --source=../kadens/public
 *
 * Les `.ttf` sont produits par `tools/fetch-fonts.sh` côté serveur et publiés
 * dans `public/fonts/` — ils ne servent jamais au web (qui charge des `woff2`
 * via AssetMapper), ils existent pour ce dépôt : `expo-font` ne lit pas le
 * woff2. Même raisonnement que les visuels, qui viennent de `public/pwa/` :
 * une police régénérée à la main ici serait une seconde source pour une
 * identité déjà générée.
 *
 * Les fichiers sont **versionnés** dans ce dépôt : ils entrent dans le bundle,
 * et un build ne doit pas dépendre d'un serveur joignable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveSource } from './source.mjs';

const TARGET = path.resolve(process.cwd(), 'assets/fonts');

/**
 * Familles et graisses embarquées, à tenir d'accord avec `src/theme/fonts.ts`
 * (qui les `require()` une par une) et avec le tableau `FAMILIES` de
 * `tools/fetch-fonts.sh` côté serveur, seule autorité sur ce qui est publié.
 * Une graisse absente du serveur échoue la commande ; une graisse téléchargée
 * mais non requise reste simplement hors du bundle.
 */
const FONTS = [
  { slug: 'barlow', weights: [400, 500, 600, 700] },
  { slug: 'barlow-condensed', weights: [500, 600, 700, 800] },
  { slug: 'ibm-plex-mono', weights: [400, 500, 600] },
];

async function main() {
  const source = resolveSource();
  await mkdir(TARGET, { recursive: true });

  let total = 0;

  for (const { slug, weights } of FONTS) {
    for (const weight of weights) {
      const file = `${slug}-${weight}.ttf`;
      const bytes = await source.read(`fonts/${file}`);

      if (bytes.length === 0) {
        throw new Error(`fonts/${file} est vide.`);
      }

      await writeFile(path.join(TARGET, file), bytes);
      total += bytes.length;
    }
  }

  const count = FONTS.reduce((sum, family) => sum + family.weights.length, 0);
  console.log(
    `${count} polices écrites dans assets/fonts/ depuis ${source.label} — ` +
      `${Math.round(total / 1024)} Ko.`,
  );
}

main().catch((error) => {
  console.error(`sync:fonts — ${error.message}`);
  process.exitCode = 1;
});
