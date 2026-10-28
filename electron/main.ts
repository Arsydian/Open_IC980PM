/**
 * @file electron/main.ts
 * @description Electron Main Process for Open_IC980PM.
 * Provides:
 * 1. Synchronized application version (`1.0.0`) from `package.json`
 * 2. Automatic WebHID permission granting + `node-hid` enumeration for `"ASER _HID"` / `"ASER-471"`
 * 3. CORS-free RepeaterBook API HTTP proxy with compliant `User-Agent` header
 * 4. Persistent Pre-Write EEPROM Safety Snapshot storage ("Rollback Vault")
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
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
 * Validates that an incoming URL for RepeaterBook proxying is strictly an official HTTPS
 * endpoint on repeaterbook.com to prevent Server-Side Request Forgery (SSRF).
 */
function isValidRepeaterBookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'www.repeaterbook.com' || host === 'repeaterbook.com';
  } catch {
    return false;
  }
}

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
      // Sandboxed preloads cannot use ESM imports, so the preload is compiled to CommonJS.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Confine navigation and popups: open external links in default OS browser, never in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      if (devServerUrl) {
        const devOrigin = new URL(devServerUrl).origin;
        if (parsedUrl.origin !== devOrigin) {
          event.preventDefault();
        }
      } else if (parsedUrl.protocol !== 'file:') {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Enable WebHID device selection strictly for radio devices ("ASER _HID" / "ASER-471")
  session.defaultSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const aserDevice = details.deviceList.find(
      (d) =>
        d.name &&
        (d.name.includes('ASER') || d.name.includes('IC-980') || d.name.includes('PROG81'))
    );
    if (aserDevice) {
      callback(aserDevice.deviceId);
    } else {
      // Reject non-radio HID devices (e.g., keyboards, mice, security dongles)
      callback('');
    }
  });

  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'hid') {
      const dev = details.device as { name?: string };
      if (
        dev &&
        dev.name &&
        (dev.name.includes('ASER') || dev.name.includes('IC-980') || dev.name.includes('PROG81'))
      ) {
        return true;
      }
    }
    return false;
  });

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

  // Secure RepeaterBook proxy endpoint with strict SSRF defense and app-bound token authentication
  ipcMain.handle('repeaterbook:fetch', async (_event, url: string, apiToken?: string) => {
    if (!isValidRepeaterBookUrl(url)) {
      throw new Error('Access denied: URL must be an official https://www.repeaterbook.com endpoint.');
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `Open_IC980PM/${APP_VERSION} (https://github.com/Arsydian/Open_IC980PM; open-source-cps)`,
    };
    if (apiToken && typeof apiToken === 'string' && apiToken.trim()) {
      const cleanToken = apiToken.trim();
      headers['Authorization'] = `Bearer ${cleanToken}`;
      headers['X-Api-Key'] = cleanToken;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `RepeaterBook API access denied (HTTP ${response.status}). An approved User-Agent and valid personal app token (rbuapp_...) are required by RepeaterBook.`
        );
      }
      if (response.status === 429) {
        throw new Error('RepeaterBook API rate limit exceeded (HTTP 429). Please wait a moment before trying again.');
      }
      throw new Error(`RepeaterBook API returned HTTP ${response.status}`);
    }
    return response.json();
  });

  ipcMain.handle('vault:list', () => {
    return readRollbackVault();
  });

  // Validates snapshot format and bounds maximum payload size to 2MB to prevent disk exhaustion
  ipcMain.handle('vault:save', (_event, snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    const s = snapshot as { id?: unknown; timestamp?: unknown };
    if (typeof s.id !== 'string' || typeof s.timestamp !== 'string') return;

    const serialized = JSON.stringify(snapshot);
    if (serialized.length > 2 * 1024 * 1024) {
      throw new Error('Snapshot payload exceeds maximum allowed size (2MB).');
    }

    const existing = readRollbackVault() as Array<{ id: string }>;
    const filtered = existing.filter((item) => item.id !== s.id);
    writeRollbackVault([snapshot, ...filtered]);
  });

  ipcMain.handle('vault:delete', (_event, id: string) => {
    if (typeof id !== 'string') return;
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
