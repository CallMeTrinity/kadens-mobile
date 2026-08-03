/**
 * Champ de saisie — transposition de `.kd-field` / `.kd-label` / `.kd-input`.
 *
 * Libellé en mono capitales au-dessus, jamais en `placeholder` : un placeholder
 * disparaît dès la première frappe, et avec lui la seule mention de ce qu'on
 * est en train de remplir.
 *
 * L'anneau de focus du web vient de `base.css` ; en natif il n'y a pas
 * d'équivalent global, donc le champ marque lui-même son focus en passant son
 * filet à l'encre — même geste que `.kd-input:focus`.
 */

import { useState, type Ref } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, layout, space, text } from '@/theme';

export type FieldProps = Omit<TextInputProps, 'style'> & {
  /** Libellé du champ. Écrit par l'app : mono capitales (règle 4). */
  label: string;
  /** Aide sous le champ. Masquée par `error` tant qu'il y en a une. */
  hint?: string;
  /** Message d'erreur. Le rouge dit l'échec — c'est un de ses trois emplois. */
  error?: string;
  ref?: Ref<TextInput>;
  style?: StyleProp<ViewStyle>;
};

export function Field({ label, hint, error, ref, style, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const help = error ?? hint;

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        // Le libellé visuel n'est pas rattaché au champ dans l'arbre
        // d'accessibilité natif : sans ça, TalkBack ne lirait que la valeur.
        accessibilityLabel={label}
        accessibilityHint={help}
        placeholderTextColor={colors.textPlaceholder}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          rest.multiline && styles.area,
          focused && styles.inputFocused,
          !!error && styles.inputError,
        ]}
        {...rest}
      />
      {help ? <Text style={[styles.help, !!error && styles.helpError]}>{help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[3] },
  label: { ...text.eyebrow, color: colors.textSecondary },
  input: {
    ...text.body,
    color: colors.textStrong,
    backgroundColor: colors.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: colors.borderStrong,
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    // Un champ se vise au doigt comme un bouton : même plancher.
    minHeight: layout.touchTarget,
  },
  // `textAlignVertical` : sur Android, un champ multiligne centre son texte
  // verticalement par défaut — la première ligne flotte au milieu de la boîte.
  area: { minHeight: 96, textAlignVertical: 'top' },
  inputFocused: { borderColor: colors.text },
  inputError: { borderColor: colors.statusMissed },
  help: { ...text.caption, color: colors.textSoft },
  helpError: { color: colors.statusMissed },
});
