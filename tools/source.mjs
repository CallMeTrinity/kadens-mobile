/**
 * Résolution de la source des ressources de design publiées par le serveur.
 *
 * Les scripts `sync:*` lisent tous des fichiers servis par `public/` côté
 * Symfony (`design-tokens.json`, `fonts/*.ttf`). La source est donc une
 * **racine publique**, jamais un fichier : c'est ce qui permet aux deux scripts
 * de partager la même résolution et le même argument.
 *
 *   --source=https://kadens.antoninpamart.fr   (défaut)
 *   --source=../kadens/public                  (dépôt voisin, en développement)
 *
 * Un chemin local est le chemin normal tant que la version en ligne n'a pas été
 * déployée : le générateur doit pouvoir tourner sur ce qu'on vient d'écrire.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SOURCE = 'https://kadens.antoninpamart.fr';

/** Extrait `--source=…` de la ligne de commande, sinon retient le défaut. */
export function resolveSource(argv = process.argv.slice(2)) {
  const flag = argv.find((arg) => arg.startsWith('--source='));
  const raw = flag ? flag.slice('--source='.length) : DEFAULT_SOURCE;

  if (raw === '') {
    throw new Error('--source= est vide. Attendu : une URL ou un chemin vers un dossier public/.');
  }

  const remote = /^https?:\/\//.test(raw);

  return {
    label: raw,
    remote,

    /**
     * Lit une ressource relative à la racine publique et rend son contenu brut.
     * Toute erreur est traduite en message actionnable : un 404 sur la prod veut
     * presque toujours dire « le déploiement n'a pas encore la ressource », et
     * le repli est le dépôt voisin.
     */
    async read(relative) {
      if (!remote) {
        const file = path.resolve(process.cwd(), raw, relative);
        try {
          return await readFile(file);
        } catch (error) {
          throw new Error(`Lecture impossible de ${file} : ${error.message}`);
        }
      }

      const url = new URL(relative, raw.endsWith('/') ? raw : `${raw}/`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `${url} rend ${response.status}. Si le serveur n'est pas encore déployé, ` +
            'générer depuis le dépôt voisin : --source=../kadens/public',
        );
      }

      return Buffer.from(await response.arrayBuffer());
    },
  };
}
