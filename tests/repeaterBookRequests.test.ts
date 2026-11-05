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
  REPEATERBOOK_FORMAT_MESSAGE,
  buildRepeaterBookApiUrls,
  clearRepeaterBookCache,
  extractRepeaterBookEntries,
  filterAndNormalizeRepeaterBookResults,
  isRepeaterBookAvailable,
  queryRepeaterBookApi,
  rateLimitCooldownSeconds,
  repeaterBookCacheSize,
  repeaterBookRefusal,
} from '../src/core/repeaterBookClient';
import {
  CREDENTIALS_IN_URL_MESSAGE,
  REDIRECT_STOPPED_MESSAGE,
  REPEATERBOOK_ERROR_MESSAGES,
  REPEATERBOOK_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
  REPEATERBOOK_TOKEN_HEADER,
  REPEATERBOOK_USER_AGENT,
  fetchRepeaterBookJson,
  rateLimitMessage,
} from '../electron/repeaterBookProxy';
import type { RepeaterBookQuery } from '../src/types/radio';

const TOKEN = 'rbuapp_secret123';

const query: RepeaterBookQuery = {
  region: 'us_ca',
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

  it('makes a separate stype=gmrs search for GMRS and merges the results once', async () => {
    const amateur = { 'State ID': '06', 'Rptr ID': '1', Frequency: '146.9400', 'Input Freq': '146.3400', 'Nearest City': 'Vacaville', Lat: '38.35', Long: '-121.98', Callsign: 'W6AAA' };
    const gmrs = { 'State ID': '06', 'Rptr ID': '9', Frequency: '462.6750', 'Input Freq': '467.6750', 'Nearest City': 'Vacaville', Lat: '38.36', Long: '-121.97', Callsign: 'WRGMRS' };
    const fetchRepeaterBookJson = vi.fn(async (url: string) => ({ results: url.includes('stype=gmrs') ? [gmrs, amateur] : [amateur] }));
    vi.stubGlobal('window', { api: { fetchRepeaterBookJson } });

    const results = await queryRepeaterBookApi({
      ...query,
      state: '06',
      city: 'Vacaville',
      bands: { include2m: true, include70cm: true, includeGmrs: true },
    });

    expect(fetchRepeaterBookJson.mock.calls.map((c) => new URL(c[0] as string).searchParams.get('stype'))).toEqual([null, 'gmrs']);
    expect(results.map((r) => r.callsign).sort()).toEqual(['W6AAA', 'WRGMRS']);
  });

  it('serves a repeated query from cache and keeps at most 20 queries', async () => {
    const bridge = installDesktopBridge();

    await queryRepeaterBookApi(query);
    await queryRepeaterBookApi(query);
    expect(bridge).toHaveBeenCalledTimes(1);

    // Another city in the same state is answered from the same state-wide response
    await queryRepeaterBookApi({ ...query, city: 'Franklin' });
    expect(bridge).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 30; i++) {
      await queryRepeaterBookApi({ ...query, state: String(i + 1).padStart(2, '0') });
    }
    expect(repeaterBookCacheSize()).toBe(REPEATERBOOK_CACHE_MAX_ENTRIES);
  });

  it("shows the proxy's message without Electron's IPC prefix", async () => {
    vi.stubGlobal('window', {
      api: {
        fetchRepeaterBookJson: vi.fn(async () => {
          throw new Error("Error invoking remote method 'repeaterbook:fetch': Error: RepeaterBook refused the search (auth_revoked): gone");
        }),
      },
    });
    await expect(queryRepeaterBookApi(query)).rejects.toThrow(/^RepeaterBook refused the search \(auth_revoked\): gone$/);
  });

  it('tells token refusals from User-Agent refusals, so neither is retried blindly', () => {
    expect(repeaterBookRefusal('RepeaterBook refused the search (auth_revoked): ...')).toBe('token');
    expect(repeaterBookRefusal('RepeaterBook refused the search (auth_scope_denied): ...')).toBe('token');
    expect(repeaterBookRefusal('RepeaterBook API access denied (HTTP 403). ...')).toBe('token');
    expect(repeaterBookRefusal('RepeaterBook refused the search (ua_mismatch): ...')).toBe('app');
    expect(repeaterBookRefusal('RepeaterBook API rate limit exceeded (HTTP 429). Retry after 60 seconds.')).toBeUndefined();
    expect(repeaterBookRefusal(TIMEOUT_MESSAGE)).toBeUndefined();
  });

  it('says so when no repeater in the state is listed under the typed city', async () => {
    vi.stubGlobal('window', {
      api: {
        fetchRepeaterBookJson: vi.fn(async () => ({
          results: [{ Frequency: '146.94', 'Input Freq': '146.34', 'Nearest City': 'Nashville', Lat: '36.16', Long: '-86.78' }],
        })),
      },
    });
    await expect(queryRepeaterBookApi({ ...query, city: 'Smallville' })).rejects.toThrow(
      'RepeaterBook lists no repeaters under "Smallville" in Tennessee'
    );
  });
});

describe('RepeaterBook response format', () => {
  /** Answers every search with `payload`. */
  function respondWith(payload: unknown) {
    const fetchRepeaterBookJson = vi.fn(async () => payload);
    vi.stubGlobal('window', { api: { fetchRepeaterBookJson } });
    return fetchRepeaterBookJson;
  }

  it('reads fields named with the API wiki labels, and numbers as well as strings', async () => {
    respondWith({
      results: [
        {
          'State ID (FIPS)': '47',
          'Repeater ID': '7',
          Frequency: 146.94,
          'Input Frequency': '146.3400',
          'PL/CTCSS Uplink': '107.2',
          'PL/CTCSS TSQ Downlink': '',
          'Location/Nearest City': 'Nashville',
          'Analog Capable': 'Yes',
          Callsign: 'w4abc',
        },
      ],
    });

    const [repeater] = await queryRepeaterBookApi(query);
    expect(repeater.callsign).toBe('W4ABC');
    expect(repeater.rxFreqHz).toBe(146_940_000);
    expect(repeater.txFreqHz).toBe(146_340_000);
    expect(repeater.txToneValue).toBe(107.2);
    expect(repeater.rptrId).toBe('7');
    expect(repeater.city).toBe('Nashville');
  });

  it('fails loudly, and caches nothing, when the layout or frequency fields are not recognised', async () => {
    respondWith({ data: [{ Frequency: '146.94', 'Input Freq': '146.34' }] });
    await expect(queryRepeaterBookApi(query)).rejects.toThrow(REPEATERBOOK_FORMAT_MESSAGE);

    respondWith({ results: [{ Frequency: '146.94', Offset: '-0.6', 'Nearest City': 'Nashville' }] });
    await expect(queryRepeaterBookApi(query)).rejects.toThrow('Missing: input frequency.');

    expect(repeaterBookCacheSize()).toBe(0);
  });

  it('reports an error message sent in place of results, and accepts an explicit empty result', async () => {
    respondWith({ status: 'error', message: 'Token not bound to this application' });
    await expect(queryRepeaterBookApi(query)).rejects.toThrow('RepeaterBook: Token not bound to this application');

    expect(extractRepeaterBookEntries({ count: 0 })).toEqual([]);
    expect(extractRepeaterBookEntries({ count: 0, results: [] })).toEqual([]);
  });

  it('keeps one repeater with a blank input frequency from failing the whole search', () => {
    const entries = extractRepeaterBookEntries([
      { Frequency: '146.94', 'Input Freq': '146.34' },
      { Frequency: '147.00', 'Input Freq': '' },
    ]);
    expect(entries).toHaveLength(2);
  });

  it('treats a repeater listing a digital mode as digital-only when the analog field is missing', () => {
    const entries = extractRepeaterBookEntries([
      { Frequency: '441.0000', 'Input Freq': '446.0000', 'Nearest City': 'Nashville', Callsign: 'W4DMR', DMR: 'Yes' },
      { Frequency: '146.9400', 'Input Freq': '146.3400', 'Nearest City': 'Nashville', Callsign: 'W4FM', DMR: 'No' },
    ]);
    const results = filterAndNormalizeRepeaterBookResults(entries, query);
    expect(results.map((r) => r.callsign)).toEqual(['W4FM']);
  });
});

describe('Electron proxy requests', () => {
  // The User-Agent RepeaterBook approved for this app (matched as a prefix). RepeaterBook may deny
  // requests whose User-Agent does not start with it, so this must not drift.
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

  it('refuses URLs that carry credentials, which RepeaterBook did not authorize', async () => {
    const fetchMock = vi.fn(async () => okJson());
    const base = 'https://www.repeaterbook.com/api/export.php?state_id=47';
    for (const [url, token] of [
      [`${base}&token=abc123`, TOKEN],
      [`${base}&api_key=abc123`, TOKEN],
      [`${base}&city=rbuapp_abc123`, TOKEN],
      ['https://user:secret@www.repeaterbook.com/api/export.php', TOKEN],
      [`${base}&callsign=plain-secret-9`, 'plain-secret-9'],
    ]) {
      await expect(fetchRepeaterBookJson(url, token, fetchMock)).rejects.toThrow(CREDENTIALS_IN_URL_MESSAGE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts every URL the app builds', async () => {
    const fetchMock = vi.fn(async () => okJson());
    const urls = [
      ...buildRepeaterBookApiUrls({ ...query, bands: { include2m: true, includeGmrs: true } }),
      ...buildRepeaterBookApiUrls({ region: 'row', country: 'United Kingdom', city: 'London', maxResults: 50, apiToken: TOKEN }),
    ];
    for (const url of urls) {
      await fetchRepeaterBookJson(url, TOKEN, fetchMock);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses URLs that are not HTTPS repeaterbook.com', async () => {
    const fetchMock = vi.fn(async () => okJson());
    for (const url of ['http://www.repeaterbook.com/api/export.php', 'https://evil.example/api/export.php']) {
      await expect(fetchRepeaterBookJson(url, TOKEN, fetchMock)).rejects.toThrow(/Access denied/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Electron proxy time limit and error codes (API wiki)', () => {
  const URL_ = 'https://www.repeaterbook.com/api/export.php?state_id=47';
  const jsonError = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('gives up after 30 seconds, as the wiki examples do', async () => {
    expect(REPEATERBOOK_TIMEOUT_MS).toBe(30_000);
    const hangs = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    );
    await expect(fetchRepeaterBookJson(URL_, TOKEN, hangs as unknown as typeof fetch, 20)).rejects.toThrow(TIMEOUT_MESSAGE);
    expect((hangs.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('explains each documented error code, wherever it appears in the JSON body', async () => {
    for (const [code, body] of [
      ['auth_invalid', { error: 'auth_invalid' }],
      ['auth_revoked', { status: 'error', code: 'auth_revoked', message: 'Token revoked' }],
      ['auth_scope_denied', { error: { code: 'auth_scope_denied' } }],
      ['ua_mismatch', { error: 'ua_mismatch' }],
    ] as const) {
      await expect(fetchRepeaterBookJson(URL_, TOKEN, jsonError(403, body))).rejects.toThrow(
        `RepeaterBook refused the search (${code}): ${REPEATERBOOK_ERROR_MESSAGES[code]}`
      );
    }
    // Also when sent with a 200
    await expect(fetchRepeaterBookJson(URL_, TOKEN, jsonError(200, { error: 'auth_missing' }))).rejects.toThrow('(auth_missing)');
  });

  it('treats rate_limited like a 429 and keeps the generic message for unknown refusals', async () => {
    await expect(fetchRepeaterBookJson(URL_, TOKEN, jsonError(403, { error: 'rate_limited' }))).rejects.toThrow('HTTP 429');
    await expect(fetchRepeaterBookJson(URL_, TOKEN, jsonError(401, { error: 'something_else' }))).rejects.toThrow(
      'RepeaterBook API access denied (HTTP 401)'
    );
    await expect(fetchRepeaterBookJson(URL_, TOKEN, jsonError(200, { error: 'toString' }))).resolves.toEqual({ error: 'toString' });
  });

  it('reports a successful response that is not JSON', async () => {
    const html = vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 }));
    await expect(fetchRepeaterBookJson(URL_, TOKEN, html)).rejects.toThrow('empty or non-JSON response');
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
