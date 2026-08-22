/**
 * Les icônes de l'app — jeu **Lucide**, figé en local (KL-37).
 *
 * Le dépôt web fige les siennes dans `assets/icons/lucide/` plutôt que de les
 * chercher sur le réseau, et pose la règle : toute nouvelle icône s'importe
 * localement (`php bin/console ux:icons:import lucide:<nom>`). Ce fichier est le
 * pendant natif de cette règle. Les tracés ci-dessous sont **recopiés tels
 * quels** depuis ces fichiers-là, clé comprise : un `git grep calendar-days`
 * dans les deux dépôts doit tomber sur le même dessin.
 *
 * Pourquoi des formes typées plutôt que des chaînes SVG : `react-native-svg` ne
 * sait pas parser un document, il rend des composants. Convertir les `rect` et
 * `circle` de Lucide en `d` de chemin les rendrait illisibles et non
 * comparables à la source — la seule chose qu'on ne peut pas se permettre pour
 * un fichier dont l'intérêt est justement d'être vérifiable ligne à ligne.
 *
 * Les attributs communs à tout Lucide (viewBox 24, trait de 2, bouts et
 * jointures ronds, aucun remplissage) sont portés une fois par `<Svg>`. Ne pas
 * les recopier par icône : c'est ce qui garantit qu'une icône ajoutée ressemble
 * aux autres.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Une primitive de dessin Lucide. Rien d'autre n'apparaît dans le jeu utilisé. */
type Shape =
  | { d: string }
  | { cx: number; cy: number; r: number }
  | { x: number; y: number; width: number; height: number; rx: number };

const ICONS = {
  /** Aujourd'hui. La même que « Calendrier » dans la barre du web. */
  'calendar-days': [
    { d: 'M8 2v4m8-4v4' },
    { x: 3, y: 4, width: 18, height: 18, rx: 2 },
    { d: 'M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01' },
  ],
  /** Historique. */
  history: [
    { d: 'M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8' },
    { d: 'M3 3v5h5m4-1v5l4 2' },
  ],
  /** Réglages. La même que « Paramètres » dans le menu de compte du web. */
  'settings-2': [{ d: 'M14 17H5M19 7h-9' }, { cx: 17, cy: 17, r: 3 }, { cx: 7, cy: 7, r: 3 }],
  /** Retour arrière. */
  'arrow-left': [{ d: 'm12 19l-7-7l7-7m7 7H5' }],
  /** Le repos automatique, actif. */
  timer: [{ d: 'M10 2h4m-2 12l3-3' }, { cx: 12, cy: 14, r: 8 }],
  /** Sortir de l'app : la page d'installation, ouverte dans le navigateur (KL-43). */
  'external-link': [
    { d: 'M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
  ],
  /**
   * La poignée de déplacement d'un exercice, en mode rangement (KL-52). Le même
   * dessin que le compositeur web, qui l'emploie déjà au même endroit.
   */
  'grip-vertical': [
    { cx: 9, cy: 12, r: 1 },
    { cx: 9, cy: 5, r: 1 },
    { cx: 9, cy: 19, r: 1 },
    { cx: 15, cy: 12, r: 1 },
    { cx: 15, cy: 5, r: 1 },
    { cx: 15, cy: 19, r: 1 },
  ],
  /** Le repos automatique, débranché. Barrée, comme tous les `*-off` de Lucide. */
  'timer-off': [
    {
      d: 'M10 2h4m-9.4 9a8 8 0 0 0 1.7 8.7a8 8 0 0 0 8.7 1.7m-7.6-14a8 8 0 0 1 10.3 1a8 8 0 0 1 .9 10.2M2 2l20 20M12 12v-2',
    },
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

export type IconProps = {
  name: IconName;
  /** Côté du carré, en points. 19 dans la barre basse, comme le web. */
  size?: number;
  /**
   * Toujours un token (règle 1). Passé en `stroke` : les tracés Lucide sont des
   * traits, pas des aplats — une icône « pleine » n'existe pas dans ce jeu.
   */
  color: string;
};

export function Icon({ name, size = 20, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // L'icône ne dit jamais rien de plus que le libellé à côté d'elle : elle
      // sort de l'arbre d'accessibilité, sinon TalkBack lit deux fois la même
      // entrée de navigation.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ICONS[name].map((shape, index) => {
        if ('d' in shape) {
          return <Path key={index} d={shape.d} />;
        }

        if ('r' in shape) {
          return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />;
        }

        return (
          <Rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        );
      })}
    </Svg>
  );
}
