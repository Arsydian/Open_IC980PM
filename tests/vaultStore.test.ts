/**
 * @file tests/vaultStore.test.ts
 * @description Electron Rollback Vault file storage (`electron/vaultStore.ts`).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VAULT_SNAPSHOTS, readVaultFile, writeVaultFile } from '../electron/vaultStore';

let dir: string;
let vault: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ic980-vault-'));
  vault = join(dir, 'rollback-vault.json');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const snap = (id: string) => ({ id, timestamp: '2026-10-28T00:00:00Z' });

describe('Rollback Vault file', () => {
  it('round-trips snapshots, keeps the newest 50 and leaves no temp file', () => {
    const many = Array.from({ length: MAX_VAULT_SNAPSHOTS + 5 }, (_, i) => snap(`s${i}`));
    writeVaultFile(vault, many);
    const read = readVaultFile(vault) as Array<{ id: string }>;
    expect(read).toHaveLength(MAX_VAULT_SNAPSHOTS);
    expect(read[0].id).toBe('s0');
    expect(existsSync(`${vault}.tmp`)).toBe(false);
  });

  it('keeps the previous good file as .bak on each write', () => {
    writeVaultFile(vault, [snap('first')]);
    writeVaultFile(vault, [snap('second'), snap('first')]);
    expect(JSON.parse(readFileSync(`${vault}.bak`, 'utf-8'))).toEqual([snap('first')]);
  });

  it('loads the backup instead of an empty vault when the file is corrupt, and keeps the corrupt file', () => {
    writeVaultFile(vault, [snap('a')]);
    writeVaultFile(vault, [snap('b'), snap('a')]);
    writeFileSync(vault, '[{"id": "b", "timest'); // interrupted write left a truncated file

    expect(readVaultFile(vault)).toEqual([snap('a')]);
    const quarantined = readdirSync(dir).filter((f) => f.startsWith('rollback-vault.json.corrupt-'));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dir, quarantined[0]), 'utf-8')).toBe('[{"id": "b", "timest');

    // The next save starts from the recovered backup and does not touch the quarantined file.
    writeVaultFile(vault, [snap('c'), snap('a')]);
    expect(readVaultFile(vault)).toEqual([snap('c'), snap('a')]);
    expect(readFileSync(join(dir, quarantined[0]), 'utf-8')).toBe('[{"id": "b", "timest');
  });

  it('ignores a temp file left by a crash before the rename', () => {
    writeVaultFile(vault, [snap('safe')]);
    writeFileSync(`${vault}.tmp`, '[{"id": "half');
    expect(readVaultFile(vault)).toEqual([snap('safe')]);
  });

  it('returns an empty vault when nothing has been saved yet', () => {
    expect(readVaultFile(vault)).toEqual([]);
  });
});
