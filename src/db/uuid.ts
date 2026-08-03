import { getRandomValues } from 'expo-crypto';

/**
 * UUIDv7, généré **localement**, à la création (KL-24).
 *
 * ## Pourquoi le client pose les identifiants
 *
 * Une séance se démarre hors réseau, avant que le serveur sache qu'elle existe.
 * C'est l'`uuid` posé ici qui rend `PUT /api/schedule/{uuid}` idempotent : le
 * même document envoyé trois fois donne une séance et un jeu de séries, seul le
 * statut HTTP change. Une file de mutations rejouable ne tient qu'à ça.
 *
 * ## Pourquoi la version 7 et pas `Crypto.randomUUID()`
 *
 * `expo-crypto` ne sait faire que de la v4, purement aléatoire. La v7 préfixe
 * ses 48 premiers bits avec l'horodatage en millisecondes : les identifiants
 * **se trient par le temps**, donc l'ordre d'insertion d'une série est lisible
 * dans sa clé, et l'index de la clé primaire ne se fragmente pas à chaque
 * écriture. Sur une table qui reçoit une ligne toutes les quarante secondes
 * pendant une heure de séance, c'est exactement ce qu'on veut.
 *
 * ## Le compteur monotone, et pourquoi il n'est pas décoratif
 *
 * Deux séries validées dans la même milliseconde (une clôture qui écrit tout un
 * exercice d'un coup, un jeu de démonstration injecté en boucle) auraient le même
 * préfixe temporel et un ordre décidé par 74 bits d'aléa — c'est-à-dire aucun
 * ordre. Les 12 bits `rand_a` servent donc de **compteur** dans la milliseconde
 * courante, initialisé au hasard à chaque nouvelle milliseconde (méthode 2 de la
 * RFC 9562). Il déborde après 4 096 identifiants dans la même milliseconde, et on
 * emprunte alors une milliseconde au futur plutôt que de casser l'ordre.
 *
 * Corollaire : l'horloge du téléphone peut reculer sans produire de doublon ni
 * d'inversion, puisque `lastMs` ne redescend jamais.
 */

/** Dernière milliseconde servie. Ne redescend jamais, même si l'horloge recule. */
let lastMs = 0;
/** Compteur 12 bits dans la milliseconde courante. */
let counter = 0;

/** Table de conversion octet → deux caractères hexadécimaux. */
const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuidv7(): string {
  // 10 octets d'aléa : 2 pour amorcer le compteur, 1 pour l'octet de variante,
  // 7 pour la queue. Un seul appel natif par identifiant.
  const random = getRandomValues(new Uint8Array(10));

  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    // Amorce sur 12 bits, et non 0 : deux appareils qui démarreraient une séance
    // à la même milliseconde ne produiraient sinon pas seulement le même
    // préfixe, mais la même séquence de préfixes.
    counter = ((random[0] << 8) | random[1]) & 0x0fff;
  } else {
    counter = (counter + 1) & 0x0fff;
    if (counter === 0) {
      // Débordement : on emprunte au futur. Perdre l'ordre coûterait plus cher
      // qu'une milliseconde d'avance sur une horloge à laquelle rien ne se fie.
      lastMs += 1;
    }
  }

  const bytes = new Uint8Array(16);

  // 48 bits d'horodatage, gros-boutiste. Découpé en deux parce qu'un décalage
  // binaire JavaScript travaille sur 32 bits : `ms >> 32` rendrait `ms`.
  const high = Math.floor(lastMs / 0x100000000);
  const low = lastMs >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;

  // Version 7 sur les 4 bits hauts, puis les 12 bits du compteur.
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // Variante RFC 4122 sur les 2 bits hauts, puis 62 bits d'aléa.
  bytes[8] = 0x80 | (random[2] & 0x3f);
  for (let i = 9; i < 16; i += 1) {
    bytes[i] = random[i - 6];
  }

  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      out += '-';
    }
    out += HEX[bytes[i]];
  }

  return out;
}

/**
 * Vrai si la chaîne a la forme d'un UUID de version 7.
 *
 * Sert au garde-fou d'entrée, pas à la génération : un `uuid` qui arrive du
 * réseau ou d'un QR n'a aucune raison d'être cru sur parole, et une clé primaire
 * malformée ne se rattrape pas après coup.
 */
export function isUuidv7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
