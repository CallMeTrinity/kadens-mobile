/**
 * Point d'entrée des composants de base (KL-23).
 *
 * Un écran importe **d'ici** (`@/components`), jamais d'un fichier précis : le
 * jour où un composant se décompose, l'import ne bouge pas.
 *
 * Ce qu'ils ont tous en commun, et qui n'est pas négociable : aucune couleur ni
 * police en dur — tout vient de `@/theme` (règle 1) — et toute cible tactile
 * fait au moins `layout.touchTarget` points.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { Chip, type ChipProps, type ChipRank, type ChipTone } from './Chip';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Field, type FieldProps } from './Field';
export { FilterChip, type FilterChipProps } from './FilterChip';
export { Icon, type IconName, type IconProps } from './Icon';
export { formatNumber, NumberStepper, type NumberStepperProps } from './NumberStepper';
export { Header, type HeaderProps } from './Header';
export { Sheet, type SheetProps } from './Sheet';

/**
 * La mise en forme des unités (KL-29). Ici plutôt que dans `@/session` : décider
 * de ce qui est fait est du domaine, écrire « 82,5 kg » est du rendu — et le
 * rendu français des nombres vit déjà dans ce dossier.
 */
export { duration, setEffort, weight } from './units';
