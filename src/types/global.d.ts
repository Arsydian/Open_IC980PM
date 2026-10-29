/**
 * @file src/types/global.d.ts
 * @description Global window.api bridge declarations for Electron IPC and Web/PWA fallback.
 */

import type { RollbackSnapshot } from './radio';

export interface HidDeviceInfo {
  vendorId: number;
  productId: number;
  manufacturer?: string;
  product?: string;
  path?: string;
}

export interface HidProgressEvent {
  phase: 'handshake' | 'password' | 'reading' | 'writing' | 'verifying' | 'logo' | 'calibration' | 'complete';
  currentAddress: number;
  totalBytes: number;
  bytesTransferred: number;
  percent: number;
  message: string;
}

export interface ElectronBridgeApi {
  /** Synchronized application build version from package.json */
  appVersion: string;
  /** Platform identifier (`win32`, `darwin`, `linux`, `web`) */
  platform: string;
  /** List connected HIROYASU / ASER-471 USB HID devices */
  listHidDevices: () => Promise<HidDeviceInfo[]>;
  /** Proxy RepeaterBook API HTTP GET requests in Electron main process to avoid browser CORS restrictions */
  fetchRepeaterBookJson: (url: string, apiToken?: string) => Promise<unknown>;
  /** Read all snapshots from the local Rollback Vault */
  listRollbackSnapshots: () => Promise<RollbackSnapshot[]>;
  /** Save a snapshot to the local Rollback Vault */
  saveRollbackSnapshot: (snapshot: RollbackSnapshot) => Promise<void>;
  /** Delete a snapshot from the local Rollback Vault */
  deleteRollbackSnapshot: (id: string) => Promise<void>;
}

declare global {
  const __APP_VERSION__: string;

  interface Window {
    api?: ElectronBridgeApi;
  }
}

export {};
