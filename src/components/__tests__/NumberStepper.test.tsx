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
 * - **la frappe ne remonte pas au parent** tant que le champ est édité — sans
 *   quoi « 82, » serait impossible à taper, la valeur étant réécrite sous les
 *   doigts ;
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

  it('ne remonte rien tant que le champ est en cours de frappe', async () => {
    const onChange = jest.fn();

    await render(<NumberStepper testID="charge" value={80} onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId('charge-input'), '82,');

    // « 82, » ne fait pas un nombre : convertir à chaque frappe rendrait la
    // virgule impossible à taper.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('charge-input').props.value).toBe('82,');

    await fireEvent.changeText(screen.getByTestId('charge-input'), '82,5');
    await fireEvent(screen.getByTestId('charge-input'), 'blur');

    expect(onChange).toHaveBeenCalledWith(82.5);
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
