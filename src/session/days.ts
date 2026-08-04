/**
 * Les jours de l'écran « Aujourd'hui » (KL-28).
 *
 * Deux choses vivent ici, et elles n'ont rien de décoratif :
 *
 * 1. **L'arithmétique de calendrier**, qui se fait sur des `Date` locales puis
 *    repasse par `localDate()` — jamais sur la chaîne `AAAA-MM-JJ` par
 *    découpage. Un `-2` posé sur le quantième traverse les fins de mois, les
 *    changements d'année et les heures d'été sans qu'on ait à y penser ; une
 *    soustraction de chaînes non.
 * 2. **Les libellés français, écrits à la main.** Pas d'`Intl` : la présence
 *    d'ICU dans Hermes dépend de la variante embarquée, et un `toLocaleDateString`
 *    qui retombe silencieusement sur l'anglais donnerait « Tuesday » au milieu
 *    d'une identité qui n'a qu'une langue. Sept noms de jours et douze de mois
 *    coûtent moins que cette incertitude, et l'app n'a aucune i18n prévue.
 */

import { localDate } from '@/db';

/**
 * Combien de jours de part et d'autre. Le ticket dit J-2 → J+2 : deux jours
 * pour rattraper la veille et l'avant-veille, deux pour voir ce qui vient.
 * Au-delà, ce n'est plus « Aujourd'hui », c'est un calendrier — et le calendrier
 * reste sur le web.
 */
export const DAY_REACH = 2;

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const WEEKDAYS_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Un jour de la bande, tel que l'écran le peint. */
export interface DayCell {
  /** `AAAA-MM-JJ`, la clé de lecture en base. */
  date: string;
  /** Écart en jours par rapport à aujourd'hui : -2 à +2. */
  offset: number;
  /** « lun », « mar »… Le composant met les capitales, pas la donnée. */
  weekday: string;
  /** Le quantième, sans zéro de tête : « 4 ». */
  dayOfMonth: string;
}

/** Convertit une date de calendrier en `Date` locale, à midi. */
function parse(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);

  // Midi, et pas minuit : un décalage d'heure d'été appliqué à minuit peut
  // basculer la date d'un jour. À midi, aucune transition connue ne le fait.
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** La date de calendrier située `days` jours après `date` (avant, si négatif). */
export function shiftDate(date: string, days: number): string {
  const shifted = parse(date);
  shifted.setDate(shifted.getDate() + days);

  return localDate(shifted);
}

/** L'écart en jours entre deux dates de calendrier. Positif si `date` est après `from`. */
export function dayOffset(date: string, from: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((parse(date).getTime() - parse(from).getTime()) / millisecondsPerDay);
}

/** La bande de jours centrée sur `today`, de J-2 à J+2. */
export function dayWindow(today: string): DayCell[] {
  const cells: DayCell[] = [];

  for (let offset = -DAY_REACH; offset <= DAY_REACH; offset += 1) {
    const date = shiftDate(today, offset);
    const at = parse(date);

    cells.push({
      date,
      offset,
      weekday: WEEKDAYS_SHORT[at.getDay()],
      dayOfMonth: `${at.getDate()}`,
    });
  }

  return cells;
}

/**
 * Le titre de l'écran pour un jour donné.
 *
 * « Hier » et « Demain » plutôt qu'une date : c'est ce qu'on se dit en pensant à
 * la séance qu'on n'a pas faite. Au-delà, le jour de la semaine suffit — on ne
 * va jamais plus loin que deux jours.
 */
export function dayTitle(date: string, today: string): string {
  switch (dayOffset(date, today)) {
    case 0:
      return "Aujourd'hui";
    case -1:
      return 'Hier';
    case 1:
      return 'Demain';
    default: {
      const at = parse(date);

      return WEEKDAYS[at.getDay()];
    }
  }
}

/** « mardi 4 août », en toutes lettres. Sert de sur-titre et de titre par défaut. */
export function longDate(date: string): string {
  const at = parse(date);

  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** « 4 août ». Le jour sans son nom, pour un titre de séance libre. */
export function shortDate(date: string): string {
  const at = parse(date);

  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}
