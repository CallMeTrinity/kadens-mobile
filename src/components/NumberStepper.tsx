/**
 * Compteur — charge, répétitions, minutes de repos.
 *
 * C'est le composant de saisie du projet : **en salle, on ne tape pas au
 * clavier**. Deux boutons larges encadrent la valeur et l'ajustent par pas
 * (2,5 kg par défaut, le plus petit disque d'une salle) ; la saisie directe
 * existe pour les cas où le pas ne suffit pas — passer de 20 à 100 kg — mais
 * elle n'est pas le chemin normal.
 *
 * Trois choses non évidentes tiennent ce fichier :
 *
 * 1. **La frappe ne remonte pas au parent.** Tant que le champ est en cours
 *    d'édition, la valeur vit dans un brouillon de texte local : convertir à
 *    chaque frappe rendrait « 82, » impossible à taper (la virgule seule ne
 *    fait pas un nombre, la valeur serait réécrite sous les doigts). Le parent
 *    n'est informé qu'au relâchement du champ ou à la validation.
 * 2. **Le pas se répète à l'appui long**, sinon monter de 60 à 100 kg demande
 *    seize appuis.
 * 3. **La virgule est acceptée à l'entrée et rendue à l'affichage** : c'est ce
 *    que le clavier numérique français propose, et l'app est en français. Le
 *    nombre, lui, reste un nombre — les unités normalisées (kg, mètres,
 *    secondes) sont une règle du serveur.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, layout, space, text } from '@/theme';

export type NumberStepperProps = {
  /** Libellé du compteur. Écrit par l'app : mono capitales (règle 4). */
  label?: string;
  value: number;
  onChange: (value: number) => void;
  /** Incrément. 2,5 kg par défaut — le plus petit disque d'une salle. */
  step?: number;
  min?: number;
  max?: number;
  /** Unité affichée à droite de la valeur (kg, reps, min…). */
  unit?: string;
  disabled?: boolean;
  testID?: string;
};

/** Délai avant que l'appui long ne prenne le relais du premier pas. */
const HOLD_DELAY_MS = 450;
/** Cadence de la répétition. Assez lente pour rester lisible en marchant. */
const HOLD_INTERVAL_MS = 110;

/**
 * Arrondi à trois décimales. Sans lui, `0.1 + 0.2` s'affiche « 0,30000000000004 »
 * dans le champ — les flottants ne connaissent pas les kilos.
 */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Rendu français : la virgule décimale, et pas de zéro inutile. */
export function formatNumber(n: number): string {
  return String(round(n)).replace('.', ',');
}

/** Lit ce que l'utilisateur a tapé. Rend `null` si ça n'est pas un nombre. */
function parseNumber(raw: string): number | null {
  const parsed = Number(raw.trim().replace(',', '.').replace(/\s/g, ''));
  return raw.trim() === '' || Number.isNaN(parsed) ? null : parsed;
}

export function NumberStepper({
  label,
  value,
  onChange,
  step = 2.5,
  min = 0,
  max,
  unit,
  disabled = false,
  testID,
}: NumberStepperProps) {
  // Brouillon de saisie : `null` tant que le champ n'est pas édité, auquel cas
  // c'est `value` qui s'affiche.
  const [draft, setDraft] = useState<string | null>(null);

  // La répétition avance plus vite que les rendus du parent : elle lit sa base
  // dans une ref, sinon chaque tick repartirait de la même valeur et le
  // compteur resterait collé à `value + step`.
  const currentRef = useRef(value);
  useEffect(() => {
    currentRef.current = value;
  }, [value]);

  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  // Vrai dès qu'un `onPressIn` a déjà appliqué le pas de ce geste. TalkBack, lui,
  // n'émet que `onPress` : le drapeau distingue les deux chemins sans compter
  // deux fois.
  const steppedByGesture = useRef(false);

  function clamp(n: number): number {
    const floored = Math.max(n, min);
    return max === undefined ? floored : Math.min(floored, max);
  }

  function bump(direction: 1 | -1) {
    const next = clamp(round(currentRef.current + direction * step));
    currentRef.current = next;
    onChange(next);
  }

  function stopHold() {
    if (holdTimeout.current) {
      clearTimeout(holdTimeout.current);
      holdTimeout.current = null;
    }
    if (holdInterval.current) {
      clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
  }

  function startHold(direction: 1 | -1) {
    stopHold();
    holdTimeout.current = setTimeout(() => {
      holdInterval.current = setInterval(() => bump(direction), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }

  // Un doigt relâché hors du bouton, ou un écran qui se démonte pendant l'appui,
  // laisserait sinon un intervalle tourner sur un composant disparu.
  useEffect(() => stopHold, []);

  function commitDraft() {
    const parsed = draft === null ? null : parseNumber(draft);
    setDraft(null);
    if (parsed === null) {
      return; // Saisie vide ou illisible : on revient à la valeur en place.
    }
    const next = clamp(round(parsed));
    currentRef.current = next;
    onChange(next);
  }

  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  function stepButton(direction: 1 | -1) {
    const blocked = disabled || (direction === -1 ? atMin : atMax);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${direction === -1 ? 'Retirer' : 'Ajouter'} ${formatNumber(step)}${unit ? ` ${unit}` : ''}`}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        testID={testID ? `${testID}-${direction === -1 ? 'minus' : 'plus'}` : undefined}
        onPressIn={() => {
          steppedByGesture.current = true;
          bump(direction);
          startHold(direction);
        }}
        onPressOut={stopHold}
        onPress={() => {
          if (!steppedByGesture.current) {
            bump(direction);
          }
          steppedByGesture.current = false;
        }}
        style={({ pressed }) => [
          styles.stepButton,
          pressed && styles.stepButtonPressed,
          blocked && styles.blocked,
        ]}
      >
        {({ pressed }) => (
          // Le glyphe s'inverse avec l'aplat : sans ça, il disparaîtrait dans
          // l'encre au moment précis où l'on veut voir que le pas est parti.
          <Text style={[styles.stepGlyph, pressed && styles.stepGlyphPressed]}>
            {direction === -1 ? '−' : '+'}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.stepper} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {stepButton(-1)}
        <View style={[styles.valueBox, disabled && styles.blocked]}>
          <TextInput
            accessibilityLabel={label}
            editable={!disabled}
            keyboardType="decimal-pad"
            returnKeyType="done"
            // Le champ s'ouvre sur une sélection complète : la saisie directe
            // sert à remplacer une valeur, pas à la corriger caractère par
            // caractère.
            selectTextOnFocus
            value={draft ?? formatNumber(value)}
            onChangeText={setDraft}
            onBlur={commitDraft}
            onSubmitEditing={commitDraft}
            style={styles.value}
            testID={testID ? `${testID}-input` : undefined}
          />
          {unit ? <Text style={styles.unit}>{unit}</Text> : null}
        </View>
        {stepButton(1)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: space[3] },
  label: { ...text.eyebrow, color: colors.textSecondary },
  stepButton: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    paddingHorizontal: space[8],
    borderWidth: layout.hairline,
    borderColor: colors.text,
    backgroundColor: colors.surfaceRaised,
  },
  // Même inversion que le bouton secondaire : le geste se voit sur l'aplat,
  // pas sur une ombre.
  stepButtonPressed: { backgroundColor: colors.text },
  stepGlyph: { ...text.blockRole, color: colors.text },
  stepGlyphPressed: { color: colors.surfaceRaised },
  blocked: { opacity: 0.4 },
  valueBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: layout.touchTarget,
    paddingHorizontal: space[4],
    borderWidth: layout.hairline,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  // `padding: 0` : le rembourrage par défaut d'un TextInput Android décentre la
  // valeur dans sa boîte.
  value: {
    ...text.inputValue,
    color: colors.textStrong,
    flexShrink: 1,
    textAlign: 'center',
    padding: 0,
  },
  unit: { ...text.eyebrow, color: colors.textSoft },
});
