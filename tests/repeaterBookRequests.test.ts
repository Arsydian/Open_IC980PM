/**
 * @file tests/repeaterBookRequests.test.ts
 * @description How RepeaterBook API requests are sent (`src/core/repeaterBookClient.ts` in the
 * browser, `electron/repeaterBookProxy.ts` in the desktop app), per the RepeaterBook API wiki.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPEATERBOOK_TOKEN_HEADER,
  clearRepeaterBookCache,
  queryRepeaterBookApi,
  rateLimitCooldownSeconds,
  rateLimitMessage,
  REPEATERBOOK_CACHE_MAX_ENTRIES,
  repeaterBookCacheSize,
} from '../src/core/repeaterBookClient';
import {
  REDIRECT_STOPPED_MESSAGE,
  fetchRepeaterBookJson,
  rateLimitMessage as proxyRateLimitMessage,
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

afterEach(() => {
  vi.unstubAllGlobals();
  clearRepeaterBookCache();
});

describe('browser requests', () => {
  it('send the token only in X-RB-App-Token, never in the URL or other headers', async () => {
    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal('fetch', fetchMock);

    await queryRepeaterBookApi(query);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain('token=');
    const headers = init.headers as Record<string, string>;
    expect(headers[REPEATERBOOK_TOKEN_HEADER]).toBe(TOKEN);
    expect(Object.values(headers).filter((v) => v.includes(TOKEN))).toEqual([TOKEN]);
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('X-Api-Key');
  });

  it('do not follow redirects and stop on a 3xx', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 301, headers: { Location: 'https://x.example/' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(queryRepeaterBookApi(query)).rejects.toThrow(/request was stopped without following it/);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });
});

describe('Electron proxy requests', () => {
  const UA = 'Open_IC980PM/1.1.0 (https://github.com/Arsydian/Open_IC980PM; open-source-cps)';

  it('send the token only in X-RB-App-Token and keep the given User-Agent', async () => {
    const fetchMock = vi.fn(async () => okJson());
    await fetchRepeaterBookJson('https://www.repeaterbook.com/api/export.php?state_id=47', ` ${TOKEN} `, UA, fetchMock);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'User-Agent': UA,
      [REPEATERBOOK_TOKEN_HEADER]: TOKEN,
    });
  });

  it('does not follow redirects and stops on a 3xx', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } })
    );
    await expect(
      fetchRepeaterBookJson('https://www.repeaterbook.com/api/export.php', TOKEN, UA, fetchMock)
    ).rejects.toThrow(REDIRECT_STOPPED_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('refuses URLs that are not HTTPS repeaterbook.com', async () => {
    const fetchMock = vi.fn(async () => okJson());
    for (const url of ['http://www.repeaterbook.com/api/export.php', 'https://evil.example/api/export.php']) {
      await expect(fetchRepeaterBookJson(url, TOKEN, UA, fetchMock)).rejects.toThrow(/Access denied/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HTTP 429 handling', () => {
  it('reports the server Retry-After and locks searches at least 60 s', async () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(rateLimitMessage('120', now)).toContain('Retry after 120 seconds.');
    expect(rateLimitMessage('Wed, 28 Oct 2026 12:05:00 GMT', now)).toContain('Retry after 300 seconds.');
    expect(rateLimitMessage(null, now)).not.toContain('Retry after');
    expect(proxyRateLimitMessage('120', now)).toBe(rateLimitMessage('120', now));

    expect(rateLimitCooldownSeconds(rateLimitMessage('600', now))).toBe(600);
    expect(rateLimitCooldownSeconds(rateLimitMessage('5', now))).toBe(60);
    expect(rateLimitCooldownSeconds(rateLimitMessage(null, now))).toBe(60);
    expect(rateLimitCooldownSeconds('RepeaterBook API returned HTTP 500')).toBe(0);
  });

  it('passes Retry-After through from a 429 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '900' } })));
    await expect(queryRepeaterBookApi(query)).rejects.toThrow('Retry after 900 seconds.');
  });
});

describe('response cache', () => {
  it('serves a repeated query from cache and keeps at most 20 queries', async () => {
    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal('fetch', fetchMock);

    await queryRepeaterBookApi(query);
    await queryRepeaterBookApi(query);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 30; i++) {
      await queryRepeaterBookApi({ ...query, city: `Town ${i}` });
    }
    expect(repeaterBookCacheSize()).toBe(REPEATERBOOK_CACHE_MAX_ENTRIES);
  });
});
