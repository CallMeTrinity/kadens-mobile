/**
 * L'échelle du ressenti (`ScaleSelector`), vérifiée au rendu.
 *
 * Trois promesses à tenir pour la main qui la remplit en fin de séance :
 * une case par cran, deux rangées au-delà de cinq ; le cran choisi se dit en
 * toutes lettres sous l'échelle ; et TalkBack annonce chaque case avec sa
 * valeur, son maximum et son libellé, en radio cochée ou non.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScaleSelector } from '@/components';
import { effortLabel } from '@/session';

describe('ScaleSelector', () => {
  it('rend une case par cran et dit ce que vaut chacune', async () => {
    await render(
      <ScaleSelector
        testID="effort"
        label="À quel point c’était dur ?"
        max={10}
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
    // Rien de choisi : les bornes tiennent la place du libellé.
    expect(screen.getByText('Très léger')).toBeTruthy();
    expect(screen.getByText('Maximal')).toBeTruthy();
  });

  it('remonte le cran tapé et écrit celui qui est retenu', async () => {
    const onChange = jest.fn();
    await render(
      <ScaleSelector
        testID="effort"
        label="À quel point c’était dur ?"
        max={10}
        value={7}
        onChange={onChange}
        describe={effortLabel}
      />,
    );

    expect(screen.getByText('7 · Difficile')).toBeTruthy();
    expect(screen.getByTestId('effort-7').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('effort-3').props.accessibilityState).toEqual({ checked: false });

    await fireEvent.press(screen.getByTestId('effort-9'));

    expect(onChange).toHaveBeenCalledWith(9);
  });
});
