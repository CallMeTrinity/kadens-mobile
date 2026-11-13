/**
 * Les deux échelles du ressenti, vérifiées au rendu : les bonhommes de la forme
 * (`FeelingSelector`) et l'escalier de la difficulté (`EffortSelector`).
 *
 * Trois promesses à tenir pour la main qui les remplit en fin de séance : une
 * cible par cran ; le cran choisi se dit en toutes lettres, pas seulement en
 * couleur ; et TalkBack annonce chaque cran avec sa valeur, son maximum et son
 * libellé, en radio cochée ou non.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { EffortSelector, FeelingSelector } from '@/components';
import { effortLabel, feelingLabel } from '@/session';

describe('FeelingSelector', () => {
  it('rend un bonhomme par cran et dit ce que vaut chacun', async () => {
    await render(
      <FeelingSelector
        testID="feeling"
        label="Comment tu t’es senti ?"
        value={null}
        onChange={jest.fn()}
        describe={feelingLabel}
        ends={['Très faible', 'Très en forme']}
      />,
    );

    for (let level = 1; level <= 5; level += 1) {
      expect(screen.getByTestId(`feeling-${level}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('4 sur 5, En forme')).toBeTruthy();
    // Rien de choisi : les bornes tiennent la place du libellé.
    expect(screen.getByText('Très faible')).toBeTruthy();
    expect(screen.getByText('Très en forme')).toBeTruthy();
  });

  it('remonte le cran tapé et écrit celui qui est retenu', async () => {
    const onChange = jest.fn();
    await render(
      <FeelingSelector
        testID="feeling"
        label="Comment tu t’es senti ?"
        value={4}
        onChange={onChange}
        describe={feelingLabel}
      />,
    );

    expect(screen.getByText('4 · En forme')).toBeTruthy();
    expect(screen.getByTestId('feeling-4').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('feeling-2').props.accessibilityState).toEqual({ checked: false });

    await fireEvent.press(screen.getByTestId('feeling-1'));

    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe('EffortSelector', () => {
  it('rend dix marches, chacune annoncée avec son palier', async () => {
    await render(
      <EffortSelector
        testID="effort"
        label="À quel point c’était dur ?"
        value={null}
        onChange={jest.fn()}
        describe={effortLabel}
        ends={['Très léger', 'Maximal']}
      />,
    );

    for (let step = 1; step <= 10; step += 1) {
      expect(screen.getByTestId(`effort-${step}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('7 sur 10, Difficile')).toBeTruthy();
    // Rien de choisi : un tiret à la place du chiffre, pas de palier.
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('Difficile')).toBeNull();
  });

  it('écrit le chiffre et le palier retenus, et remonte la marche tapée', async () => {
    const onChange = jest.fn();
    await render(
      <EffortSelector
        testID="effort"
        label="À quel point c’était dur ?"
        value={7}
        onChange={onChange}
        describe={effortLabel}
        ends={['Très léger', 'Maximal']}
      />,
    );

    expect(screen.getByText('Difficile')).toBeTruthy();
    expect(screen.getByTestId('effort-7').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('effort-3').props.accessibilityState).toEqual({ checked: false });

    await fireEvent.press(screen.getByTestId('effort-9'));

    expect(onChange).toHaveBeenCalledWith(9);
  });
});
