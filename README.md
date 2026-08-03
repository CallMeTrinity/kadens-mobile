# Kadens Mobile

App Android de **suivi de séance en direct** pour [Kadens](https://kadens.antoninpamart.fr).
Elle déroule une séance programmée, en logue le réalisé série par série, et le
fait **hors réseau** avec synchronisation différée.

Le serveur (Symfony) vit dans le dépôt `kadens`. Le cadrage complet, les
décisions et les tickets sont dans `kadens/docs/feature-live-tracking.md` ; le
contrat de l'API dans `kadens/docs/api-mobile.md`.

- Expo SDK 57 (React Native 0.86), TypeScript, `expo-router`
- Android uniquement : aucun ticket ne cible iOS, aucun build iOS n'est vérifié
- Distribution par dépôt F-Droid auto-hébergé, pas par le Play Store

---

## Prérequis

- **Node 20 ou 22** (LTS). Expo SDK 57 ne certifie pas les versions impaires ni
  les toutes dernières.
- **Expo Go** sur le téléphone Android pour le développement courant, ou un
  build natif (`npx expo run:android`) dès qu'un module natif non inclus dans
  Expo Go entre en jeu.
- Pour un build natif : JDK 17 et le SDK Android (Android Studio).

## Lancement

```bash
npm install
cp .env.example .env      # puis renseigner l'IP LAN (voir plus bas)
npm start                 # QR à scanner avec Expo Go
npm run android           # ouvre directement sur l'appareil/émulateur connecté
```

Autres commandes :

```bash
npm run web        # rendu web (react-native-web), pratique pour itérer sur un composant
npm run lint       # ESLint (config Expo + Prettier)
npm run format     # Prettier en écriture
npm run typecheck  # tsc --noEmit
```

## Design : tokens et polices

L'identité vient du serveur, elle ne se redéfinit pas ici.

```bash
npm run sync:tokens   # design-tokens.json  -> src/theme/tokens.ts (généré)
npm run sync:fonts    # public/fonts/*.ttf  -> assets/fonts/
npm run sync:design   # les deux
```

Les deux scripts lisent une **racine publique**, par défaut la production. Tant
qu'elle n'a pas le fichier, générer depuis le dépôt voisin :

```bash
npm run sync:tokens -- --source=../kadens/public
```

`src/theme/tokens.ts` est **généré et versionné** : ne jamais l'éditer à la main,
régénérer. Une valeur que React Native ne sait pas lire (`color-mix()`, une pile
de polices, un rayon non nul) **échoue la commande** plutôt que d'être approchée.

L'échelle typographique, elle, n'est pas dans les tokens (le web la porte en
`clamp()`) : elle vit dans `src/theme/typography.ts`, et c'est là que se tient la
règle de casse — libellés de structure en Barlow Condensed capitales, contenu
saisi en Barlow casse normale.

Le rendu web n'est qu'un confort de développement : rien n'y est vérifié, et
l'app se teste sur Android.

## Développement contre un Symfony local

**Le téléphone n'est pas la machine.** `localhost` désigne le téléphone
lui-même : une URL d'API en `http://localhost:8000` échoue toujours, et l'erreur
ressemble à une panne réseau plutôt qu'à une erreur de configuration.

1. Relever l'**IP LAN** de la machine :

   ```bash
   ipconfig getifaddr en0        # macOS, Wi-Fi
   ```

2. Démarrer Symfony en écoutant sur **toutes** les interfaces — par défaut il
   n'écoute que la boucle locale et reste injoignable depuis le téléphone :

   ```bash
   symfony serve --listen-ip=0.0.0.0 --port=8000
   ```

3. Renseigner cette IP dans `.env` :

   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.42:8000
   ```

4. Machine et téléphone doivent être sur **le même réseau**, sans isolation des
   clients Wi-Fi (fréquent sur les réseaux invités).

`EXPO_PUBLIC_API_URL` n'est qu'un défaut de développement : en usage réel, le QR
d'appairage affiché dans `/profile/settings` porte l'URL du serveur et la
configure au passage (KL-48). C'est aussi le chemin le plus court en dev — le QR
généré par un Symfony local contient déjà la bonne IP.

## Dossiers natifs

`android/` **n'est pas versionné** : le workflow de build le régénère par
`expo prebuild`. Toute configuration native (permissions, signature, intent
filters) passe donc par un **plugin déclaré dans `app.json`** — une modification
faite à la main dans `android/` serait effacée au prochain build, sans bruit.

## Structure

```
src/
  app/          routes expo-router (une route = un fichier)
  theme/        tokens générés, échelle typographique, polices
  config.ts     configuration issue de l'environnement
tools/          scripts de synchronisation avec le serveur
assets/
  fonts/        Barlow, Barlow Condensed, IBM Plex Mono (récupérées, versionnées)
  images/       icône, écran de démarrage
```

L'alias `@/` pointe `src/`.
