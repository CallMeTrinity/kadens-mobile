import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { restoreSession, setApiBaseUrl, useSession } from '@/api';
import { Fault } from '@/components';
import { getSyncState, useDatabaseMigrations } from '@/db';
import { initRestNotifications } from '@/session';
import { useAppVersionCheck, useSyncTriggers } from '@/sync';
import { colors, useKadensFonts } from '@/theme';

// L'écran de démarrage reste affiché tant que les polices ne sont pas prêtes.
// Sans ça le premier rendu sort en police système puis bascule : la mise en
// page saute, et un titre condensé change de largeur du tout au tout.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useKadensFonts();
  // Les migrations locales (KL-24) : une fois par version de schéma, journal
  // tenu par Drizzle. Elles doivent avoir tourné avant qu'un écran lise quoi
  // que ce soit — une requête sur une table pas encore créée ne « charge »
  // pas, elle échoue.
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  // Et la session (KL-25), qui vient du trousseau, donc de façon asynchrone.
  const authSettled = useRestoredSession(dbReady || dbError !== undefined, dbReady);
  const session = useSession();

  const fontsSettled = fontsLoaded || fontError !== null;
  const dbSettled = dbReady || dbError !== undefined;

  // Un `login` ou un `pair` qui vient de réussir laisse la base locale vide :
  // l'app retient l'écran de bootstrap (KL-26) le temps du premier pull. Une
  // session restaurée saute cette étape (`awaitingFirstSync` y part à `false`) :
  // la base locale porte déjà le dernier pull.
  const signedIn = session.status === 'signedIn';
  const readyForApp = signedIn && !session.awaitingFirstSync;

  // Les déclencheurs de synchronisation (KL-27) : lancement, retour au premier
  // plan, retour du réseau. Ils vivent ici parce qu'ils doivent survivre au
  // démontage de n'importe quel écran — une séance clôturée pendant que l'app est
  // en arrière-plan doit partir au retour, même si plus rien n'est affiché.
  // Montés une seule fois, et retenus tant que la session n'est pas ouverte.
  useSyncTriggers(readyForApp);

  // Le contrôle de version (KL-43), une fois par ouverture d'app. Il attend la
  // **restauration** (migrations puis URL du serveur) : son verdict se lit
  // d'abord en base, et l'appel doit partir vers le serveur appairé, pas vers le
  // défaut de build. Il n'attend en revanche pas d'être **connecté** — un
  // plancher doit se dire à l'écran de connexion aussi, et c'est même là qu'il
  // compte le plus le jour où l'ancien format de synchronisation n'est plus servi.
  const version = useAppVersionCheck(authSettled);

  // Les notifications de repos (KL-31) : gestionnaire global, canaux Android, et
  // purge de ce qui resterait programmé. Ici et pas dans l'écran de séance,
  // parce que le gestionnaire vaut pour l'app entière et qu'une notification
  // orpheline doit être balayée au lancement, pas à la prochaine ouverture d'une
  // séance. Sans condition de session : une notification déjà programmée survit
  // à une déconnexion, elle doit tomber quand même.
  useEffect(() => {
    void initRestNotifications();
  }, []);

  useEffect(() => {
    // On masque aussi en cas d'erreur : une police manquante dégrade
    // l'affichage, elle ne doit pas bloquer l'app sur un démarrage sans fin.
    // Même chose pour la base — mais elle, elle se **dit** (ci-dessous), parce
    // qu'elle porte le réalisé pas encore poussé.
    //
    // La session entre dans la condition pour une autre raison : tant qu'elle
    // est à `unknown`, le garde ci-dessous ne peut que montrer l'écran de
    // connexion. Lever l'écran de démarrage avant elle ferait clignoter cet
    // écran à chaque lancement, y compris pour quelqu'un de connecté.
    if (fontsSettled && dbSettled && authSettled) {
      SplashScreen.hideAsync();
    }
  }, [fontsSettled, dbSettled, authSettled]);

  if (!fontsSettled || !dbSettled || !authSettled) {
    return null;
  }

  if (dbError) {
    return (
      <SafeAreaProvider>
        {/* Sans porte de sortie, et c'est le seul écran de panne qui n'en a
            pas : rien de ce que l'app sait faire ne s'ouvre sans base, et un
            bouton qui ne mènerait nulle part serait pire que pas de bouton. */}
        <Fault
          title="Base locale indisponible"
          body="Les migrations n’ont pas pu s’appliquer. Rien n’a été perdu : le réalisé déjà consigné reste dans le fichier."
          detail={dbError.message}
        />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  // Sous le plancher déclaré par le serveur (KL-43). Le seul écran qui se
  // substitue à l'app entière sans qu'il y ait de panne : ce que cette version
  // écrirait, le serveur ne saurait plus le relire, et laisser dérouler une
  // séance qui ne partira jamais serait pire que l'arrêter ici. Rien n'est perdu
  // pour autant — le réalisé déjà consigné attend dans la base et repartira sous
  // la version suivante.
  //
  // Placé après le garde de base : sans base, c'est l'autre écran qui vaut.
  if (version.status === 'blocked') {
    // Extraite pour que TypeScript la rétrécisse : une propriété d'objet ne se
    // narrow pas dans une fermeture.
    const installUrl = version.installUrl;

    return (
      <SafeAreaProvider>
        <Fault
          title="Mise à jour nécessaire"
          body="Cette version de l’app ne peut plus se synchroniser avec le serveur. Ce qui a déjà été consigné ici est intact et repartira une fois l’app à jour."
          detail={installUrl}
          action={
            installUrl === null
              ? undefined
              : {
                  label: 'Ouvrir la page d’installation',
                  onPress: () => void Linking.openURL(installUrl),
                }
          }
        />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    /*
      La racine des gestes. `react-native-gesture-handler` en a besoin pour
      reconnaître quoi que ce soit — `GestureDetector` **lève** sans elle en
      développement, avec le message qui va bien — et rien ne la montait jusqu'ici
      parce que rien ne s'en servait : la pile d'`expo-router` est une pile
      **native** (`react-native-screens`), qui ne passe pas par la version JS et
      son propre `GestureHandlerRootView`.

      Elle est ici et non dans l'écran qui traîne des exercices, pour la raison
      qui vaut pour tous les fournisseurs de cet écran : montée une fois, elle
      couvre l'app entière, et le prochain geste n'aura rien à réinstaller. Elle
      enveloppe `SafeAreaProvider` plutôt que l'inverse — c'est une `View` qui
      prend toute la place, elle doit être la boîte, pas le contenu.
    */
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          {/*
          Le garde de navigation. `Stack.Protected` retire les écrans de la pile
          au lieu de rendre une redirection : quand un 401 purge la session, la
          pile ne contient plus que `login` et le routeur y retombe seul. C'est
          ce qui rend « un 401 renvoie vers l'écran de connexion » vrai sans
          qu'aucun écran n'ait à intercepter d'erreur.
        */}
          <Stack.Protected guard={readyForApp}>
            {/*
            Les trois destinations de la barre basse — Aujourd'hui, Historique,
            Réglages — vivent dans un seul écran de pile (KL-37). Un groupe
            n'apparaît pas dans l'URL : `/settings` reste `/settings`.
          */}
            <Stack.Screen name="(tabs)" />
            {/*
            Les deux écrans d'une séance. Ils sont déclarés **un par un** parce
            que le garde ne protège que ce qu'il liste : une route oubliée ici
            resterait navigable une fois la session purgée, et celle-ci ouvre le
            réalisé (KL-33).

            Ils sont **empilés par-dessus la barre d'onglets**, pas dedans : une
            séance se déroule en plein écran, et trois onglets sous le pouce y
            disputeraient la place à la seule cible qui compte, valider une
            série. En sortir, c'est revenir, pas changer d'onglet.
          */}
            <Stack.Screen name="session/[uuid]/index" />
            <Stack.Screen name="session/[uuid]/close" />
          </Stack.Protected>

          <Stack.Protected guard={signedIn && session.awaitingFirstSync}>
            <Stack.Screen name="bootstrapping" />
          </Stack.Protected>

          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" />
            <Stack.Screen name="pairing" />
            <Stack.Screen name="login-password" />
          </Stack.Protected>
        </Stack>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Le garde-fou global (KL-38) : ce qui s'affiche quand un rendu lève.
 *
 * `expo-router` enveloppe une route d'une frontière d'erreur React dès qu'elle
 * exporte un `ErrorBoundary`, et une erreur non rattrapée remonte à la frontière
 * **parente la plus proche**. Posé sur la disposition racine, celui-ci couvre
 * donc l'app entière — connexion, onglets, séance en cours — et c'est ce qui rend
 * l'écran blanc impossible : sans lui, React démonte tout l'arbre et laisse le
 * fond de la fenêtre.
 *
 * **La porte de sortie est `retry()`**, que le routeur fournit : elle re-rend la
 * route sans relancer l'app, ce qui suffit dès que l'erreur venait d'un état
 * transitoire. Le repli, lui, ramène à l'écran du jour — parce qu'un rendu qui
 * lève à chaque fois (une séance dont le document est illisible) rejouerait
 * indéfiniment le même échec, et qu'il faut pouvoir en sortir sans désinstaller.
 *
 * Ce qu'il ne couvre pas, et qu'aucune frontière React ne couvre : ce qui lève
 * **hors rendu** — un gestionnaire d'événement, une promesse rejetée. Ceux-là
 * sont déjà pris là où ils naissent (le moteur de synchronisation ne lève jamais,
 * les écritures de séance sont transactionnelles).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <Fault
        title="L’app s’est arrêtée là"
        body="Rien n’est perdu : tout ce qui a été coché est écrit sur cet appareil, et repartira au serveur à la prochaine synchronisation."
        detail={error.message}
        action={{ label: 'Réessayer', onPress: () => void retry() }}
        secondary={{ label: 'Revenir à l’accueil', onPress: () => leaveToToday(retry) }}
      />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

/**
 * Sortir d'un écran en panne.
 *
 * L'ordre compte : on **navigue d'abord**, on re-rend ensuite. `retry()` remonte
 * la route qui vient de lever ; l'appeler sans avoir bougé rejouerait exactement
 * la même erreur. Le `retry` reste indispensable après le `replace` — la
 * frontière ne se réarme pas toute seule, elle rendrait ce même écran de panne
 * au-dessus de la route d'accueil.
 */
function leaveToToday(retry: () => Promise<void>): void {
  router.replace('/');
  void retry();
}

/**
 * Restaure la session et l'URL du serveur, une fois, au démarrage.
 *
 * L'ordre compte : l'URL vient de `sync_state` (posée par le QR, KL-48), donc de
 * la base locale, donc **après** les migrations. Le jeton, lui, vit dans le
 * trousseau et se lirait sans la base — mais rien ne presse, et un seul point de
 * démarrage vaut mieux que deux.
 *
 * C'est le seul endroit de l'app où `@/api` et `@/db` se rencontrent au
 * démarrage : le client HTTP n'a aucune raison d'ouvrir SQLite pour savoir où
 * appeler (cf. `api/baseUrl.ts`).
 */
function useRestoredSession(dbSettled: boolean, dbReady: boolean): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!dbSettled || settled) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (dbReady) {
        const state = await getSyncState();

        if (state?.apiUrl) {
          setApiBaseUrl(state.apiUrl);
        }
      }

      await restoreSession();

      if (!cancelled) {
        setSettled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbSettled, dbReady, settled]);

  return settled;
}

/**
 * La racine des gestes occupe la fenêtre entière. Sans `flex: 1`, elle se
 * réduirait à la hauteur de son contenu et rognerait l'app à sa première mesure.
 */
const styles = StyleSheet.create({
  root: { flex: 1 },
});
