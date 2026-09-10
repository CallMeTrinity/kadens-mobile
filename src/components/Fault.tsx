/**
 * L'écran de panne (KL-38) — ce qui s'affiche à la place d'un écran blanc.
 *
 * Deux choses le rendent : le garde-fou des migrations locales (base
 * indisponible) et l'`ErrorBoundary` racine (rendu qui a levé). Ce sont les deux
 * seules situations où l'app n'a plus d'écran à montrer, et elles se ressemblent
 * assez pour n'avoir qu'un dessin.
 *
 * ## Ce qu'il doit dire, dans cet ordre
 *
 * 1. **Que le réalisé est en sécurité.** C'est la seule question qui compte
 *    quand une app de suivi casse au milieu d'une séance : ce que j'ai coché,
 *    est-ce que je viens de le perdre ? Non — tout est écrit en base à chaque
 *    geste (KL-32), rien ne vit dans l'état d'un écran.
 * 2. **Une porte de sortie.** Un écran de panne sans bouton est un écran blanc
 *    avec du texte : il faut au moins un geste qui rende la main.
 * 3. **De quoi en parler**, en tout petit. Le message technique n'est là ni pour
 *    être compris ni pour être suivi — il est là pour être recopié le jour où
 *    ça se reproduit. Il ne prend donc ni la couleur de l'échec ni la taille du
 *    reste.
 *
 * ## Le rouge, une seule fois
 *
 * Sur le titre, et nulle part ailleurs. Une panne est un échec, donc
 * `statusMissed` (règle 2) — et non `primary`, qui est l'accent d'une action :
 * les deux partagent leur valeur, pas leur sens.
 */

import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, text, themed, useStyles } from '@/theme';
import { Button, type ButtonProps } from './Button';

export type FaultProps = {
  /** Ce qui est cassé, en trois mots. */
  title: string;
  /** Ce que ça implique pour les données de l'appareil. Une à deux phrases. */
  body: string;
  /** Le message brut, s'il y en a un. Rendu à l'encre faible, jamais en rouge. */
  detail?: string | null;
  /** La porte de sortie. Une seule : un écran de panne n'est pas un menu. */
  action?: Pick<ButtonProps, 'label' | 'onPress'>;
  /** Le repli, quand la porte de sortie peut elle-même échouer. */
  secondary?: Pick<ButtonProps, 'label' | 'onPress'>;
  testID?: string;
};

export function Fault({ title, body, detail, action, secondary, testID }: FaultProps) {
  const styles = useStyles(sheets);
  // Cet écran n'a pas d'en-tête : personne d'autre ne porte ses zones sûres, et
  // il n'a qu'un rendu — une page qui défile — donc il les prend en dégagement
  // de contenu, aux deux bouts (`components/Header.tsx`).
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen} testID={testID}>
      {/* Il défile : sur un petit écran, un message technique de trois lignes
          pousserait sinon la porte de sortie hors de vue — et c'est exactement
          l'écran où il ne faut pas que ça arrive. */}
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: space[8] + insets.top, paddingBottom: space[8] + insets.bottom },
        ]}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>

        {action ? <Button block {...action} /> : null}
        {secondary ? <Button variant="ghost" block {...secondary} /> : null}

        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </ScrollView>
    </View>
  );
}

const sheets = themed((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space[8], gap: space[6] },
  title: { ...text.sectionTitle, color: c.primaryOnTint },
  body: { ...text.body, color: c.textSecondary },
  detail: { ...text.caption, color: c.textSecondary },
}));
