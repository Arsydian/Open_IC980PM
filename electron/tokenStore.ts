/**
 * @file electron/tokenStore.ts
 * @description Keeps the user's RepeaterBook token on disk encrypted with Electron's safeStorage
 * (Windows DPAPI, macOS Keychain, Linux secret service), as the RepeaterBook API wiki asks
 * distributed apps to "store the user's token locally and securely where possible".
 */

import fs from 'node:fs';
import path from 'node:path';

/** The parts of Electron's `safeStorage` used here. */
export interface TokenCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Longest token accepted from the renderer. */
export const MAX_TOKEN_LENGTH = 512;

/** The saved token, or `''` when there is none or it can't be decrypted. */
export function readToken(file: string, cipher: TokenCipher): string {
  try {
    if (!cipher.isEncryptionAvailable() || !fs.existsSync(file)) return '';
    return cipher.decryptString(fs.readFileSync(file));
  } catch {
    return '';
  }
}

/**
 * Saves `token` encrypted, or deletes the saved one when `token` is blank. Returns `false`, and
 * saves nothing, when the system can't encrypt: the token then lasts only until the app closes.
 */
export function writeToken(file: string, token: string, cipher: TokenCipher): boolean {
  const trimmed = token.trim();
  if (!trimmed) {
    fs.rmSync(file, { force: true });
    return true;
  }
  if (!cipher.isEncryptionAvailable()) return false;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, cipher.encryptString(trimmed));
  fs.renameSync(tmp, file);
  return true;
}
