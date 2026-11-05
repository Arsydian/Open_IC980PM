/**
 * @file tests/tokenStore.test.ts
 * @description The RepeaterBook token kept encrypted on disk (`electron/tokenStore.ts`), with a
 * stand-in for Electron's asynchronous safeStorage API.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readToken, writeToken, type TokenCipher } from '../electron/tokenStore';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ic980-token-'));
  file = join(dir, 'repeaterbook-token.bin');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Stand-in for safeStorage: reverses and base64-encodes under a key version, so the file never
 * holds the token as is. Data under an older key version decrypts with `shouldReEncrypt`.
 */
const cipher = (available = true, keyVersion = 'v2'): TokenCipher => ({
  isEncryptionAvailable: async () => available,
  encryptString: async (text) =>
    Buffer.from(`${keyVersion}:${Buffer.from([...text].reverse().join('')).toString('base64')}`),
  decryptString: async (data) => {
    const [version, body] = data.toString().split(':');
    const text = Buffer.from(body ?? '', 'base64').toString('utf-8');
    if (!/^v\d$/.test(version) || !/^[\x20-\x7e]+$/.test(text)) throw new Error('cannot decrypt');
    return { result: [...text].reverse().join(''), shouldReEncrypt: version !== keyVersion };
  },
});

describe('RepeaterBook token store', () => {
  it('saves the token encrypted, trimmed, and reads it back', async () => {
    await expect(writeToken(file, '  rbuapp_secret123 ', cipher())).resolves.toBe(true);
    expect(readFileSync(file, 'utf-8')).not.toContain('rbuapp_secret123');
    await expect(readToken(file, cipher())).resolves.toBe('rbuapp_secret123');
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('re-encrypts the saved token when the key has changed', async () => {
    await writeToken(file, 'rbuapp_secret123', cipher(true, 'v1'));
    await expect(readToken(file, cipher(true, 'v2'))).resolves.toBe('rbuapp_secret123');
    expect(readFileSync(file, 'utf-8').startsWith('v2:')).toBe(true);
  });

  it('deletes the saved token when it is cleared', async () => {
    await writeToken(file, 'rbuapp_secret123', cipher());
    await expect(writeToken(file, '   ', cipher())).resolves.toBe(true);
    expect(existsSync(file)).toBe(false);
    await expect(readToken(file, cipher())).resolves.toBe('');
  });

  it('saves nothing when the system cannot encrypt, rather than writing plain text', async () => {
    await expect(writeToken(file, 'rbuapp_secret123', cipher(false))).resolves.toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('reads nothing from a missing or undecryptable file', async () => {
    await expect(readToken(file, cipher())).resolves.toBe('');
    writeFileSync(file, Buffer.from([0xff, 0x00, 0x13]));
    await expect(readToken(file, cipher())).resolves.toBe('');
  });
});
