import { eq } from 'drizzle-orm';

import { db } from './client';
import { PREFERENCE_ID, preference, type PreferenceRow } from './schema';

/**
 * L'accès à la ligne unique de `preference` (KL-31).
 *
 * Même patron que `syncState.ts`, et pour les mêmes raisons : le « une seule
 * ligne » est un invariant tenu par la base (`CHECK (id = 1)`), encore faut-il
 * que personne n'écrive un `INSERT` concurrent ailleurs. Tout passe donc par ici,
 * et l'`onConflictDoUpdate` rend l'écriture indifférente à l'existence préalable
 * de la ligne — il n'y a jamais d'étape « initialiser les réglages » à ne pas
 * oublier.
 *
 * ## La lecture est synchrone, contrairement à celle de `sync_state`
 *
 * Elle est appelée au moment où l'on démarre un repos, c'est-à-dire dans le geste
 * de cocher une série : demander une lecture asynchrone y ferait apparaître le
 * décompte une frame après le reste, et surtout obligerait tout l'appel à devenir
 * `async` — alors que le pilote d'`expo-sqlite` est synchrone et que `.get()`
 * rend la ligne sans attendre. `getSyncState()` est `async` par habitude, pas par
 * nécessité ; il n'y a pas lieu de recopier ça ici.
 */

/**
 * Les valeurs par défaut, dupliquées ici **exprès**.
 *
 * La base porte déjà ces défauts en colonne, mais ils n'existent qu'à
 * l'insertion : tant que personne n'a rien réglé, il n'y a aucune ligne du tout.
 * Un objet neutre valait mieux qu'un `null` que chaque appelant aurait complété à
 * sa façon.
 */
export const DEFAULT_PREFERENCES: Omit<PreferenceRow, 'id'> = {
  restSeconds: 90,
  vibrate: true,
  autoRest: true,
};

/** Les réglages, ou leurs valeurs par défaut tant que rien n'a été touché. */
export function getPreferences(): Omit<PreferenceRow, 'id'> {
  const row = db.select().from(preference).where(eq(preference.id, PREFERENCE_ID)).get();

  return row
    ? { restSeconds: row.restSeconds, vibrate: row.vibrate, autoRest: row.autoRest }
    : DEFAULT_PREFERENCES;
}

/**
 * Écrit tout ou partie des réglages. Les champs absents de `patch` ne sont pas
 * touchés — désactiver la vibration n'a pas à connaître la durée de repos.
 *
 * L'insertion part des **défauts** complétés par le patch : sans ça, la première
 * écriture d'un seul champ créerait la ligne avec les défauts de colonne pour les
 * autres, ce qui est vrai aujourd'hui mais cesserait de l'être le jour où un
 * défaut change ici sans migration.
 */
export function patchPreferences(patch: Partial<Omit<PreferenceRow, 'id'>>): void {
  if (Object.keys(patch).length === 0) {
    return;
  }

  db.insert(preference)
    .values({ id: PREFERENCE_ID, ...DEFAULT_PREFERENCES, ...patch })
    .onConflictDoUpdate({ target: preference.id, set: patch })
    .run();
}
