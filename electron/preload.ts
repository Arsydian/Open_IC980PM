/**
 * @file electron/preload.ts
 * @description Context-isolated Electron Preload script exposing `window.api` to the React UI.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  appVersion: '1.0.11',
  platform: process.platform,
  listHidDevices: () => ipcRenderer.invoke('hid:listDevices'),
  fetchRepeaterBookJson: (url: string, apiToken?: string) => ipcRenderer.invoke('repeaterbook:fetch', url, apiToken),
  listRollbackSnapshots: () => ipcRenderer.invoke('vault:list'),
  saveRollbackSnapshot: (snapshot: unknown) => ipcRenderer.invoke('vault:save', snapshot),
  deleteRollbackSnapshot: (id: string) => ipcRenderer.invoke('vault:delete', id),
});
