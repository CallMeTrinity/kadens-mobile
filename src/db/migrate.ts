import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import { db } from './client';
import migrations from './migrations/migrations';

/**
 * Applique les migrations locales au démarrage, et rend l'état de l'opération.
 *
 * ## Pourquoi ça passe par un hook, et pas par un `onInit`
 *
 * `useMigrations` tient le journal de Drizzle (`__drizzle_migrations`) : chaque
 * migration ne s'exécute **qu'une fois**, sur un téléphone comme sur un autre,
 * quel que soit le point de départ. C'est ce qui rend les migrations
 * « rejouables » au sens du ticket — pas qu'on puisse les relancer, mais qu'une
 * base à jour, une base neuve et une base restée trois versions en arrière
 * convergent toutes vers le même schéma sans qu'on ait à savoir laquelle on a
 * sous la main.
 *
 * ## Ce que l'appelant doit en faire
 *
 * Ne **rien rendre** tant que `success` est faux, et rendre l'erreur en clair si
 * elle sort. Un écran qui s'afficherait pendant la migration lirait des tables
 * qui n'existent pas encore ; un écran qui masquerait l'échec laisserait l'app
 * tourner sur une base dont on ne sait plus ce qu'elle contient — et c'est la
 * base qui porte le réalisé pas encore poussé.
 */
export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  return useMigrations(db, migrations);
}
