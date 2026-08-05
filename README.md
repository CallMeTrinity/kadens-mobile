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

## Design : tokens, polices et visuels

L'identité vient du serveur, elle ne se redéfinit pas ici.

```bash
npm run sync:tokens   # design-tokens.json      -> src/theme/tokens.ts (généré)
npm run sync:fonts    # public/fonts/*.ttf      -> assets/fonts/
npm run sync:icons    # public/pwa/android/*.png -> assets/images/
npm run sync:design   # les trois
```

Les trois scripts lisent une **racine publique**, par défaut la production. Tant
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

Les visuels d'`assets/images/` — icône du lanceur, couches adaptative et
monochrome, silhouette de notification, écran de démarrage — sont eux aussi
**générés côté serveur**, par `tools/build-pwa-icons.php`. Leur source est
`assets/icons/kadens-red-black.png`, la variante **rouge et noire** de la marque,
et non celle du site : deux icônes de la même famille sur le même écran d'accueil
se confondraient. Elle arrive déjà réduite au K, sur fond blanc opaque, donc rien
à isoler mais tout à détourer — le fond est retiré en récupérant l'antialiasing
plutôt qu'au seuil, sinon les diagonales du K se dentellent.

Régénérer côté serveur, puis `npm run sync:icons`. Les noms de fichiers sont
déclarés dans `app.json` : les deux listes se tiennent l'une l'autre.

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

**Ajouter un module natif impose de reconstruire.** Le développement se fait sur
un build de développement (`expo-dev-client`), dont le jeu de modules natifs est
figé au moment de la compilation. Metro rebundle le JS à chaque sauvegarde, donc
le nouveau code arrive bien sur le téléphone — mais le module manque au binaire,
et l'app tombe sur :

```
ERROR  [Error: Cannot find native module 'ExpoSecureStore']
```

suivi d'une cascade de `Route "./_layout.tsx" is missing the required default
export` : l'import a levé, la route ne vaut plus rien. Rien à corriger dans le
code, il faut relancer `npm run android`. Après un `npx expo install <module>`,
donc, on reconstruit — un `npm start` seul ne suffit pas.

## Signature et restauration du keystore

**Un secret GitHub ne se relit pas.** L'API n'expose que l'écriture : une fois
`ANDROID_KEYSTORE_BASE64` posé, plus personne — ni l'interface, ni `gh`, ni un
workflow — ne peut en ressortir le fichier. Ce n'est donc **pas** une sauvegarde,
c'est une copie de travail à sens unique. La sauvegarde, c'est le gestionnaire de
mots de passe.

**Et perdre la clé de release ne se rattrape pas.** Android identifie une app par
le couple `applicationId` + certificat de signature : un APK signé par une autre
clé n'est pas une mise à jour de Kadens, c'est une autre app, refusée à
l'installation par-dessus. La seule sortie serait de désinstaller — donc de
perdre la base SQLite locale, dont le réalisé pas encore synchronisé.

### Les deux clés

| Fichier              | Alias            | Signe                             | Secrets GitHub                                                                                      |
| -------------------- | ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kadens-release.jks` | `kadens-release` | l'APK (KL-41)                     | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| `tntstore-index.jks` | `tntstore-index` | l'index du dépôt TNTStore (KL-42) | `TNTSTORE_KEYSTORE_BASE64`, `TNTSTORE_KEYSTORE_PASSWORD`, `TNTSTORE_KEY_ALIAS`                      |

**Elles sont distinctes, et c'est le point.** L'index ne fait que déclarer quelles
versions existent et où les prendre ; il ne contient aucun binaire. Séparer les
deux clés borne les dégâts dans les deux sens : compromettre celle de l'index
laisse republier un catalogue, pas une fausse app ; compromettre celle de release
ne donne pas le catalogue. Les mélanger ferait de la clé de l'index — celle qui
tourne le plus souvent — une clé de signature d'application.

Les deux vivent dans `~/.keystores/kadens/` (hors de tout dépôt git, `chmod 700`),
avec un `CREDENTIALS.txt` en `chmod 600` qui porte les mots de passe et les
empreintes. Ce fichier est un intermédiaire : sa place définitive est le
gestionnaire de mots de passe.

Empreinte SHA-256 du certificat de release, à recouper avec un APK douteux :

```
50:D9:67:98:97:80:48:3B:13:82:3E:72:DE:0E:EA:DB:72:2F:EE:98:5D:76:7D:37:53:52:1B:A8:A9:67:BF:50
```

**Format JKS, pas PKCS12**, contre la recommandation affichée par `keytool`. La
raison est vérifiable en une commande : en PKCS12, Java **ignore** `-keypass` et
aligne le mot de passe de la clé sur celui du keystore, ce qui réduit les trois
secrets à deux et fait échouer `jarsigner` en `key associated with <alias> not a
private key`. Si un JDK finit par refuser JKS en lecture, la conversion reste
possible tant qu'on a le fichier : `keytool -importkeystore -srckeystore
kadens-release.jks -destkeystore kadens-release.p12 -deststoretype pkcs12`.

### Restaurer sur une nouvelle machine

Depuis le gestionnaire de mots de passe, qui porte le `.jks` et ses mots de
passe :

```bash
mkdir -p ~/.keystores/kadens && chmod 700 ~/.keystores/kadens
# y déposer kadens-release.jks et tntstore-index.jks
chmod 600 ~/.keystores/kadens/*.jks
```

Contrôler que la clé restaurée est **la bonne**, avant de s'en servir — l'empreinte
doit tomber sur celle ci-dessus :

```bash
keytool -exportcert -rfc -keystore ~/.keystores/kadens/kadens-release.jks \
  -alias kadens-release -storepass '<mot de passe du keystore>' \
  | openssl x509 -noout -fingerprint -sha256
```

Puis reposer les secrets du dépôt (`base64 -i` sur macOS, `base64 -w0` sous
Linux) :

```bash
D=~/.keystores/kadens
gh secret set ANDROID_KEYSTORE_BASE64    --body "$(base64 -i "$D/kadens-release.jks")"
gh secret set ANDROID_KEYSTORE_PASSWORD  --body '<mot de passe du keystore>'
gh secret set ANDROID_KEY_ALIAS          --body 'kadens-release'
gh secret set ANDROID_KEY_PASSWORD       --body '<mot de passe de la clé>'
gh secret set TNTSTORE_KEYSTORE_BASE64   --body "$(base64 -i "$D/tntstore-index.jks")"
gh secret set TNTSTORE_KEYSTORE_PASSWORD --body '<mot de passe de l index>'
gh secret set TNTSTORE_KEY_ALIAS         --body 'tntstore-index'
```

Le workflow de build fait le chemin inverse, `base64 -d` vers un fichier hors de
l'arborescence source. Il ne doit **jamais** l'écrire dans le dépôt : `android/`
est régénéré par `expo prebuild`, mais `.gitignore` ne protège que `*.jks` — un
keystore déposé sous un autre nom passerait.

### Régénérer, si la clé est vraiment perdue

Il n'y a pas de récupération, seulement une reprise à zéro. Générer une nouvelle
clé avec la commande ci-dessous, puis **changer `android.package` dans
`app.json`** : sans ça, les installations existantes ne verront jamais la mise à
jour et n'afficheront aucune erreur explicite.

```bash
keytool -genkeypair -keystore ~/.keystores/kadens/kadens-release.jks \
  -storetype JKS -alias kadens-release \
  -keyalg RSA -keysize 4096 -validity 14600 \
  -dname "CN=Antonin Pamart, OU=Kadens, O=antoninpamart.fr, L=Grenoble, ST=Auvergne-Rhone-Alpes, C=FR"
```

Le certificat courant expire le **26/07/2066**. Une expiration n'invalide pas les
installations en place, mais elle bloque la signature d'un nouvel APK : c'est une
échéance de build, pas une échéance d'app.

## Structure

```
src/
  app/          routes expo-router (une route = un fichier)
  api/          client HTTP, endpoints typés, session et jeton
  components/   composants de base (Button, Field, Sheet…)
  db/           base locale SQLite, schéma et migrations générées
  theme/        tokens générés, échelle typographique, polices
  config.ts     configuration issue de l'environnement
tools/          scripts de synchronisation avec le serveur
assets/
  fonts/        Barlow, Barlow Condensed, IBM Plex Mono (récupérées, versionnées)
  images/       icône, écran de démarrage
```

L'alias `@/` pointe `src/`.
