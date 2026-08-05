// KL-41 — ce que le stub `@expo/ui` doit supporter.
//
// Les cas testés ne sont pas inventés : ce sont les usages réellement présents
// dans `expo-router`, relevés dans les huit fichiers qui importent `@expo/ui`
// (`grep -rl "@expo/ui" node_modules/expo-router/build`). Le premier est celui
// qui a fait tomber l'app après le premier rebuild post-KL-41 : un appel **au
// chargement du module**, hors de tout composant.
//
// Si une montée d'`expo-router` ajoute un usage d'une autre forme, c'est ici
// qu'il faut le rejouer avant de reconstruire.

const stub = require('../expo-ui');

describe('stub @expo/ui', () => {
  let warn;

  beforeEach(() => {
    jest.resetModules();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("ne jette pas sur un modifier construit au chargement d'un module", () => {
    // StackToolbarView/native.android.js:10
    //   const bottomPlacementModifiers = [(0, modifiers.fillMaxHeight)()];
    expect(() => [stub.fillMaxHeight()]).not.toThrow();
  });

  it('ne jette pas sur les modifiers appelés avec des nombres', () => {
    // toolbar/native.android.js : padding(0, 0, 0, insets.bottom), height(64)
    expect(() => [stub.fillMaxWidth(), stub.padding(0, 0, 0, 24), stub.height(64)]).not.toThrow();
  });

  it('laisse enchaîner les fabriques de transitions', () => {
    // toolbar/AnimatedItemContainer.android.js
    //   EnterTransition.scaleIn().plus(EnterTransition.expandIn())
    expect(() =>
      stub.EnterTransition.scaleIn().plus(stub.EnterTransition.expandIn()),
    ).not.toThrow();
  });

  it('rend null et avertit une seule fois quand un composant est rendu pour de bon', () => {
    // Le cas que le stub ne peut pas satisfaire : `Host`, `Box`… rendus par React.
    expect(stub.Host({ matchContents: true, children: null })).toBeNull();
    expect(stub.Box({ contentAlignment: 'center' })).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/KL-41/);
  });

  it("expose __esModule pour l'interop Babel et rien pour les symboles", () => {
    expect(stub.__esModule).toBe(true);
    expect(stub[Symbol.iterator]).toBeUndefined();
  });
});
