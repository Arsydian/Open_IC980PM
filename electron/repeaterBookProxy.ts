/**
 * @file electron/repeaterBookProxy.ts
 * @description RepeaterBook API requests made from the Electron main process (no browser CORS,
 * and the app's User-Agent can be set). Follows the RepeaterBook API wiki and RepeaterBook's
 * approval of this app: the user's app-bound `rbuapp_` token travels only in the `X-RB-App-Token`
 * header, never in the URL.
 */

/**
 * The User-Agent RepeaterBook approved for this app (app ID 141). RepeaterBook matches it as a
 * prefix and may deny requests that don't start with it, so this is a fixed string: it must not
 * follow the package.json version. Change it only together with RepeaterBook.
 */
export const REPEATERBOOK_USER_AGENT = 'Open_IC980PM/1.0 (https://github.com/Arsydian/Open_IC980PM; open-source-cps)';

/** Header RepeaterBook documents as the preferred carrier for `app_` / `rbuapp_` tokens. */
export const REPEATERBOOK_TOKEN_HEADER = 'X-RB-App-Token';

/**
 * Validates that an incoming URL for RepeaterBook proxying is strictly an official HTTPS
 * endpoint on repeaterbook.com to prevent Server-Side Request Forgery (SSRF).
 */
export function isValidRepeaterBookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'www.repeaterbook.com' || host === 'repeaterbook.com';
  } catch {
    return false;
  }
}

export const CREDENTIALS_IN_URL_MESSAGE =
  'Refused: RepeaterBook credentials may only be sent in the X-RB-App-Token header, never in the URL.';

/**
 * Whether a URL carries a credential: user info, a credential-named query parameter, a value that
 * looks like a RepeaterBook token, or `apiToken` itself. RepeaterBook's approval of this app does
 * not authorize credentials in query parameters.
 */
export function urlCarriesCredentials(rawUrl: string, apiToken?: string): boolean {
  const parsed = new URL(rawUrl);
  if (parsed.username || parsed.password) return true;
  for (const [name, value] of parsed.searchParams) {
    if (/token|key|auth|secret|password/i.test(name) || /^(rbuapp|app)_/i.test(value.trim())) return true;
  }
  const token = apiToken?.trim();
  return !!token && (rawUrl.includes(token) || rawUrl.includes(encodeURIComponent(token)));
}

export const REDIRECT_STOPPED_MESSAGE =
  'RepeaterBook answered with a redirect, so the request was stopped without following it (your token was not re-sent). Try again later.';

/** Whether a `redirect: 'manual'` response is a redirect (Node keeps the 3xx status). */
export function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

/**
 * Fetches a RepeaterBook API URL with the registered User-Agent and, when given, the user's token.
 */
export async function fetchRepeaterBookJson(
  url: string,
  apiToken: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  if (!isValidRepeaterBookUrl(url)) {
    throw new Error('Access denied: URL must be an official https://www.repeaterbook.com endpoint.');
  }
  if (urlCarriesCredentials(url, typeof apiToken === 'string' ? apiToken : undefined)) {
    throw new Error(CREDENTIALS_IN_URL_MESSAGE);
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': REPEATERBOOK_USER_AGENT,
  };
  if (apiToken && typeof apiToken === 'string' && apiToken.trim()) {
    headers[REPEATERBOOK_TOKEN_HEADER] = apiToken.trim();
  }
  // RepeaterBook: disable automatic redirects for authenticated requests and treat any 3xx as a
  // stop condition, so the token is never re-sent to another URL.
  const response = await fetchImpl(url, { headers, redirect: 'manual' });
  if (isRedirectResponse(response)) {
    throw new Error(REDIRECT_STOPPED_MESSAGE);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `RepeaterBook API access denied (HTTP ${response.status}). An approved User-Agent and valid personal app token (rbuapp_...) are required by RepeaterBook.`
      );
    }
    if (response.status === 429) {
      throw new Error(rateLimitMessage(response.headers.get('Retry-After')));
    }
    throw new Error(`RepeaterBook API returned HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Error text for HTTP 429, including the server's Retry-After (seconds or HTTP date) when sent.
 * Kept in step with `rateLimitMessage` in src/core/repeaterBookClient.ts, which parses it back.
 */
export function rateLimitMessage(retryAfter: string | null, now: number = Date.now()): string {
  let seconds: number | null = null;
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    seconds = parseInt(retryAfter.trim(), 10);
  } else if (retryAfter && !Number.isNaN(Date.parse(retryAfter))) {
    seconds = Math.max(0, Math.ceil((Date.parse(retryAfter) - now) / 1000));
  }
  return seconds !== null
    ? `RepeaterBook API rate limit exceeded (HTTP 429). Retry after ${seconds} seconds.`
    : 'RepeaterBook API rate limit exceeded (HTTP 429). Please wait a moment before trying again.';
}
