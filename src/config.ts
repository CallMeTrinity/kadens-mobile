/**
 * Configuration issue de l'environnement de build.
 *
 * `EXPO_PUBLIC_API_URL` n'est qu'un **défaut de développement** : en usage réel
 * c'est le QR d'appairage qui porte l'URL du serveur et la configure au passage
 * (KL-48), et la valeur retenue vivra dans la base locale (KL-24). Rien de
 * secret ne passe par ici : une variable `EXPO_PUBLIC_*` est inlinée dans le
 * bundle, donc lisible dans l'APK.
 *
 * L'accès à `process.env.EXPO_PUBLIC_API_URL` doit rester écrit en toutes
 * lettres : Expo remplace l'expression au build, un accès dynamique rendrait
 * `undefined`.
 */
export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL;
