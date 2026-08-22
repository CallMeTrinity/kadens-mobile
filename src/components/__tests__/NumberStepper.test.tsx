/**
 * Le compteur (`NumberStepper`), vérifié au rendu (KL-36).
 *
 * C'est le seul composant du dépôt qui porte de la logique plutôt que de la
 * mise en page, et cette logique est celle de la saisie **en salle** : on ne
 * tape pas au clavier, on appuie ; quand on tape quand même, c'est un clavier
 * français, donc une virgule.
 *
 * Trois choses s'y vérifient et nulle part ailleurs :
 *
 * - **la frappe remonte au parent, l'affichage non** : le nombre part à chaque
 *   frappe qui se lit — sans quoi « 12 » suivi d'un appui sur « Valider »
 *   validerait la valeur d'avant — mais le texte reste tel quel à l'écran, sans
 *   quoi « 82, » serait impossible à taper ;
 * - **les bornes s'appliquent à la saisie directe** comme au pas ;
 * - **le bouton dit ce qu'il fait** : `accessibilityLabel` porte le pas et
 *   l'unité, c'est ce que TalkBack annonce à quelqu'un qui ne voit pas l'écran.
 *
 * C'est aussi ce qui prouve que `@testing-library/react-native` est branché.
 * Rappel de sa version 14, qui surprend au premier essai : `render` et
 * `fireEvent` sont **asynchrones**, et les oublier ne donne pas un test qui
 * échoue à l'assertion mais un `screen` vide.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { NumberStepper } from '@/components';

describe('NumberStepper', () => {
  it('affiche la valeur à la française et annonce ce que font ses boutons', async () => {
    await render(<NumberStepper testID="charge" value={82.5} onChange={jest.fn()} unit="kg" />);

    expect(screen.getByTestId('charge-input').props.value).toBe('82,5');
    expect(screen.getByLabelText('Ajouter 2,5 kg')).toBeTruthy();
    expect(screen.getByLabelText('Retirer 2,5 kg')).toBeTruthy();
  });

  it('avance et recule d’un pas', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={80} step={2.5} onChange={onChange} />);

    await fireEvent.press(screen.getByTestId('charge-plus'));

    expect(onChange).toHaveBeenLastCalledWith(82.5);

    await fireEvent.press(screen.getByTestId('charge-minus'));

    // Le pas repart de la valeur du parent, qui n'a pas encore été re-rendue.
    expect(onChange).toHaveBeenLastCalledWith(80);
  });

  it('remonte la valeur à la frappe, sans réécrire ce qui est tapé', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={80} onChange={onChange} />);

    await fireEvent(screen.getByTestId('charge-input'), 'focus');
    await fireEvent.changeText(screen.getByTestId('charge-input'), '12');

    // Le parent sait déjà : « 12 » puis un appui sur « Valider » doit valider
    // 12, et sur Android cet appui ne relâche pas forcément le champ.
    expect(onChange).toHaveBeenLastCalledWith(12);
    // Ce qui est affiché reste ce qui est tapé : la valeur ne se réécrit pas
    // sous les doigts.
    expect(screen.getByTestId('charge-input').props.value).toBe('12');
  });

  it('laisse taper la virgule sans réécrire le champ', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={80} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('charge-input'), '82,');

    // « 82, » se lit 82 — le nombre part — mais le texte reste « 82, » : le
    // convertir à l'affichage rendrait la virgule impossible à taper.
    expect(onChange).toHaveBeenLastCalledWith(82);
    expect(screen.getByTestId('charge-input').props.value).toBe('82,');

    await fireEvent.changeText(screen.getByTestId('charge-input'), '82,5');

    expect(onChange).toHaveBeenLastCalledWith(82.5);
  });

  it('repart d’un champ vide à la prise de focus, sans perdre le premier chiffre', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={20} onChange={onChange} />);

    await fireEvent(screen.getByTestId('charge-input'), 'focus');

    // Le champ se vide en JavaScript. La version d'avant s'en remettait à
    // `selectTextOnFocus`, dont Android pose la sélection **après** la première
    // frappe : le chiffre suivant l'écrasait, et « 80 » saisi donnait « 0 »
    // (KL-39). La valeur en place reste lisible derrière, en invite.
    expect(screen.getByTestId('charge-input').props.value).toBe('');
    expect(screen.getByTestId('charge-input').props.placeholder).toBe('20');

    await fireEvent.changeText(screen.getByTestId('charge-input'), '8');
    await fireEvent.changeText(screen.getByTestId('charge-input'), '80');
    await fireEvent(screen.getByTestId('charge-input'), 'blur');

    expect(onChange).toHaveBeenCalledWith(80);
  });

  it('repart de ce qui est tapé quand un pas arrive avant le relâchement', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={20} step={2.5} onChange={onChange} />);

    await fireEvent(screen.getByTestId('charge-input'), 'focus');
    await fireEvent.changeText(screen.getByTestId('charge-input'), '80');
    await fireEvent.press(screen.getByTestId('charge-plus'));

    // Sur Android, appuyer sur un bouton ne relâche pas forcément le champ : le
    // brouillon serait resté en suspens et le pas serait parti de 20.
    expect(onChange).toHaveBeenLastCalledWith(82.5);
  });

  it('revient à la valeur en place quand la saisie est illisible', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={80} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('charge-input'), '');
    await fireEvent(screen.getByTestId('charge-input'), 'blur');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('charge-input').props.value).toBe('80');
  });

  it('ramène une saisie directe dans les bornes', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="reps" value={8} min={0} max={200} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('reps-input'), '900');
    await fireEvent(screen.getByTestId('reps-input'), 'submitEditing');

    expect(onChange).toHaveBeenCalledWith(200);
  });

  it('désactive le bouton qui sortirait des bornes', async () => {
    await render(<NumberStepper testID="reps" value={0} min={0} onChange={jest.fn()} />);

    expect(screen.getByTestId('reps-minus').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
