/**
 * @file src/core/passwordCipher.ts
 * @description Clean-room implementation of the HIROYASU IC-980 Pro Max 16-byte EEPROM `0x16000`
 * password encryption (`sub_4271E0`) and decryption (`sub_4272CC`) algorithms.
 * Verified from `HIROYASU IC-980 Pro Max full english.exe` (`0x004271E0` - `0x0042736C`).
 */

/**
 * 10x6 permutation matrix at `0x0052ACFC` used by `sub_4271E0` and `sub_4272CC`.
 * Each row `k` (`0..9`) is a bijection on `{0, 1, 2, 3, 4, 5}`.
 */
const PERMUTATION_MATRIX_10X6: readonly (readonly [number, number, number, number, number, number])[] = [
  [2, 5, 0, 4, 1, 3],
  [4, 1, 3, 0, 5, 2],
  [1, 4, 5, 2, 3, 0],
  [5, 0, 2, 3, 4, 1],
  [3, 2, 4, 1, 0, 5],
  [0, 3, 1, 5, 2, 4],
  [4, 5, 3, 1, 2, 0],
  [2, 1, 5, 4, 0, 3],
  [5, 3, 0, 2, 1, 4],
  [1, 0, 4, 3, 5, 2],
];

/**
 * 10x9 filler pad table at `0x0052AB68` for `output[7..15]`.
 */
const PAD_FILLER_9 = '937184625';

/**
 * Encrypts a 6-digit ASCII password (`"000000"`..`"999999"`) into the 16-byte block
 * written to Radio EEPROM `0x16000..0x1600F` (`sub_4271E0`).
 *
 * If the password is empty or unconfigured, returns 16 bytes of `0xFF` (factory unlocked state).
 *
 * @param password6 - 6-character numeric password string
 * @returns 16-byte encrypted EEPROM block
 */
export function encryptRadioPassword(password6: string): Uint8Array {
  const out = new Uint8Array(16);
  const trimmed = password6.trim();

  if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
    out.fill(0xff);
    return out;
  }

  // Compute sum of the 6 digits modulo 10 to select permutation row k (0..9)
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    sum += trimmed.charCodeAt(i) - 0x30;
  }
  const k = ((sum % 10) + 10) % 10;
  const perm = PERMUTATION_MATRIX_10X6[k];

  // Permute the 6 password bytes into out[0..5]
  for (let i = 0; i < 6; i++) {
    out[i] = trimmed.charCodeAt(perm[i]);
  }

  // Store row selector digit '0' + k at out[6]
  out[6] = 0x30 + k;

  // Populate deterministic filler pad bytes at out[7..15]
  for (let i = 0; i < 9; i++) {
    out[7 + i] = PAD_FILLER_9.charCodeAt((i + k) % 9);
  }

  // Apply position-dependent affine shift: out[i] += (i * 2 + 1)
  for (let i = 0; i < 16; i++) {
    out[i] = (out[i] + (i * 2 + 1)) & 0xff;
  }

  return out;
}

/**
 * Decrypts a 16-byte block read from Radio EEPROM `0x16000..0x1600F` (`sub_4272CC`)
 * back into the 6-digit ASCII password string.
 *
 * Returns `""` if the block is unprogrammed (`0xFF` or `0x00` or invalid selector).
 *
 * @param cipher16 - 16-byte EEPROM buffer from `0x16000..0x1600F`
 * @returns 6-digit ASCII password or `""` if unlocked
 */
export function decryptRadioPassword(cipher16: Uint8Array): string {
  if (cipher16.byteLength < 16) {
    return '';
  }

  // Check if all 0xFF or all 0x00 (unprogrammed / unlocked radio)
  const allFF = cipher16.subarray(0, 16).every((b) => b === 0xff);
  const allZero = cipher16.subarray(0, 16).every((b) => b === 0x00);
  if (allFF || allZero) {
    return '';
  }

  // Undo affine shift: plain[i] = cipher[i] - (i * 2 + 1)
  const plain = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    plain[i] = (cipher16[i] - (i * 2 + 1)) & 0xff;
  }

  const k = plain[6] - 0x30;
  if (k < 0 || k > 9) {
    return '';
  }

  const perm = PERMUTATION_MATRIX_10X6[k];
  const recovered = new Array<string>(6).fill('0');
  for (let i = 0; i < 6; i++) {
    const chCode = plain[i];
    if (chCode < 0x30 || chCode > 0x39) {
      return '';
    }
    recovered[perm[i]] = String.fromCharCode(chCode);
  }

  return recovered.join('');
}
