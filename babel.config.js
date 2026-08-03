// Le préréglage d'Expo, plus un seul ajout : `inline-import` incorpore les
// fichiers `.sql` des migrations dans le bundle sous forme de chaînes. Sans lui,
// le `migrations.js` généré par drizzle-kit importerait des fichiers que Metro ne
// sait pas résoudre, et l'app tomberait au démarrage — pas à la compilation.
//
// Ce fichier n'existait pas avant KL-24 : Expo applique son préréglage par défaut
// tant qu'aucun `babel.config.js` n'est présent. En le créant, il faut donc
// redéclarer `babel-preset-expo` explicitement.
module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
