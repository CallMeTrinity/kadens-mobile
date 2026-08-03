import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

/**
 * La connexion à la base locale, ouverte une fois pour toute la durée de vie de
 * l'app (KL-24).
 *
 * ## Une seule connexion, au chargement du module
 *
 * `openDatabaseSync` garde ses connexions en cache par nom de fichier : rouvrir
 * plus tard avec d'autres options rendrait **la même** connexion, avec les
 * options de la première — un piège silencieux. Ouvrir ici, une fois, avec les
 * options définitives, ferme la question.
 *
 * ## Les deux `PRAGMA`, et pourquoi ils sont posés à l'ouverture
 *
 * - **`journal_mode = WAL`** : une écriture ne bloque plus les lectures. C'est ce
 *   qui permet à un push de synchronisation de tourner pendant qu'un écran lit la
 *   séance en cours, sans que l'interface se fige — et « la synchronisation ne
 *   bloque jamais l'interface » est une exigence de KL-27, pas un confort. Le
 *   mode est persistant, mais il se pose quand même à chaque ouverture : c'est
 *   une ligne, et elle rend le fichier indépendant de la façon dont il a été créé.
 * - **`foreign_keys = ON`** : SQLite désactive les clés étrangères **par défaut**,
 *   et par connexion. Sans ce pragma, les `ON DELETE CASCADE` du schéma seraient
 *   décoratifs : supprimer une séance datée hors fenêtre laisserait son réalisé
 *   orphelin, invisible et jamais poussé. Le geste le plus fréquent de la synchro
 *   deviendrait une fuite de données silencieuse.
 *
 * ## `enableChangeListener`
 *
 * Activé dès maintenant parce qu'il ne se rattrape pas : la connexion est en
 * cache (voir plus haut), l'activer plus tard demanderait un `useNewConnection`,
 * donc deux connexions sur le même fichier. Il est ce qui rendra `useLiveQuery`
 * utilisable aux écrans de séance (KL-29), où le réalisé s'écrit sous l'œil de
 * celui qui le lit.
 *
 * Sa limite est à connaître avant de s'y fier : le signal vient de
 * `sqlite3_update_hook`, que SQLite **n'appelle pas** quand une table est vidée
 * par un `DELETE` sans clause `WHERE` (optimisation « truncate »). Une vue vive
 * y resterait figée sans rien signaler. Détail et parade dans `wipe()`
 * (`seed.ts`).
 *
 * ## Le web
 *
 * L'app cible Android. Le bundle web sert de vérification du bundler (`npx expo
 * export -p web`), pas de cible : `expo-sqlite` y suppose un runtime WASM et des
 * en-têtes serveur qu'on ne fournit pas. Ce module se charge, il ne se lance pas.
 */

/** Le fichier de la base, sous le répertoire de documents de l'app. */
export const DATABASE_NAME = 'kadens.db';

const nativeDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

nativeDb.execSync('PRAGMA journal_mode = WAL');
nativeDb.execSync('PRAGMA foreign_keys = ON');

/**
 * L'instance Drizzle. Un écran ou un service importe **celle-ci**, jamais
 * `nativeDb` : le SQL écrit à la main contournerait les types du schéma.
 */
export const db = drizzle(nativeDb, { schema });

export type Database = typeof db;

/**
 * Le rappel que reçoit `db.transaction()`. Extrait du type de Drizzle plutôt que
 * réécrit : il change avec la version du pilote, et une copie divergerait en
 * silence.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Ce qui sait écrire : la base, ou une transaction en cours.
 *
 * Ce type existe pour une raison précise, posée par le moteur de synchronisation
 * (KL-27) : écrire une série et empiler la mutation qui la poussera doivent être
 * **atomiques**. L'app tuée entre les deux laisserait un réalisé que rien ne
 * signale comme non poussé — et le pull suivant, qui remplace la fenêtre,
 * l'effacerait sans un mot (il n'y a pas de drapeau « modifié localement », c'est
 * la file qui porte ce fait).
 *
 * D'où la forme de tout ce qui écrit dans `src/sync` : des fonctions
 * **synchrones** qui prennent l'exécuteur en argument, appelables telles quelles
 * depuis une transaction de l'appelant. Le pilote `expo-sqlite` étant synchrone,
 * ça ne coûte rien.
 */
export type Writer = Database | Transaction;

/**
 * La connexion brute, réservée à ce que Drizzle ne fait pas : les `PRAGMA`, et
 * le branchement de l'outil de débogage Drizzle sur un build de développement.
 */
export { nativeDb };
