/**
 * @file electron/externalLinks.ts
 * @description Which link targets the Electron app hands to the operating system's browser.
 */

/** Only well-formed HTTPS URLs are opened externally; http:, file:, custom schemes etc. are dropped. */
export function shouldOpenExternally(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === 'https:';
  } catch {
    return false;
  }
}
