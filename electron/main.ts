/**
 * @file electron/main.ts
 * @description Electron Main Process for Open_IC980PM.
 * Provides:
 * 1. Synchronized application version (`1.0.0`) from `package.json`
 * 2. Automatic WebHID permission granting + `node-hid` enumeration for `"ASER _HID"` / `"ASER-471"`
 * 3. CORS-free RepeaterBook API HTTP proxy with compliant `User-Agent` header
 * 4. Persistent Pre-Write EEPROM Safety Snapshot storage ("Rollback Vault")
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateAserHidDevices } from './hidTransport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
const APP_VERSION = pkgJson.version || '1.0.0';

let mainWindow: BrowserWindow | null = null;

/**
 * Returns the path to the local Rollback Vault JSON store in the user data directory.
 */
function getRollbackVaultPath(): string {
  return path.join(app.getPath('userData'), 'rollback-vault.json');
}

/**
 * Reads all saved EEPROM safety snapshots from the Rollback Vault.
 */
function readRollbackVault(): unknown[] {
  try {
    const file = getRollbackVaultPath();
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Writes the Rollback Vault array to disk (keeping up to the 50 most recent snapshots).
 */
function writeRollbackVault(snapshots: unknown[]): void {
  const file = getRollbackVaultPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshots.slice(0, 50), null, 2), 'utf-8');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#090d16',
    title: `Open_IC980PM v${APP_VERSION}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Enable WebHID device selection seamlessly inside Electron
  session.defaultSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const aserDevice = details.deviceList.find(
      (d) =>
        (d.name && d.name.includes('ASER')) ||
        details.deviceList.length === 1
    );
    if (aserDevice) {
      callback(aserDevice.deviceId);
    } else if (details.deviceList.length > 0) {
      callback(details.deviceList[0].deviceId);
    } else {
      callback('');
    }
  });

  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'hid') {
      return true;
    }
    return false;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:getVersion', () => APP_VERSION);

  ipcMain.handle('hid:listDevices', async () => {
    return enumerateAserHidDevices();
  });

  ipcMain.handle('repeaterbook:fetch', async (_event, url: string) => {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `Open_IC980PM/${APP_VERSION} (Cross-Platform Amateur Radio CPS; +https://github.com/open-ic980pm)`,
      },
    });
    if (!response.ok) {
      throw new Error(`RepeaterBook API returned HTTP ${response.status}`);
    }
    return response.json();
  });

  ipcMain.handle('vault:list', () => {
    return readRollbackVault();
  });

  ipcMain.handle('vault:save', (_event, snapshot: { id: string }) => {
    const existing = readRollbackVault() as Array<{ id: string }>;
    const filtered = existing.filter((s) => s.id !== snapshot.id);
    writeRollbackVault([snapshot, ...filtered]);
  });

  ipcMain.handle('vault:delete', (_event, id: string) => {
    const existing = readRollbackVault() as Array<{ id: string }>;
    writeRollbackVault(existing.filter((s) => s.id !== id));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
