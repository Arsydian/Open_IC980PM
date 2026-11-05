/**
 * @file tests/tokenStore.test.ts
 * @description The RepeaterBook token kept encrypted on disk (`electron/tokenStore.ts`), with a
 * stand-in for Electron's safeStorage.
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

/** Stand-in for safeStorage: reverses and base64-encodes, so the file never holds the token as is. */
const cipher = (available = true): TokenCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from([...text].reverse().join(''), 'utf-8').toString('base64') as unknown as Buffer,
  decryptString: (data) => {
    const text = Buffer.from(data.toString(), 'base64').toString('utf-8');
    if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('cannot decrypt');
    return [...text].reverse().join('');
  },
});

describe('RepeaterBook token store', () => {
  it('saves the token encrypted, trimmed, and reads it back', () => {
    expect(writeToken(file, '  rbuapp_secret123 ', cipher())).toBe(true);
    expect(readFileSync(file, 'utf-8')).not.toContain('rbuapp_secret123');
    expect(readToken(file, cipher())).toBe('rbuapp_secret123');
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('deletes the saved token when it is cleared', () => {
    writeToken(file, 'rbuapp_secret123', cipher());
    expect(writeToken(file, '   ', cipher())).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(readToken(file, cipher())).toBe('');
  });

  it('saves nothing when the system cannot encrypt, rather than writing plain text', () => {
    expect(writeToken(file, 'rbuapp_secret123', cipher(false))).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('reads nothing from a missing or undecryptable file', () => {
    expect(readToken(file, cipher())).toBe('');
    writeFileSync(file, Buffer.from([0xff, 0x00, 0x13]));
    expect(readToken(file, cipher())).toBe('');
  });
});
