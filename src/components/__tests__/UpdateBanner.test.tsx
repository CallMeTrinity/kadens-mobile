/**
 * Le bandeau de mise à jour, vérifié au rendu (KL-43).
 *
 * Il ressemble au bandeau hors ligne et n'en partage pourtant pas la règle : ce
 * dernier n'offre **rien** à toucher parce qu'il n'y a rien à faire, celui-ci
 * doit être une cible parce qu'il y a une page à ouvrir. C'est la seule
 * différence, et c'est ce qui se vérifie ici — avec la hauteur tactile, sans
 * laquelle une bande d'une ligne ne se vise pas debout.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { UpdateBanner } from '@/components';
import { layout } from '@/theme';

describe('UpdateBanner', () => {
  it('nomme la version quand il la connaît, et reste lisible sinon', async () => {
    const view = await render(<UpdateBanner versionName="1.2.0" onPress={() => {}} />);

    expect(screen.getByText('La version 1.2.0 est publiée.')).toBeTruthy();

    await view.rerender(<UpdateBanner versionName={null} onPress={() => {}} />);

    expect(screen.getByText('Une version plus récente est publiée.')).toBeTruthy();
  });

  it('ouvre la page d’installation quand on le touche', async () => {
    const onPress = jest.fn();

    await render(<UpdateBanner versionName="1.2.0" onPress={onPress} testID="update" />);
    await fireEvent.press(screen.getByTestId('update'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('est une cible, à la hauteur tactile, et n’alerte pas', async () => {
    await render(<UpdateBanner versionName="1.2.0" onPress={() => {}} testID="update" />);

    const banner = screen.getByTestId('update');

    expect(banner.props.accessibilityRole).toBe('button');
    // Une bande d'une ligne ne se vise pas debout, les mains moites : la cible
    // fait la hauteur tactile, comme tout ce qui se touche dans l'app (KL-39).
    expect(StyleSheet.flatten(banner.props.style)).toMatchObject({
      minHeight: layout.touchTarget,
    });
    // Comme le bandeau hors ligne : annoncé quand TalkBack a fini sa phrase. Une
    // version publiée n'est pas une urgence.
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });
});
