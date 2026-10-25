/**
 * ScaleSelector — une échelle notée de 1 à `max`, une case par cran.
 *
 * Fait pour le ressenti de fin de séance (forme sur 5, difficulté sur 10), et
 * pour la main qui le remplit : debout, en sueur, une seule main libre. D'où
 * des cases **à largeur égale** au plancher tactile, jamais un curseur — un
 * curseur se règle, une case se tape, et la valeur choisie ne bouge pas sous un
 * pouce qui glisse. Au-delà de cinq crans, l'échelle passe sur deux rangées de
 * cinq : dix cases sur une ligne de téléphone tombent sous le plancher.
 *
 * ## La sélection s'inverse, et seule la difficulté rougit
 *
 * Même code que `FilterChip` et la bande de jours : la case retenue passe à
 * l'encre. `tone="primary"` la passe au rouge plein — réservé à une échelle
 * d'**intensité** (règle 2), la difficulté ; la forme n'en est pas une.
 *
 * Le libellé du cran choisi s'écrit sous l'échelle (« 7 · Difficile ») : le
 * chiffre seul ne dit pas ce qu'il vaut, et dix libellés dans dix cases ne
 * tiendraient pas. TalkBack lit chaque case avec le sien (`describe`).
 *
 * Pas d'état « aucune valeur » à taper : l'échelle part vide (`value = null`) et
 * ne se vide plus — retirer une note est un geste du web (`rating.ts`).
 */

import { Pressable, Text, View } from 'react-native';

import { layout, space, text, themed, useStyles } from '@/theme';

export type ScaleSelectorProps = {
  /** La question posée, en tête de l'échelle. */
  label: string;
  max: number;
  value: number | null;
  onChange: (value: number) => void;
  /** Le libellé d'un cran (« En forme », « Difficile »), lu sous l'échelle et par TalkBack. */
  describe: (value: number) => string | null;
  tone?: 'ink' | 'primary';
  /** Les bornes, écrites aux deux bouts quand le libellé du cran n'est pas encore là. */
  ends?: [string, string];
  testID?: string;
};

const PER_ROW = 5;

export function ScaleSelector({
  label,
  max,
  value,
  onChange,
  describe,
  tone = 'ink',
  ends,
  testID,
}: ScaleSelectorProps) {
  const styles = useStyles(sheets);
  const steps = Array.from({ length: max }, (_, i) => i + 1);
  const rows: number[][] = [];
  for (let i = 0; i < steps.length; i += PER_ROW) {
    rows.push(steps.slice(i, i + PER_ROW));
  }
  const chosen = value === null ? null : describe(value);
  const selectedStyle = tone === 'primary' ? styles.cellPrimary : styles.cellInk;
  const selectedText = tone === 'primary' ? styles.numberOnPrimary : styles.numberOnInk;

  return (
    <View testID={testID} style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.label}>
        {label}
      </Text>

      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.rows}>
        {rows.map((row) => (
          <View key={row[0]} style={styles.row}>
            {row.map((step) => {
              const active = step === value;

              return (
                <Pressable
                  key={step}
                  testID={testID ? `${testID}-${step}` : undefined}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${step} sur ${max}${describe(step) ? `, ${describe(step)}` : ''}`}
                  onPress={() => onChange(step)}
                  style={({ pressed }) => [
                    styles.cell,
                    active && selectedStyle,
                    pressed && !active && styles.cellPressed,
                  ]}
                >
                  <Text style={[styles.number, active && selectedText]}>{step}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        {chosen !== null && value !== null ? (
          <Text style={styles.chosen}>
            {value} · {chosen}
          </Text>
        ) : ends ? (
          <>
            <Text style={styles.end}>{ends[0]}</Text>
            <Text style={styles.end}>{ends[1]}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const sheets = themed((c) => ({
  wrap: { gap: space[4] },
  label: { ...text.sectionTitle, color: c.text },
  rows: { gap: space[2] },
  row: { flexDirection: 'row', gap: space[2] },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTarget + space[3],
    borderWidth: layout.hairline,
    borderColor: c.borderPill,
    backgroundColor: c.surfaceRaised,
  },
  cellPressed: { backgroundColor: c.fill },
  cellInk: { borderColor: c.surfaceInk, backgroundColor: c.surfaceInk },
  cellPrimary: { borderColor: c.primary, backgroundColor: c.primary },
  number: { ...text.numeric, color: c.text },
  numberOnInk: { color: c.onInk },
  numberOnPrimary: { color: c.onPrimary },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: text.caption.lineHeight,
  },
  chosen: { ...text.caption, color: c.text },
  end: { ...text.caption, color: c.textSecondary },
}));
