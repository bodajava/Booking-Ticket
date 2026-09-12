import { randomInt } from "node:crypto";

/**
 * Crockford-style alphabet: no 0/O or 1/I, so a PNR read aloud at a check-in
 * desk cannot be transcribed ambiguously. 32 symbols ^ 6 = ~1.07e9 codes.
 */
const PNR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const PNR_LENGTH = 6;

/** Cryptographically random, uniformly distributed 6-character PNR. */
export function generatePnr(): string {
  let pnr = "";
  for (let i = 0; i < PNR_LENGTH; i++) {
    pnr += PNR_ALPHABET[randomInt(PNR_ALPHABET.length)];
  }
  return pnr;
}
