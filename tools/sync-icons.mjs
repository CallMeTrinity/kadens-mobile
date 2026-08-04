/**
 * Récupère les visuels de l'app dans `assets/images/` (KL-37).
 *
 *   npm run sync:icons
 *   npm run sync:icons -- --source=../kadens/public
 *
 * Ils sont produits par `tools/build-pwa-icons.php` côté serveur et publiés dans
 * `public/pwa/android/` — ils ne servent jamais au web, exactement comme les
 * `.ttf` de `public/fonts/`. La raison est la même : la marque n'a qu'une
 * découpe. Le K est isolé des traits de vitesse **par composantes connexes**
 * (ils le chevauchent en abscisse, aucun recadrage rectangulaire ne les
 * séparerait), et refaire cette isolation ici en donnerait une seconde, à tenir
 * d'accord avec la première.
 *
 * Les fichiers sont **versionnés** dans ce dépôt : ils entrent dans le bundle et
 * dans `expo prebuild`, un build ne doit pas dépendre d'un serveur joignable.
 *
 * Ce qu'un fichier de moins casserait, écran par écran : l'icône du lanceur, sa
 * version thématisée d'Android 13, la silhouette du repos dans la barre de
 * statut (KL-31), l'écran de démarrage natif. Chaque nom est déclaré dans
 * `app.json` — les deux listes se tiennent l'une l'autre.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveSource } from './source.mjs';

const TARGET = path.resolve(process.cwd(), 'assets/images');

/**
 * `[ressource publiée, nom local]`. Les noms locaux sont ceux que `app.json`
 * déclare ; les renommer sans le mettre à jour donne un `expo prebuild` qui
 * échoue sur un chemin introuvable.
 *
 * Tous transparents sauf `icon.png` : sur Android la couleur de fond se déclare
 * (`adaptiveIcon.backgroundColor`, `expo-splash-screen.backgroundColor`) et se
 * compose à l'affichage. Un fond cuit dans l'image la recouvrirait.
 */
const IMAGES = [
  ['pwa/android/icon.png', 'icon.png'],
  ['pwa/android/adaptive-foreground.png', 'adaptive-foreground.png'],
  ['pwa/android/adaptive-monochrome.png', 'adaptive-monochrome.png'],
  ['pwa/android/notification.png', 'notification.png'],
  ['pwa/android/splash.png', 'splash.png'],
  // Le rendu web (`npm run web`) n'est vérifié nulle part, mais Expo exige le
  // fichier dès que `web.favicon` le déclare. Celui du site fait l'affaire.
  ['pwa/favicon-48.png', 'favicon.png'],
];

async function main() {
  const source = resolveSource();
  await mkdir(TARGET, { recursive: true });

  let total = 0;

  for (const [remote, local] of IMAGES) {
    const bytes = await source.read(remote);

    if (bytes.length === 0) {
      throw new Error(`${remote} est vide.`);
    }

    await writeFile(path.join(TARGET, local), bytes);
    total += bytes.length;
  }

  console.log(
    `${IMAGES.length} visuels écrits dans assets/images/ depuis ${source.label} — ` +
      `${Math.round(total / 1024)} Ko.`,
  );
}

main().catch((error) => {
  console.error(`sync:icons — ${error.message}`);
  process.exitCode = 1;
});
