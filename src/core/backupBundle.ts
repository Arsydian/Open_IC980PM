/**
 * @file src/core/backupBundle.ts
 * @description Backup & Restore manager for Open_IC980PM supporting:
 * 1. Native `.Ysf` (`47,046`-byte) binary codeplug files (100% compatible with factory CPS)
 * 2. Rich `.ic980.json` bundles (preserving `.Ysf` binary, RepeaterBook metadata, notes, and
 *    optional `775`-byte RF Calibration `0x18000..0x18306`)
 * 3. Automatic Pre-Write EEPROM Safety Snapshot storage ("Rollback Vault")
 */

import type { RadioCodeplug, RollbackSnapshot } from '../types/radio';
import { YSF_FILE_SIZE } from './constants';
import { eepromImageToYsf } from './eepromCodec';
import { decodeYsfBuffer, encodeYsfBuffer } from './ysfCodec';

const LOCAL_STORAGE_VAULT_KEY = 'open_ic980pm_rollback_vault_v1';

/**
 * Converts a `Uint8Array` into a Base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string back into a `Uint8Array`.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Schema of a rich `.ic980.json` configuration bundle.
 */
export interface RichIc980Bundle {
  format: 'open-ic980pm-bundle';
  schemaVersion: 1;
  appVersion: string;
  exportedAt: string;
  ysfBase64: string;
  rfCalibrationBase64?: string;
  channelMetadata: Record<
    number,
    {
      source?: 'manual' | 'repeaterbook' | 'chirp' | 'quickpack';
      callsign?: string;
      city?: string;
      state?: string;
      distanceMiles?: number;
      notes?: string;
    }
  >;
}

/**
 * Serializes a `RadioCodeplug` into a rich `.ic980.json` string.
 */
export function serializeRichBundle(codeplug: RadioCodeplug, appVersion: string = '1.0.0'): string {
  const ysfBytes = encodeYsfBuffer(codeplug);
  const channelMetadata: RichIc980Bundle['channelMetadata'] = {};

  for (const ch of codeplug.channels) {
    if (ch.used && ch.metadata) {
      channelMetadata[ch.channelNumber] = ch.metadata;
    }
  }

  const bundle: RichIc980Bundle = {
    format: 'open-ic980pm-bundle',
    schemaVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    ysfBase64: uint8ArrayToBase64(ysfBytes),
    rfCalibrationBase64: codeplug.rfCalibrationBase64,
    channelMetadata,
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Parses a rich `.ic980.json` string into a `RadioCodeplug`.
 */
export function deserializeRichBundle(jsonText: string): RadioCodeplug {
  const parsed = JSON.parse(jsonText) as Partial<RichIc980Bundle>;
  if (parsed.format !== 'open-ic980pm-bundle' || typeof parsed.ysfBase64 !== 'string') {
    throw new Error('Invalid .ic980.json bundle format.');
  }

  const ysfBytes = base64ToUint8Array(parsed.ysfBase64);
  if (ysfBytes.byteLength !== YSF_FILE_SIZE) {
    throw new Error(`Invalid embedded .Ysf size inside bundle: ${ysfBytes.byteLength} bytes.`);
  }

  const codeplug = decodeYsfBuffer(ysfBytes);
  if (parsed.rfCalibrationBase64) {
    codeplug.rfCalibrationBase64 = parsed.rfCalibrationBase64;
  }

  if (parsed.channelMetadata) {
    for (const [chNumStr, meta] of Object.entries(parsed.channelMetadata)) {
      const chNum = parseInt(chNumStr, 10);
      if (chNum >= 1 && chNum <= codeplug.channels.length && codeplug.channels[chNum - 1].used) {
        codeplug.channels[chNum - 1].metadata = meta;
      }
    }
  }

  return codeplug;
}

/**
 * Creates a `RollbackSnapshot` from the current `RadioCodeplug` state.
 */
export function createSnapshotFromCodeplug(
  codeplug: RadioCodeplug,
  label: string = 'Pre-Write Safety Snapshot'
): RollbackSnapshot {
  const ysfBytes = encodeYsfBuffer(codeplug);
  const activeChannelCount = codeplug.channels.filter((c) => c.used && c.rxFreqHz > 0).length;
  return {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    label,
    activeChannelCount,
    ysfBase64: uint8ArrayToBase64(ysfBytes),
    calibrationBase64: codeplug.rfCalibrationBase64,
  };
}

/**
 * Creates a `RollbackSnapshot` of what is actually stored on the radio, from an EEPROM image
 * read just before writing. Fields the radio does not store come from factory defaults.
 */
export function createSnapshotFromRadioImage(
  radioEeprom: Uint8Array,
  label: string = 'Radio contents before write'
): RollbackSnapshot {
  return createSnapshotFromCodeplug(decodeYsfBuffer(eepromImageToYsf(radioEeprom)), label);
}

/**
 * Loads all snapshots from the Rollback Vault (Electron IPC or browser `localStorage`).
 */
export async function loadRollbackVault(): Promise<RollbackSnapshot[]> {
  if (typeof window !== 'undefined' && window.api?.listRollbackSnapshots) {
    return window.api.listRollbackSnapshots();
  }
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_VAULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saves a snapshot to the Rollback Vault (Electron IPC or browser `localStorage`).
 *
 * @throws if the snapshot could not be stored (e.g. browser storage quota exceeded), so callers
 *   such as the pre-write backup can stop instead of assuming it was saved
 */
export async function saveSnapshotToVault(snapshot: RollbackSnapshot): Promise<RollbackSnapshot[]> {
  let updated: RollbackSnapshot[];
  if (typeof window !== 'undefined' && window.api?.saveRollbackSnapshot) {
    await window.api.saveRollbackSnapshot(snapshot);
    updated = await window.api.listRollbackSnapshots();
  } else {
    const existing = await loadRollbackVault();
    updated = [snapshot, ...existing.filter((s) => s.id !== snapshot.id)].slice(0, 40);
    try {
      localStorage.setItem(LOCAL_STORAGE_VAULT_KEY, JSON.stringify(updated));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not save snapshot to the Rollback Vault (browser storage): ${reason}`);
    }
  }
  if (!updated.some((s) => s.id === snapshot.id)) {
    throw new Error('Could not save snapshot to the Rollback Vault: it was not stored.');
  }
  return updated;
}

/**
 * Deletes a snapshot from the Rollback Vault.
 */
export async function deleteSnapshotFromVault(id: string): Promise<RollbackSnapshot[]> {
  if (typeof window !== 'undefined' && window.api?.deleteRollbackSnapshot) {
    await window.api.deleteRollbackSnapshot(id);
    return window.api.listRollbackSnapshots();
  }
  const existing = await loadRollbackVault();
  const updated = existing.filter((s) => s.id !== id);
  try {
    localStorage.setItem(LOCAL_STORAGE_VAULT_KEY, JSON.stringify(updated));
  } catch {
    // Ignore
  }
  return updated;
}
