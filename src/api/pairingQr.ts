/**
 * Lecture de la charge utile du QR d'appairage (KL-48).
 *
 * Format exact posé par le serveur (`docs/api-mobile.md §3.1`), en JSON
 * compact : `{"url":"...","code":"XXXXXXXX","exp":"..."}`. Fonction pure et
 * sans effet de bord à dessein — poser l'URL de base ou échanger le code sont
 * des gestes du client (`auth.ts`, l'écran d'appairage), pas de ce fichier.
 *
 * `exp` n'est **pas** vérifiée ici. La comparer à l'horloge du téléphone
 * ferait dépendre le verdict d'un désaccord d'horloge ; le serveur est déjà la
 * seule autorité sur l'échéance à l'échange (`POST /api/auth/pair`), et
 * inconnu / expiré / déjà consommé rendent le même message par construction.
 */

export type PairingQrPayload = {
  url: string;
  code: string;
  exp: string;
};

/** Un QR lu par la caméra qui n'a pas la forme d'un appairage Kadens. */
export class InvalidPairingQrError extends Error {
  constructor() {
    super('QR non reconnu : ce n’est pas un code d’appairage Kadens.');
    Object.setPrototypeOf(this, InvalidPairingQrError.prototype);

    this.name = 'InvalidPairingQrError';
  }
}

/** Décode et valide la forme de la charge utile. Rejette proprement, ne lève jamais autre chose. */
export function parsePairingQrPayload(raw: string): PairingQrPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidPairingQrError();
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidPairingQrError();
  }

  const { url, code, exp } = parsed as Record<string, unknown>;

  if (typeof url !== 'string' || typeof code !== 'string' || typeof exp !== 'string') {
    throw new InvalidPairingQrError();
  }

  return { url, code, exp };
}
