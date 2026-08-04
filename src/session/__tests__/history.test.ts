/**
 * L'historique (KL-37), vérifié sur ce qui l'y fait entrer.
 *
 * L'écran ne montre pas « le passé » mais **ce qui s'est passé** : une séance
 * clôturée sur le téléphone, ou tranchée par le serveur. La nuance ne se voit
 * pas à l'œil sur un jeu de données réel — il faut une journée d'avant-hier
 * restée intacte pour la faire apparaître — d'où ces contrôles, qui la figent.
 *
 * Le décompte de séries est vérifié dans la foulée parce qu'il vient d'une
 * requête **jumelle** de celle du jour (`loggedSetCountsAllQuery`), à laquelle
 * il ne reste aucun filtre de date pour rattraper une dérive.
 */

import {
  beginWorkout,
  checkSet,
  closeWorkout,
  loggedSetCountsAllQuery,
  pastWorkoutsQuery,
  setExerciseState,
} from '@/session';
import { resetDatabase } from '@/test/database';
import {
  dayFromNow,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { exerciseAt, nextLine } from '@/test/program';

const CLOSED = '01890000-0000-7000-8000-0000000003a1';
const MISSED = '01890000-0000-7000-8000-0000000003a2';
const UNTOUCHED = '01890000-0000-7000-8000-0000000003a3';
const AHEAD = '01890000-0000-7000-8000-0000000003a4';

beforeEach(() => {
  resetDatabase();
});

describe('pastWorkoutsQuery', () => {
  it('retient ce qui a eu lieu, laisse dehors ce qui n’a rien donné', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(MISSED, { date: dayFromNow(-4), status: 'missed' }),
        // Avant-hier, jamais ouverte, jamais tranchée : un trou, pas de
        // l'historique. La bande de jours de « Aujourd'hui » la montre déjà.
        scheduledWorkoutPayload(UNTOUCHED, { date: dayFromNow(-2) }),
        scheduledWorkoutPayload(AHEAD, { date: dayFromNow(3) }),
        scheduledWorkoutPayload(CLOSED, { date: dayFromNow(-1) }),
      ],
    });

    beginWorkout(CLOSED);
    closeWorkout(CLOSED, '');

    // Du plus récent au plus ancien : c'est l'ordre dans lequel on relit une
    // séance, et il ne doit pas être celui que SQLite veut bien rendre.
    expect(
      pastWorkoutsQuery()
        .all()
        .map((row) => row.uuid),
    ).toEqual([CLOSED, MISSED]);
  });

  it('compte les séries consignées, sauf celles d’un exercice sauté', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(CLOSED, { date: dayFromNow(-1) })] });
    beginWorkout(CLOSED);

    const exercise = exerciseAt(CLOSED);

    checkSet(CLOSED, exercise, nextLine(exercise));
    checkSet(CLOSED, exerciseAt(CLOSED), nextLine(exerciseAt(CLOSED)));

    expect(loggedSetCountsAllQuery().all()).toEqual([{ uuid: CLOSED, sets: 2 }]);

    // Sauter l'exercice ne supprime pas ses séries — elles ont eu lieu — mais il
    // sort du décompte : la carte annoncerait deux séries pour une séance dont
    // rien n'a été retenu.
    setExerciseState(CLOSED, exerciseAt(CLOSED), { skipped: true, notes: 'Machine occupée' });

    expect(loggedSetCountsAllQuery().all()).toEqual([]);
  });
});
