/**
 * @file src/core/repeaterBookToken.ts
 * @description Where the user's RepeaterBook token is kept: encrypted by the desktop app
 * (electron/tokenStore.ts). Browser builds can't search RepeaterBook, so they keep no token.
 */

/** Where earlier versions kept the token in plain text; it is moved out on first load. */
export const LEGACY_TOKEN_STORAGE_KEY = 'open_ic980pm_rb_token';

/**
 * The saved token, or `''`. A plain-text token left by an earlier version is removed from
 * `localStorage` and, in the desktop app, saved encrypted instead.
 */
export async function loadRepeaterBookToken(): Promise<string> {
  let legacy = '';
  try {
    legacy = (localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY) || '').trim();
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable (private window)
  }

  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (typeof api?.getRepeaterBookToken !== 'function') return '';
  if (legacy) {
    await api.setRepeaterBookToken(legacy);
    return legacy;
  }
  return api.getRepeaterBookToken();
}

/**
 * Saves the token (deleting it when blank). Returns whether it was saved: `false` in browser
 * builds and when the system can't encrypt it, in which case it lasts only until the app closes.
 */
export async function saveRepeaterBookToken(token: string): Promise<boolean> {
  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (typeof api?.setRepeaterBookToken !== 'function') return false;
  return api.setRepeaterBookToken(token.trim());
}
