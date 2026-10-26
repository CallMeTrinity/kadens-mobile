/**
 * Un message programmé (un anniversaire, un Joyeux Noël) : un GIF et un mot,
 * dans une feuille, montré une fois sur l'écran Aujourd'hui.
 *
 * L'image passe par `expo-image` et pas par l'`Image` de React Native : sur
 * Android, celle-ci ne joue un GIF qu'avec Fresco animé, désactivé dans le build
 * (`expo.gif.enabled`). L'URL est signée côté serveur, elle se charge sans
 * jeton ; le cache disque la garde pour un jour J hors réseau.
 *
 * Le texte est du contenu saisi : Barlow, casse normale (règle 4). Le titre de
 * la feuille est écrit par l'app, il reste en condensé capitales.
 */

import { Image } from 'expo-image';
import { Text } from 'react-native';

import { space, text, themed, useStyles } from '@/theme';

import { Sheet } from './Sheet';

export type MessageSheetProps = {
  visible: boolean;
  body: string;
  mediaUrl: string | null;
  /** Toute fermeture vaut « vu » : croix, voile, bouton retour. */
  onClose: () => void;
};

/**
 * Met en cache disque les images des messages à venir, tant qu'il y a du réseau :
 * le jour J, la feuille les retrouve même dans un sous-sol. Un échec n'est pas
 * une erreur, la feuille retentera au moment de s'ouvrir.
 */
export function prefetchMessageMedia(urls: string[]): void {
  if (urls.length > 0) {
    Image.prefetch(urls, 'disk').catch(() => undefined);
  }
}

export function MessageSheet({ visible, body, mediaUrl, onClose }: MessageSheetProps) {
  const styles = useStyles(sheets);

  return (
    <Sheet visible={visible} onClose={onClose} title="Un mot pour toi" testID="message-sheet">
      {mediaUrl ? (
        <Image
          source={{ uri: mediaUrl }}
          style={styles.media}
          contentFit="contain"
          cachePolicy="disk"
          accessible={false}
        />
      ) : null}
      <Text style={styles.body}>{body}</Text>
    </Sheet>
  );
}

const sheets = themed((c) => ({
  media: { width: '100%', height: 240, backgroundColor: c.fill },
  body: { ...text.body, color: c.text, marginTop: space[2] },
}));
