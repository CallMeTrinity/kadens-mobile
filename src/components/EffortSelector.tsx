/**
 * EffortSelector — la difficulté d'une séance, de 1 à 10, en escalier.
 *
 * Dix marches qui montent et rougissent en montant : la difficulté **est** une
 * intensité (règle 2), et c'est le seul endroit du ressenti qui a droit au
 * rouge. Le chiffre retenu s'écrit en grand au-dessus, avec son palier Garmin
 * (« Difficile ») ; l'escalier dit où il se place sur l'échelle.
 *
 * ## Dix colonnes sur une ligne, et ce que ça coûte
 *
 * L'ancienne échelle passait sur deux rangées de cinq, parce que dix cases sur
 * une ligne de téléphone tombent sous le plancher tactile **en largeur**. Un
 * escalier ne se coupe pas en deux sans cesser d'en être un. Chaque colonne
 * compense donc en hauteur : la marche et son chiffre forment **une seule**
 * cible d'une centaine de points de haut, pour une trentaine de large sur un
 * écran de 360. Une marche voisine attrapée par erreur se voit tout de suite —
 * le grand chiffre change — et se corrige d'un appui.
 *
 * ## La couleur des marches est dérivée, pas inventée
 *
 * La rampe va de `primaryTrack` à `primary` sur les sept premières marches, puis
 * de `primary` à `primaryOnTint` sur les trois dernières. Ce sont trois tokens,
 * interpolés ; aucune teinte n'est écrite ici. En sombre, `primaryOnTint` est
 * plus **clair** que `primary` : l'escalier monte alors vers le clair au lieu de
 * foncer, et c'est voulu — sur un fond nuit, c'est le clair qui pèse.
 *
 * Pas d'état « aucune valeur » à taper, comme pour la forme : l'échelle part
 * vide et ne se vide plus — retirer une note est un geste du web.
 */

import { Pressable, Text, View } from 'react-native';

import { space, text, themed, useStyles, variants, type ColorSet } from '@/theme';

export type EffortSelectorProps = {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  /** Le palier d'un cran (« Difficile »), écrit à côté du chiffre et lu par TalkBack. */
  describe: (value: number) => string | null;
  /** Les bornes, écrites sous l'escalier. */
  ends: [string, string];
  testID?: string;
};

const MAX = 10;
const STEPS = Array.from({ length: MAX }, (_, i) => i + 1);
/** La hauteur de l'escalier, et celle de sa première et de sa dernière marche. */
const STAIRS_HEIGHT = 88;
const FIRST_STEP = 18;
const STEP_RISE = 7.4;

/** Interpole deux couleurs `#rrggbb`. `t` va de 0 (tout `from`) à 1 (tout `to`). */
function mix(from: string, to: string, t: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = channels(from);
  const b = channels(to);

  return `#${a
    .map((value, i) =>
      Math.round(value + ((b[i] ?? value) - value) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** La couleur de la marche `step`, dans un jeu de couleurs. */
function heat(c: ColorSet, step: number): string {
  return step <= 7
    ? mix(c.primaryTrack, c.primary, (step - 1) / 6)
    : mix(c.primary, c.primaryOnTint, (step - 7) / 3);
}

/**
 * Les dix marches allumées et leurs hauteurs, construites une fois par jeu au
 * chargement — jamais au rendu, comme toutes les feuilles de l'app.
 */
const LIT = variants((c) =>
  STEPS.map((step) => ({ backgroundColor: heat(c, step), borderColor: heat(c, step) })),
);
const HEIGHTS = STEPS.map((step) => ({ height: FIRST_STEP + (step - 1) * STEP_RISE }));

export function EffortSelector({
  label,
  value,
  onChange,
  describe,
  ends,
  testID,
}: EffortSelectorProps) {
  const styles = useStyles(sheets);
  const lit = useStyles(LIT);
  const tier = value === null ? null : describe(value);

  return (
    <View testID={testID} style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.label}>
        {label}
      </Text>

      {/* Le chiffre retenu, en grand : c'est lui qu'on vérifie d'un coup d'œil
          après l'appui, et c'est lui qui trahit une marche voisine. */}
      <View style={styles.readout}>
        <Text style={styles.value}>{value ?? '—'}</Text>
        <Text style={styles.scale}>/ {MAX}</Text>
        <View style={styles.spacer} />
        {tier !== null ? <Text style={styles.tier}>{tier}</Text> : null}
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.stairs}>
        {STEPS.map((step) => {
          const active = step === value;
          const on = value !== null && step <= value;

          return (
            <Pressable
              key={step}
              testID={testID ? `${testID}-${step}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${step} sur ${MAX}${describe(step) ? `, ${describe(step)}` : ''}`}
              onPress={() => onChange(step)}
              style={styles.column}
            >
              <View style={styles.riser}>
                <View
                  style={[
                    styles.step,
                    HEIGHTS[step - 1],
                    on ? lit[step - 1] : styles.stepOff,
                    active && styles.stepActive,
                  ]}
                />
              </View>
              <Text style={[styles.number, active && styles.numberActive]}>{step}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.ends}>
        <Text style={styles.end}>{ends[0]}</Text>
        <Text style={styles.end}>{ends[1]}</Text>
      </View>
    </View>
  );
}

const sheets = themed((c) => ({
  wrap: { gap: space[4] },
  label: { ...text.sectionTitle, color: c.text },
  spacer: { flex: 1 },
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  value: { ...text.kpi, color: c.text },
  scale: { ...text.numericMinor, color: c.textSecondary },
  // Le palier est un libellé de structure, pas du saisi : condensé capitales,
  // en rouge qui écrit (`primaryOnTint`), comme tout rouge posé sur une surface.
  tier: { ...text.sectionTitle, color: c.primaryOnTint },
  stairs: { flexDirection: 'row', gap: space[1] },
  // Une colonne = une cible : la marche **et** son chiffre (en-tête, « ce que ça
  // coûte »). Pas de vide mort entre la marche et le chiffre.
  column: { flex: 1, alignItems: 'stretch', gap: space[4] },
  riser: { height: STAIRS_HEIGHT, justifyContent: 'flex-end' },
  step: { borderWidth: 1 },
  stepOff: { backgroundColor: c.track, borderColor: c.track },
  // Le filet d'encre désigne la marche retenue parmi les marches allumées, qui
  // sont de la même famille de rouge.
  stepActive: { borderColor: c.text },
  // `textSecondary` et non `textSoft` : ces chiffres sont posés sur le papier
  // de la page, où l'encre douce tombe sous AA (`contrast.test.ts`).
  number: { ...text.eyebrow, color: c.textSecondary, textAlign: 'center' },
  numberActive: { color: c.text },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  end: { ...text.caption, color: c.textSecondary },
}));
