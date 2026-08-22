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
 * 1. **La frappe remonte au parent, l'affichage non.** Deux choses distinctes,
 *    et les confondre était le défaut : la valeur affichée vient d'un brouillon
 *    de texte local — c'est ce qui rend « 82, » possible à taper, la valeur ne
 *    se réécrivant jamais sous les doigts — mais le nombre, lui, part au parent
 *    **à chaque frappe qui se lit comme un nombre**.
 *
 *    La version d'origine n'informait le parent qu'au relâchement du champ ou à
 *    la validation du clavier, et le raisonnement se tenait jusqu'à ce qu'on
 *    regarde une feuille : taper « 12 » puis appuyer directement sur « Valider »
 *    ne validait pas 12. Sur Android, appuyer sur un bouton ne relâche pas
 *    forcément le champ ; l'appui partait avec la valeur d'avant, et la seule
 *    façon d'être compris était de fermer son clavier d'abord — un geste que
 *    rien n'annonce, dans le seul écran qu'on tient d'une main. Une saisie qu'il
 *    faut confirmer deux fois est une saisie perdue une fois sur deux.
 *
 *    Une frappe illisible (champ vide, « 82, » seul) ne remonte rien : elle
 *    laisse la dernière valeur comprise en place plutôt que d'en inventer une.
 *    Le relâchement du champ commit une dernière fois, ce qui n'a plus grand
 *    chose à faire — sinon serrer aux bornes ce que la frappe y avait déjà
 *    serré, et rendre l'affichage au format de l'app.
 *
 *    **Le champ se vide à la prise de focus**, et la valeur en place passe en
 *    `placeholder`. C'est la correction de KL-39 : la version précédente
 *    s'appuyait sur `selectTextOnFocus`, dont la sélection est posée par
 *    Android **après** le premier rendu du champ focalisé. Le premier chiffre
 *    tapé arrivait avant elle, la sélection tombait ensuite sur ce chiffre-là,
 *    et le second l'effaçait : « 80 » saisi donnait « 0 ». Un brouillon vidé en
 *    JavaScript ne dépend d'aucun calendrier natif, et dit la même chose à
 *    l'œil — le champ est prêt à recevoir une valeur, pas à être corrigé
 *    caractère par caractère. Repartir sans rien taper ne change rien : une
 *    saisie vide retombe sur la valeur en place.
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
    // Un pas donné pendant que le champ est ouvert repart de ce qui y est tapé,
    // pas de la valeur d'avant : sur Android, appuyer sur un bouton ne relâche
    // pas forcément le champ, et le brouillon resterait sinon en suspens.
    commitDraft();

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
    publish(parsed);
  }

  /**
   * Remonte un nombre au parent, serré aux bornes.
   *
   * La ref est écrite **avant** l'appel : le pas répété (`bump`) y lit sa base,
   * et il avance plus vite que les rendus du parent.
   */
  function publish(parsed: number) {
    const next = clamp(round(parsed));
    currentRef.current = next;
    onChange(next);
  }

  /**
   * Ce qui est tapé. Le texte reste tel quel à l'écran — « 82, » doit pouvoir
   * s'écrire — et le nombre part tout de suite s'il s'en lit un (§1).
   */
  function onType(text: string) {
    setDraft(text);

    const parsed = parseNumber(text);

    if (parsed !== null) {
      publish(parsed);
    }
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
            // Sans lui, TalkBack annoncerait un champ vide dès la prise de
            // focus — le brouillon vidé ne doit pas effacer la valeur dite.
            accessibilityValue={{ text: `${formatNumber(value)}${unit ? ` ${unit}` : ''}` }}
            editable={!disabled}
            keyboardType="decimal-pad"
            returnKeyType="done"
            // Le champ s'ouvre **vide**, la valeur en place derrière : la saisie
            // directe sert à remplacer une valeur, pas à la corriger caractère
            // par caractère (§1 — et c'est ce qui répare le premier chiffre).
            onFocus={() => setDraft('')}
            placeholder={formatNumber(value)}
            placeholderTextColor={colors.textSoft}
            value={draft ?? formatNumber(value)}
            onChangeText={onType}
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
