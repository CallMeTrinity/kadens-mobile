/**
 * Le bandeau hors ligne, vérifié au rendu (KL-38).
 *
 * C'est le second composant du dépôt monté par un test, et pour la même raison
 * que `NumberStepper` : ce qu'il porte n'est pas de la mise en page mais une
 * règle — **il informe, il n'alerte pas**. Trois choses s'y vérifient et nulle
 * part ailleurs :
 *
 * - il distingue « pas de réseau » de « serveur qui ne répond pas » ;
 * - il dit ce qui attend, au pluriel juste, ou rassure quand rien n'attend ;
 * - il ne s'annonce pas comme une alerte à TalkBack, et n'offre aucune cible.
 */

import { render, screen } from '@testing-library/react-native';

import { OfflineBanner } from '@/components';

describe('OfflineBanner', () => {
  it('distingue l’absence de réseau du serveur muet', async () => {
    const view = await render(<OfflineBanner disconnected pending={0} />);

    expect(screen.getByText('Hors réseau')).toBeTruthy();

    await view.rerender(<OfflineBanner disconnected={false} pending={0} />);

    expect(screen.getByText('Serveur injoignable')).toBeTruthy();
  });

  it('rassure quand rien n’attend, et compte quand quelque chose attend', async () => {
    const view = await render(<OfflineBanner disconnected pending={0} />);

    expect(screen.getByText('Tout est écrit sur cet appareil.')).toBeTruthy();

    await view.rerender(<OfflineBanner disconnected pending={1} />);

    expect(screen.getByText('1 séance repartira au retour du réseau.')).toBeTruthy();

    await view.rerender(<OfflineBanner disconnected pending={3} />);

    expect(screen.getByText('3 séances repartiront au retour du réseau.')).toBeTruthy();
  });

  it('informe sans alerter et sans rien offrir à toucher', async () => {
    await render(<OfflineBanner disconnected pending={2} testID="offline" />);

    const banner = screen.getByTestId('offline');

    // `polite` : annoncé quand TalkBack a fini sa phrase, jamais en coupant la
    // lecture d'une série. Et surtout pas le rôle `alert`, qui promettrait une
    // urgence qu'un sous-sol de salle de sport n'a pas.
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(banner.props.accessibilityRole).toBeUndefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
