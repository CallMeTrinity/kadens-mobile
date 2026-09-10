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
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { layout, space, text, themed, useStyles, useColors } from '@/theme';

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
  const styles = useStyles(sheets);
  const colors = useColors();
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
        // `textSoft` et non `textPlaceholder` : ce dernier plafonne à 4,3:1 sur
        // le fond d'un champ, sous les 4,5:1 d'AA (KL-39). Un texte d'invite est
        // du texte.
        placeholderTextColor={colors.textSoft}
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

const sheets = themed((c) => ({
  field: { gap: space[3] },
  label: { ...text.eyebrow, color: c.textSecondary },
  input: {
    ...text.body,
    color: c.textStrong,
    backgroundColor: c.surfaceRaised,
    borderWidth: layout.hairline,
    borderColor: c.borderStrong,
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    // Un champ se vise au doigt comme un bouton : même plancher.
    minHeight: layout.touchTarget,
  },
  // `textAlignVertical` : sur Android, un champ multiligne centre son texte
  // verticalement par défaut — la première ligne flotte au milieu de la boîte.
  area: { minHeight: 96, textAlignVertical: 'top' },
  inputFocused: { borderColor: c.text },
  inputError: { borderColor: c.statusMissed },
  // Encre secondaire : l'aide se pose souvent sur le papier de la page, où
  // l'encre douce ne tient pas les 4,5:1 d'AA (KL-39).
  help: { ...text.caption, color: c.textSecondary },
  // Le rouge **écrit** se dit `primaryOnTint` : l'accent plein tombe à 3,6:1 sur
  // le papier, sous AA (KL-39). Le filet du champ, lui, le garde — un objet
  // graphique se contente de 3:1.
  helpError: { color: c.primaryOnTint },
}));
