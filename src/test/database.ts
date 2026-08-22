/**
 * La base locale, en test (KL-36).
 *
 * ## Le schéma vient des migrations, jamais d'une copie
 *
 * `applySchema()` rejoue `src/db/migrations/` — les **mêmes** fichiers que le
 * téléphone applique au démarrage. Un schéma recopié ici dériverait au premier
 * `npm run db:generate`, et les tests continueraient de passer sur une base que
 * l'app n'a plus. En prime, un test qui tourne prouve que les migrations
 * s'appliquent sur une base vierge.
 *
 * ## Pourquoi vider plutôt que rouvrir
 *
 * `db/client.ts` ouvre sa connexion **au chargement du module** et la garde :
 * c'est un choix documenté là-bas (le cache par nom de fichier d'`expo-sqlite`
 * rend une seconde ouverture illusoire). Il n'y a donc pas de connexion à
 * remplacer entre deux tests ; il y a des tables à vider, `sqlite_sequence`
 * compris — sans lui, l'`AUTOINCREMENT` de `mutation_queue` continuerait de
 * compter d'un test à l'autre et les rangs attendus deviendraient illisibles.
 *
 * Le `DELETE` sans `WHERE` que `@/db` proscrit est ici sans conséquence : ce
 * qu'il fait perdre est la notification de `sqlite3_update_hook`, dont dépendent
 * les vues vives — et aucune n'est montée hors de React.
 */

import { nativeDb } from '@/db';
import migrations from '@/db/migrations/migrations';

/**
 * Dans l'ordre inverse des dépendances, par prudence : les clés étrangères sont
 * désactivées le temps du vidage, mais l'ordre reste juste si elles ne
 * l'étaient pas.
 */
const TABLES = [
  'mutation_queue',
  'logged_set',
  'logged_exercise',
  'prescribed_snapshot',
  'session_layout',
  'scheduled_workout',
  'exercise_history',
  'exercise',
  'sync_state',
  'preference',
];

let schemaApplied = false;

/** Applique les migrations du dépôt. Sans effet au-delà du premier appel. */
export function applySchema(): void {
  if (schemaApplied) {
    return;
  }

  for (const sql of Object.values(migrations.migrations)) {
    // Drizzle sépare ses instructions par ce marqueur : `exec()` en avalerait
    // plusieurs d'un coup, mais une erreur ne dirait plus laquelle a échoué.
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();

      if (trimmed.length > 0) {
        nativeDb.execSync(trimmed);
      }
    }
  }

  schemaApplied = true;
}

/** Remet la base à l'état d'une installation neuve. À appeler avant chaque test. */
export function resetDatabase(): void {
  applySchema();

  nativeDb.execSync('PRAGMA foreign_keys = OFF');

  for (const table of TABLES) {
    nativeDb.execSync(`DELETE FROM ${table}`);
  }

  // Créée par SQLite dès qu'une table `AUTOINCREMENT` existe, donc toujours
  // présente ici : c'est elle qui porte le prochain rang de `mutation_queue`.
  nativeDb.execSync('DELETE FROM sqlite_sequence');
  nativeDb.execSync('PRAGMA foreign_keys = ON');
}
