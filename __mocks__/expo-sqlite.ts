/**
 * `expo-sqlite` sous Jest : un vrai SQLite, celui de Node (KL-36).
 *
 * ## Pourquoi un adaptateur plutôt qu'un bouchon
 *
 * Ce que les tests de ce dépôt ont à vérifier est **du SQLite** : une
 * transaction qui se replie, un `ON DELETE CASCADE` qui emporte les séries, un
 * `AUTOINCREMENT` qui ne réattribue pas un rang libéré, un `ON CONFLICT DO
 * UPDATE` qui remplace au lieu de doubler. Un faux en mémoire qui rendrait des
 * lignes toutes prêtes ne dirait rien de tout ça — il dirait seulement que le
 * faux est d'accord avec lui-même.
 *
 * `node:sqlite` est la même bibliothèque que celle embarquée par `expo-sqlite`,
 * sans module natif à compiler. Il n'y a donc rien à simuler : il ne reste qu'à
 * traduire une API dans l'autre.
 *
 * ## Ce que Drizzle attend, et rien de plus
 *
 * Le pilote `drizzle-orm/expo-sqlite` n'appelle que quatre choses :
 * `prepareSync(sql)`, puis sur la requête préparée `executeSync(params)` et
 * `executeForRawResultSync(params)`, dont il lit `changes`, `lastInsertRowId`,
 * `getAllSync()` et `getFirstSync()`. `execSync()` s'y ajoute pour les `PRAGMA`
 * que `db/client.ts` pose à l'ouverture. Le reste de la surface d'`expo-sqlite`
 * n'est pas traduit : ce qui n'est pas appelé n'a pas à exister.
 *
 * ## Le point qui n'est pas évident : une exécution, pas deux
 *
 * `executeSync()` doit rendre **à la fois** le compte de lignes modifiées et les
 * lignes lues, là où `node:sqlite` sépare `run()` et `all()`. Les appeler tous
 * les deux exécuterait la requête deux fois — un `INSERT` doublé, en silence.
 * D'où le tri par `columns()` : une requête qui déclare des colonnes rend des
 * lignes (`SELECT`, `INSERT … RETURNING`), les autres modifient. Une seule des
 * deux branches s'exécute.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

/** Ce qu'`expo-sqlite` accepte de lier à un paramètre. */
type BindValue = string | number | boolean | bigint | null | undefined | Uint8Array;

/** Ce que `node:sqlite` accepte, qui est plus étroit : pas de booléen. */
type NativeBindValue = string | number | bigint | null | Uint8Array;

/**
 * Le booléen est converti, pas refusé : `expo-sqlite` l'accepte
 * (`SQLiteBindValue`) et le convertit lui-même. Le refuser ici ferait échouer
 * en test une écriture qui passe sur le téléphone.
 */
function bind(value: BindValue): NativeBindValue {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  return value === undefined ? null : value;
}

/**
 * Le résultat d'une exécution, dans la forme qu'`expo-sqlite` rend.
 *
 * Les lignes sont recopiées en objets ordinaires : `node:sqlite` les rend avec
 * un prototype nul, ce qui suffirait au code mais ferait échouer un
 * `toStrictEqual` sur une différence qui n'existe pas sur le téléphone.
 */
function result(rows: unknown[], changes: number, lastInsertRowId: number) {
  return {
    changes,
    lastInsertRowId,
    getAllSync: () => rows,
    getFirstSync: () => rows[0] ?? null,
  };
}

function execute(statement: StatementSync, params: BindValue[], raw: boolean) {
  const values = params.map(bind);

  // Aucune colonne déclarée : la requête modifie, elle ne rend rien. C'est le
  // seul moyen de choisir entre `run()` et `all()` sans exécuter deux fois.
  if (statement.columns().length === 0) {
    const { changes, lastInsertRowid } = statement.run(...values);

    return result([], Number(changes), Number(lastInsertRowid));
  }

  statement.setReturnArrays(raw);

  const rows = statement.all(...values);

  return result(raw ? rows : rows.map((row) => ({ ...row })), 0, 0);
}

class TestStatement {
  constructor(private readonly statement: StatementSync) {}

  executeSync(params: BindValue[] = []) {
    return execute(this.statement, params, false);
  }

  executeForRawResultSync(params: BindValue[] = []) {
    return execute(this.statement, params, true);
  }

  finalizeSync(): void {
    // `node:sqlite` libère ses requêtes préparées au ramasse-miettes.
  }
}

class TestDatabase {
  private readonly database = new DatabaseSync(':memory:');

  constructor(readonly databaseName: string) {}

  execSync(source: string): void {
    this.database.exec(source);
  }

  prepareSync(source: string): TestStatement {
    return new TestStatement(this.database.prepare(source));
  }

  closeSync(): void {
    this.database.close();
  }
}

/**
 * Le cache par nom de fichier existe aussi dans `expo-sqlite`, et `db/client.ts`
 * s'appuie dessus : rouvrir la même base rend **la même** connexion. Le
 * reproduire évite qu'un test découvre une base vide là où l'app en verrait une
 * pleine.
 */
const opened = new Map<string, TestDatabase>();

export function openDatabaseSync(databaseName: string): TestDatabase {
  const existing = opened.get(databaseName);

  if (existing) {
    return existing;
  }

  const database = new TestDatabase(databaseName);

  opened.set(databaseName, database);

  return database;
}

export function deleteDatabaseSync(databaseName: string): void {
  opened.get(databaseName)?.closeSync();
  opened.delete(databaseName);
}
