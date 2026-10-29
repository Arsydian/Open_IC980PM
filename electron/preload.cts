/**
 * @file electron/preload.cts
 * @description Context-isolated Electron Preload script exposing `window.api` to the React UI.
 * Compiled to CommonJS (`preload.cjs`) because sandboxed preloads cannot use ESM imports.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  listHidDevices: () => ipcRenderer.invoke('hid:listDevices'),
  fetchRepeaterBookJson: (url: string, apiToken?: string) => ipcRenderer.invoke('repeaterbook:fetch', url, apiToken),
  listRollbackSnapshots: () => ipcRenderer.invoke('vault:list'),
  saveRollbackSnapshot: (snapshot: unknown) => ipcRenderer.invoke('vault:save', snapshot),
  deleteRollbackSnapshot: (id: string) => ipcRenderer.invoke('vault:delete', id),
});
