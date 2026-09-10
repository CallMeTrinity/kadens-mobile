/**
 * GÉNÉRÉ par `npm run sync:tokens` — NE JAMAIS ÉDITER À LA MAIN.
 *
 * Traduction native de `design-tokens.json`, lui-même projeté depuis
 * `assets/styles/tokens.css` (dépôt kadens). Toute évolution visuelle part de
 * cette feuille, puis se régénère ici.
 *
 * Les couleurs et les polices ne sont exposées que par leur nom **sémantique** :
 * jamais de couleur ni de police en dur dans un composant (règle 1 du design
 * system). L'échelle typographique, elle, n'est pas tokenisée côté web (le CSS
 * la porte en `clamp()`) : elle vit dans `typography.ts`.
 */

/** Couleurs sémantiques. Le rouge porte du sens : primaire, intensité, échec. */
export const colors = {
  bg: '#dcdcd7',
  surface: '#f7f7f5',
  surfaceRaised: '#ffffff',
  surfaceSubtle: '#fbfbf9',
  surfaceHover: '#fafaf8',
  fill: '#f3f3f1',
  track: '#ecece8',
  scrim: 'rgba(11, 11, 11, 0.42)',
  surfaceInk: '#0b0b0b',
  surfaceInkHover: '#1a1a1a',
  onInk: '#ffffff',
  onInkMuted: 'rgba(255, 255, 255, 0.6)',
  onInkFaint: 'rgba(255, 255, 255, 0.45)',
  borderOnInk: 'rgba(255, 255, 255, 0.18)',
  borderOnInkStrong: 'rgba(255, 255, 255, 0.35)',
  text: '#0b0b0b',
  textStrong: '#1a1a1a',
  textSecondary: '#5c5c56',
  textSoft: '#6e6e68',
  textFaint: '#75756e',
  textPlaceholder: '#7a7a73',
  border: '#e2e2de',
  borderStrong: '#c9c9c2',
  borderCell: '#e2e2de',
  borderPill: '#d6d6d0',
  borderMuted: '#d6d6d0',
  divider: '#e2e2de',
  dividerSoft: '#f0f0ec',
  primary: '#d8261e',
  primaryHover: '#a81a14',
  primaryBright: '#f03127',
  primaryOnInk: '#f0544c',
  primaryTint: '#fbe9e8',
  primaryTrack: '#e8c9c7',
  primaryOnTint: '#a81a14',
  onPrimary: '#ffffff',
  bodymap1: '#fbe9e8',
  bodymap2: '#cb7672',
  bodymap3: '#a81a14',
  cat1: '#0b0b0b',
  cat2: '#4a4a46',
  cat3: '#8a8a82',
  cat4: '#c9c9c2',
  muscleLegs: '#1d4e7a',
  muscleChest: '#a8632a',
  muscleBack: '#2f6b4f',
  muscleArms: '#6b3b6e',
  muscleOther: '#7a7a73',
  activityRun: '#0b0b0b',
  activityRunTint: '#f3f3f1',
  activityRunText: '#5c5c56',
  activityGym: '#4a4a46',
  activityGymTint: '#f3f3f1',
  activityGymText: '#5c5c56',
  activitySwim: '#8a8a82',
  activityBike: '#8a8a82',
  activityMobility: '#c9c9c2',
  setWarmup: '#0b0b0b',
  setWarmupTint: '#ffffff',
  setDegressive: '#0b0b0b',
  setDegressiveTint: '#f3f3f1',
  setFailure: '#d8261e',
  setFailureTint: '#fbe9e8',
  setDropset: '#d8261e',
  setDropsetTint: '#ffffff',
  statusDone: '#006d14',
  statusPlanned: '#8a8a82',
  statusMissed: '#d8261e',
} as const;

/** Familles de polices. La graisse se choisit par `fontFamily()`, cf. fonts.ts. */
export const fontStacks = {
  display: 'Barlow Condensed',
  body: 'Barlow',
  mono: 'IBM Plex Mono',
} as const;

/** Échelle d’espacement, base 4px. */
export const space = {
  1: 4,
  2: 6,
  3: 8,
  4: 10,
  5: 12,
  6: 14,
  7: 16,
  8: 20,
  9: 22,
  10: 24,
  11: 26,
  12: 28,
  13: 30,
} as const;

/** Rayons — tous nuls. Les noms subsistent pour que les composants se lisent. */
export const radius = {
  xs: 0,
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  pill: 0,
  full: 0,
} as const;

/** Graisses disponibles dans les polices embarquées. */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

/** Interlettrage en **em** : à convertir en points par `letterSpacing()`. */
export const tracking = {
  display: -0.01,
  action: 0.1,
  eyebrow: 0.06,
  eyebrowLg: 0.1,
  eyebrowXl: 0.16,
} as const;

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
export type FontStack = keyof typeof fontStacks;
export type Weight = (typeof weight)[keyof typeof weight];
