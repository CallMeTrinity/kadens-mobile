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

/**
 * Couleurs sémantiques — jeu **clair**, celui du papier.
 *
 * C'est la forme de référence : `ColorToken` en dérive, et le jeu sombre est
 * tenu de porter exactement les mêmes clés.
 */
export const light = {
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

/**
 * Couleurs sémantiques — jeu **sombre**.
 *
 * `satisfies ColorSet` n'est pas décoratif : c'est le compilateur qui redit ici
 * l'invariant que `app:tokens:export` tient déjà côté serveur. Une clé de trop ou
 * en moins est une erreur de build, pas une couleur transparente sur un téléphone.
 */
export const dark = {
  bg: '#101010',
  surface: '#191918',
  surfaceRaised: '#1f1f1e',
  surfaceSubtle: '#1b1b1a',
  surfaceHover: '#242423',
  fill: '#292928',
  track: '#333331',
  scrim: 'rgba(0, 0, 0, 0.62)',
  surfaceInk: '#ededea',
  surfaceInkHover: '#dcdad6',
  onInk: '#101010',
  onInkMuted: 'rgba(0, 0, 0, 0.6)',
  onInkFaint: 'rgba(0, 0, 0, 0.45)',
  borderOnInk: 'rgba(0, 0, 0, 0.18)',
  borderOnInkStrong: 'rgba(0, 0, 0, 0.35)',
  text: '#ededea',
  textStrong: '#dcdad6',
  textSecondary: '#a3a19a',
  textSoft: '#94928b',
  textFaint: '#6f6f68',
  textPlaceholder: '#8a887f',
  border: '#2f2f2d',
  borderStrong: '#4a4a46',
  borderCell: '#2f2f2d',
  borderPill: '#3a3a37',
  borderMuted: '#3a3a37',
  divider: '#2f2f2d',
  dividerSoft: '#232322',
  primary: '#d8261e',
  primaryHover: '#a81a14',
  primaryBright: '#f03127',
  primaryOnInk: '#a81a14',
  primaryTint: '#3a1310',
  primaryTrack: '#4d1a16',
  primaryOnTint: '#f0544c',
  onPrimary: '#ffffff',
  bodymap1: '#3a1310',
  bodymap2: '#b2534d',
  bodymap3: '#f0544c',
  cat1: '#ededea',
  cat2: '#b0aea8',
  cat3: '#7a7a73',
  cat4: '#4a4a46',
  muscleLegs: '#5f97c9',
  muscleChest: '#d79b5e',
  muscleBack: '#64ab8a',
  muscleArms: '#a97cad',
  muscleOther: '#a3a19a',
  activityRun: '#ededea',
  activityRunTint: '#292928',
  activityRunText: '#a3a19a',
  activityGym: '#b0aea8',
  activityGymTint: '#292928',
  activityGymText: '#a3a19a',
  activitySwim: '#7a7a73',
  activityBike: '#7a7a73',
  activityMobility: '#4a4a46',
  setWarmup: '#ededea',
  setWarmupTint: '#1f1f1e',
  setDegressive: '#ededea',
  setDegressiveTint: '#292928',
  setFailure: '#d8261e',
  setFailureTint: '#3a1310',
  setDropset: '#d8261e',
  setDropsetTint: '#1f1f1e',
  statusDone: '#45a35a',
  statusPlanned: '#8a8a82',
  statusMissed: '#d8261e',
} as const satisfies ColorSet;

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

/** Les deux jeux, indexés par leur nom. `contrast.test.ts` les parcourt. */
export const palettes = { light, dark } as const;

export type ThemeName = keyof typeof palettes;
export type ColorToken = keyof typeof light;
/** Un jeu complet. Ce que reçoit une fabrique `themed()`. */
export type ColorSet = Readonly<Record<ColorToken, string>>;
export type SpaceToken = keyof typeof space;
export type FontStack = keyof typeof fontStacks;
export type Weight = (typeof weight)[keyof typeof weight];
