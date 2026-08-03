/**
 * Bouton — transposition de `.kd-btn` (web).
 *
 * Trois variantes, et pas une de plus : `primary` (aplat rouge), `secondary`
 * (contour encre qui s'inverse) et `ghost`. Le rouge est la couleur de
 * l'action primaire — règle 2 du design system : une seule couleur, et elle
 * porte du sens. Un écran n'a donc **qu'un** bouton primaire.
 *
 * Le web exprime l'état actif au survol ; il n'y a pas de survol au doigt, donc
 * chaque variante transpose son `:hover` en état **pressé**. Le sens est
 * conservé : l'aplat rouge s'éclaircit (le foncer refermerait le bouton), le
 * contour encre s'inverse, le fantôme se pose sur un fond.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, space, text } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

export type ButtonProps = {
  /** Libellé de l'action. Écrit par l'app, donc condensé capitales (règle 4). */
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /**
   * `sm` resserre les gouttières, **jamais la hauteur** : le plancher tactile
   * de 44 points ne se négocie pas, et le web réduisait aussi la taille du
   * texte — l'échelle native n'a pas ce cran, et en inventer un pour un bouton
   * secondaire ne vaut pas le rôle supplémentaire.
   */
  size?: ButtonSize;
  /** Occupe toute la largeur disponible (pendant de `.kd-btn--block`). */
  block?: boolean;
  disabled?: boolean;
  /** Glyphe ou pastille posé avant le libellé. */
  leading?: ReactNode;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type Skin = { bg: string; border: string; label: string };

/** Une variante = deux peaux, au repos et pressée. */
const SKINS: Record<ButtonVariant, { idle: Skin; pressed: Skin }> = {
  primary: {
    idle: { bg: colors.primary, border: colors.primary, label: colors.onPrimary },
    pressed: { bg: colors.primaryBright, border: colors.primaryBright, label: colors.onPrimary },
  },
  secondary: {
    idle: { bg: colors.surfaceRaised, border: colors.text, label: colors.text },
    pressed: { bg: colors.text, border: colors.text, label: colors.surfaceRaised },
  },
  ghost: {
    idle: { bg: 'transparent', border: 'transparent', label: colors.textSecondary },
    pressed: { bg: colors.fill, border: 'transparent', label: colors.text },
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  leading,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const skin = SKINS[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        block && styles.block,
        {
          backgroundColor: (pressed ? skin.pressed : skin.idle).bg,
          borderColor: (pressed ? skin.pressed : skin.idle).border,
        },
        // Même opacité que `.kd-btn:disabled` côté web. Le bouton reste lisible
        // et reste dans le flux : un contrôle qui disparaît fait douter de son
        // existence.
        disabled && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          <Text
            numberOfLines={1}
            style={[styles.label, { color: (pressed ? skin.pressed : skin.idle).label }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    borderWidth: layout.hairline,
    // Le plancher tactile s'applique au bouton lui-même : le rembourrage seul
    // ne le garantit pas pour un libellé court.
    minHeight: layout.touchTarget,
    alignSelf: 'flex-start',
  },
  md: { paddingVertical: space[4], paddingHorizontal: space[8] },
  sm: { paddingVertical: space[3], paddingHorizontal: space[5] },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  leading: { justifyContent: 'center' },
  label: { ...text.action },
});
