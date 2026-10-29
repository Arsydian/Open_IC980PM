/**
 * @file tests/repeaterBookRequests.test.ts
 * @description How RepeaterBook API requests are made, per the RepeaterBook API wiki: only through
 * the Electron proxy (`electron/repeaterBookProxy.ts`), which `src/core/repeaterBookClient.ts`
 * calls via `window.api`. Browser builds refuse instead of sending a browser User-Agent.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPEATERBOOK_CACHE_MAX_ENTRIES,
  REPEATERBOOK_DESKTOP_ONLY_MESSAGE,
  clearRepeaterBookCache,
  isRepeaterBookAvailable,
  queryRepeaterBookApi,
  rateLimitCooldownSeconds,
  repeaterBookCacheSize,
} from '../src/core/repeaterBookClient';
import {
  REDIRECT_STOPPED_MESSAGE,
  REPEATERBOOK_TOKEN_HEADER,
  REPEATERBOOK_USER_AGENT,
  fetchRepeaterBookJson,
  rateLimitMessage,
} from '../electron/repeaterBookProxy';
import type { RepeaterBookQuery } from '../src/types/radio';

const TOKEN = 'rbuapp_secret123';

const query: RepeaterBookQuery = {
  region: 'us_ca',
  searchMode: 'location',
  state: '47',
  city: 'Nashville',
  radius: 25,
  distanceUnit: 'miles',
  maxResults: 50,
  apiToken: TOKEN,
};

const okJson = () => new Response(JSON.stringify({ results: [] }), { status: 200 });

/** Simulates the desktop app's preload bridge. */
function installDesktopBridge() {
  const fetchRepeaterBookJson = vi.fn(async () => ({ results: [] }));
  vi.stubGlobal('window', { api: { fetchRepeaterBookJson } });
  return fetchRepeaterBookJson;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearRepeaterBookCache();
});

describe('RepeaterBook client', () => {
  it('refuses in a browser build instead of sending a browser User-Agent', async () => {
    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal('fetch', fetchMock);

    expect(isRepeaterBookAvailable()).toBe(false);
    await expect(queryRepeaterBookApi(query)).rejects.toThrow(REPEATERBOOK_DESKTOP_ONLY_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes through the desktop proxy with the token kept out of the URL', async () => {
    const bridge = installDesktopBridge();
    expect(isRepeaterBookAvailable()).toBe(true);

    await queryRepeaterBookApi(query);

    expect(bridge).toHaveBeenCalledTimes(1);
    const [url, token] = bridge.mock.calls[0] as unknown as [string, string];
    expect(url).toMatch(/^https:\/\/www\.repeaterbook\.com\/api\/export\.php\?/);
    expect(url).not.toContain(TOKEN);
    expect(token).toBe(TOKEN);
  });

  it('serves a repeated query from cache and keeps at most 20 queries', async () => {
    const bridge = installDesktopBridge();

    await queryRepeaterBookApi(query);
    await queryRepeaterBookApi(query);
    expect(bridge).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 30; i++) {
      await queryRepeaterBookApi({ ...query, city: `Town ${i}` });
    }
    expect(repeaterBookCacheSize()).toBe(REPEATERBOOK_CACHE_MAX_ENTRIES);
  });
});

describe('Electron proxy requests', () => {
  // The exact User-Agent submitted in the project's RepeaterBook API request. RepeaterBook may deny
  // requests whose User-Agent does not match the approved value, so this must not drift.
  const REGISTERED_UA = 'Open_IC980PM/1.0 (https://github.com/Arsydian/Open_IC980PM; open-source-cps)';

  it('send the registered User-Agent and the token only in X-RB-App-Token', async () => {
    const fetchMock = vi.fn(async () => okJson());
    await fetchRepeaterBookJson('https://www.repeaterbook.com/api/export.php?state_id=47', ` ${TOKEN} `, fetchMock);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'User-Agent': REGISTERED_UA,
      'X-RB-App-Token': TOKEN,
    });
    expect(REPEATERBOOK_TOKEN_HEADER).toBe('X-RB-App-Token');
  });

  it('does not follow redirects and stops on a 3xx', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } })
    );
    await expect(
      fetchRepeaterBookJson('https://www.repeaterbook.com/api/export.php', TOKEN, fetchMock)
    ).rejects.toThrow(REDIRECT_STOPPED_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('refuses URLs that are not HTTPS repeaterbook.com', async () => {
    const fetchMock = vi.fn(async () => okJson());
    for (const url of ['http://www.repeaterbook.com/api/export.php', 'https://evil.example/api/export.php']) {
      await expect(fetchRepeaterBookJson(url, TOKEN, fetchMock)).rejects.toThrow(/Access denied/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('registered User-Agent', () => {
  it('is a fixed string that does not follow the package.json version', () => {
    expect(REPEATERBOOK_USER_AGENT).toBe('Open_IC980PM/1.0 (https://github.com/Arsydian/Open_IC980PM; open-source-cps)');
    const main = readFileSync(resolve(__dirname, '..', 'electron', 'main.ts'), 'utf-8');
    expect(main).not.toContain('Open_IC980PM/${APP_VERSION}');
  });
});

describe('HTTP 429 handling', () => {
  it('reports the server Retry-After and locks searches at least 60 s', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(rateLimitMessage('120', now)).toContain('Retry after 120 seconds.');
    expect(rateLimitMessage('Wed, 28 Oct 2026 12:05:00 GMT', now)).toContain('Retry after 300 seconds.');
    expect(rateLimitMessage(null, now)).not.toContain('Retry after');

    expect(rateLimitCooldownSeconds(rateLimitMessage('600', now))).toBe(600);
    expect(rateLimitCooldownSeconds(rateLimitMessage('5', now))).toBe(60);
    expect(rateLimitCooldownSeconds(rateLimitMessage(null, now))).toBe(60);
    expect(rateLimitCooldownSeconds('RepeaterBook API returned HTTP 500')).toBe(0);
  });

  it('passes Retry-After through from a 429 response', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '900' } }));
    await expect(
      fetchRepeaterBookJson('https://www.repeaterbook.com/api/export.php', TOKEN, fetchMock)
    ).rejects.toThrow('Retry after 900 seconds.');
  });
});
