/**
 * @file electron/tokenStore.ts
 * @description Keeps the user's RepeaterBook token on disk encrypted with Electron's safeStorage
 * (Windows DPAPI, macOS Keychain, Linux secret service), as the RepeaterBook API wiki asks
 * distributed apps to "store the user's token locally and securely where possible".
 */

import fs from 'node:fs';
import path from 'node:path';

/** The parts of Electron's asynchronous `safeStorage` API used here (the synchronous one is deprecated). */
export interface TokenCipher {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(plainText: string): Promise<Buffer>;
  decryptString(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/** Longest token accepted from the renderer. */
export const MAX_TOKEN_LENGTH = 512;

/**
 * The saved token, or `''` when there is none or it can't be decrypted. Re-encrypts it when
 * safeStorage reports that its key has changed.
 */
export async function readToken(file: string, cipher: TokenCipher): Promise<string> {
  try {
    if (!fs.existsSync(file) || !(await cipher.isEncryptionAvailable())) return '';
    const { result, shouldReEncrypt } = await cipher.decryptString(fs.readFileSync(file));
    if (shouldReEncrypt) await writeToken(file, result, cipher);
    return result;
  } catch {
    return '';
  }
}

/**
 * Saves `token` encrypted, or deletes the saved one when `token` is blank. Resolves `false`, and
 * saves nothing, when the system can't encrypt: the token then lasts only until the app closes.
 */
export async function writeToken(file: string, token: string, cipher: TokenCipher): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    fs.rmSync(file, { force: true });
    return true;
  }
  if (!(await cipher.isEncryptionAvailable())) return false;

  const encrypted = await cipher.encryptString(trimmed);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, encrypted);
  fs.renameSync(tmp, file);
  return true;
}
