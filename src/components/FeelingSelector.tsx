/**
 * FeelingSelector — la forme ressentie, de 1 à 5, en bonhommes.
 *
 * Fait pour la main qui la remplit en fin de séance : debout, en sueur, une
 * seule main libre. Cinq cases **à largeur égale**, hautes (96 points) parce
 * qu'elles portent un dessin, et qu'une cible haute se vise mieux qu'une cible
 * étroite. Une case se tape ; il n'y a rien à faire glisser.
 *
 * ## Le cran choisi se dit trois fois, jamais par la seule couleur
 *
 * Le bonhomme et son chiffre passent à l'encre, le filet de la case aussi, et
 * le libellé s'écrit sous la rangée (« 4 · En forme »). Les crans non retenus
 * restent en encre douce (`textSoft`) : pas `textFaint`, parce que le chiffre
 * sous le dessin est du texte (voir `contrast.test.ts`). Pas d'inversion à
 * l'encre ici, contrairement à `FilterChip` : un dessin au trait sur fond noir
 * se lirait en négatif, et c'est la silhouette qu'on vient lire.
 *
 * La forme n'est pas une intensité (règle 2) : aucun rouge.
 *
 * Pas d'état « aucune valeur » à taper : l'échelle part vide (`value = null`) et
 * ne se vide plus — retirer une note est un geste du web (`rating.ts`).
 */

import { Animated, Pressable, Text, View } from 'react-native';

import { layout, space, text, themed, useColors, useEntrance, useStyles } from '@/theme';

import { Figure, type FeelingLevel } from './Figure';

export type FeelingSelectorProps = {
  /** La question posée, en tête de l'échelle. */
  label: string;
  value: number | null;
  onChange: (value: FeelingLevel) => void;
  /** Le libellé d'un cran (« En forme »), écrit sous la rangée et lu par TalkBack. */
  describe: (value: number) => string | null;
  /** Les bornes, écrites tant que rien n'est choisi. */
  ends?: [string, string];
  testID?: string;
};

const LEVELS: FeelingLevel[] = [1, 2, 3, 4, 5];

export function FeelingSelector({
  label,
  value,
  onChange,
  describe,
  ends,
  testID,
}: FeelingSelectorProps) {
  const styles = useStyles(sheets);
  const chosen = value === null ? null : describe(value);

  return (
    <View testID={testID} style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.label}>
        {label}
      </Text>

      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
        {LEVELS.map((level) => (
          <FigureCell
            key={level}
            level={level}
            active={level === value}
            description={describe(level)}
            onPress={() => onChange(level)}
            testID={testID ? `${testID}-${level}` : undefined}
          />
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

/**
 * Une case : le bonhomme, et son chiffre dessous.
 *
 * Le bonhomme retenu sautille une fois à l'appui (`useEntrance`) : c'est
 * l'accusé de réception du geste, et il ne rejoue pas quand on rouvre l'écran
 * sur une note déjà enregistrée.
 */
function FigureCell({
  level,
  active,
  description,
  onPress,
  testID,
}: {
  level: FeelingLevel;
  active: boolean;
  description: string | null;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles(sheets);
  const colors = useColors();
  const bob = useEntrance(active, 450);
  const ink = active ? colors.text : colors.textSoft;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${level} sur 5${description ? `, ${description}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        active && styles.cellActive,
        pressed && !active && styles.cellPressed,
      ]}
    >
      <Animated.View
        style={{
          transform: [
            {
              translateY: bob.interpolate({
                inputRange: [0, 0.4, 0.7, 1],
                outputRange: [0, -6, 1, 0],
              }),
            },
          ],
        }}
      >
        <Figure level={level} width={40} color={ink} />
      </Animated.View>
      <Text style={[styles.number, active && styles.numberActive]}>{level}</Text>
    </Pressable>
  );
}

const sheets = themed((c) => ({
  wrap: { gap: space[4] },
  label: { ...text.sectionTitle, color: c.text },
  row: { flexDirection: 'row', gap: space[2] },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space[2],
    minHeight: 96,
    paddingVertical: space[3],
    borderWidth: layout.hairline,
    borderColor: c.borderPill,
    backgroundColor: c.surfaceRaised,
  },
  // Le filet passe à l'encre, le fond ne bouge pas : la case retenue se
  // reconnaît à son contour et à son dessin, pas à une inversion (en-tête).
  cellActive: { borderColor: c.text },
  cellPressed: { backgroundColor: c.fill },
  number: { ...text.eyebrow, color: c.textSoft },
  numberActive: { color: c.text },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: text.caption.lineHeight,
  },
  chosen: { ...text.caption, color: c.text },
  end: { ...text.caption, color: c.textSecondary },
}));
