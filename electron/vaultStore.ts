/**
 * @file electron/vaultStore.ts
 * @description Rollback Vault file storage for the Electron main process. Writes go to a temp file
 * that is flushed and then renamed over the vault, and the previous good file is kept as `.bak`, so
 * an interrupted write cannot leave a half-written vault. A vault file that cannot be parsed is
 * moved aside (never deleted or overwritten) and the backup is used instead.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Maximum number of snapshots kept in the vault (newest first). */
export const MAX_VAULT_SNAPSHOTS = 50;

function parseVaultFile(file: string): unknown[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the vault at `file`. If it is unreadable, it is renamed to `<file>.corrupt-<time>` so the
 * next save cannot overwrite it, and the `.bak` copy from the previous save is returned instead.
 */
export function readVaultFile(file: string): unknown[] {
  const backup = `${file}.bak`;
  if (!fs.existsSync(file)) {
    return parseVaultFile(backup) ?? [];
  }

  const snapshots = parseVaultFile(file);
  if (snapshots) {
    return snapshots;
  }

  const quarantined = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, quarantined);
  console.error(`Rollback Vault file could not be read; moved it to ${quarantined} and loaded the backup.`);
  return parseVaultFile(backup) ?? [];
}

/**
 * Atomically replaces the vault at `file` with the newest `MAX_VAULT_SNAPSHOTS` snapshots,
 * keeping the current file as `.bak` first.
 */
export function writeVaultFile(file: string, snapshots: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(snapshots.slice(0, MAX_VAULT_SNAPSHOTS), null, 2), 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  if (parseVaultFile(file)) {
    fs.copyFileSync(file, `${file}.bak`);
  }
  fs.renameSync(tmp, file);
}
