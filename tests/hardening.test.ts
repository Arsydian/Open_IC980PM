/**
 * @file tests/hardening.test.ts
 * @description External-link filtering in Electron (`electron/externalLinks.ts`) and the production
 * Content-Security-Policy (`vite.config.ts`).
 */

import { describe, expect, it } from 'vitest';
import { shouldOpenExternally } from '../electron/externalLinks';
import { PRODUCTION_CSP, productionCspPlugin } from '../vite.config';

describe('shouldOpenExternally', () => {
  it('opens only HTTPS links in the system browser', () => {
    expect(shouldOpenExternally('https://www.repeaterbook.com/user/api_apps.php')).toBe(true);
    for (const url of ['http://example.com', 'file:///C:/Windows/notepad.exe', 'ms-settings:privacy', 'javascript:alert(1)', 'not a url']) {
      expect(shouldOpenExternally(url)).toBe(false);
    }
  });
});

describe('production Content-Security-Policy', () => {
  it('only allows the app itself (RepeaterBook is reached through the Electron main process)', () => {
    expect(PRODUCTION_CSP).toContain("script-src 'self'");
    expect(PRODUCTION_CSP).toContain("connect-src 'self';");
    expect(PRODUCTION_CSP).not.toMatch(/unsafe-eval|\*/);
  });

  it('is injected into index.html for builds only', () => {
    const plugin = productionCspPlugin();
    expect(plugin.apply).toBe('build');
    const transform = plugin.transformIndexHtml as (html: string) => string;
    const html = transform('<!DOCTYPE html><html><head><title>x</title></head></html>');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`);
  });
});
