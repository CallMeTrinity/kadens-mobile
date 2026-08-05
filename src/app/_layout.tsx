import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { restoreSession, setApiBaseUrl, useSession } from '@/api';
import { Fault } from '@/components';
import { getSyncState, useDatabaseMigrations } from '@/db';
import { initRestNotifications } from '@/session';
import { useSyncTriggers } from '@/sync';
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

  return (
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
