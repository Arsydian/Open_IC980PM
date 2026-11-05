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

/** Longest a request may take, as in the API wiki's examples (30 s). */
export const REPEATERBOOK_TIMEOUT_MS = 30_000;

export const TIMEOUT_MESSAGE =
  "RepeaterBook didn't answer within 30 seconds, so the search was stopped. Try again later.";

/**
 * What to tell the user for each error code the API wiki lists (`rate_limited` is handled as a
 * 429). Messages carry the code in parentheses, which the app reads to tell refusals that a new
 * token can fix from ones only an app update can (see `repeaterBookRefusal` in repeaterBookClient.ts).
 */
export const REPEATERBOOK_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  auth_missing: 'RepeaterBook needs your personal app token (rbuapp_...). Paste it in the token field.',
  auth_invalid: "RepeaterBook didn't accept your app token. Check that the whole rbuapp_ token was pasted.",
  auth_inactive: 'RepeaterBook says your token, or its approval of Open_IC980PM, is not active.',
  auth_revoked: "Your RepeaterBook token has been revoked. Generate a new one on RepeaterBook's API Apps page.",
  auth_scope_denied:
    "Your RepeaterBook token isn't approved for this search area (North America and the rest of the world are approved separately).",
  ua_mismatch:
    "RepeaterBook didn't accept this app's User-Agent, so searching is stopped until the app is updated. Please report this at https://github.com/Arsydian/Open_IC980PM/issues.",
};

/** The first error code from the API wiki's list found in a JSON error body, if any. */
export function repeaterBookErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const values: unknown[] = Object.values(body);
  const nested = (body as Record<string, unknown>).error;
  if (nested && typeof nested === 'object') values.push(...Object.values(nested));
  for (const value of values) {
    const code = typeof value === 'string' ? value.trim() : '';
    if (code === 'rate_limited' || Object.hasOwn(REPEATERBOOK_ERROR_MESSAGES, code)) return code;
  }
  return undefined;
}

/** The response body as JSON, or `undefined` when it is empty or not JSON. */
async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetches a RepeaterBook API URL with the registered User-Agent and, when given, the user's token.
 * Gives up after `timeoutMs`.
 */
export async function fetchRepeaterBookJson(
  url: string,
  apiToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REPEATERBOOK_TIMEOUT_MS
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
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await requestJson(url, headers, signal, fetchImpl);
  } catch (err) {
    if (signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw err;
  }
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<unknown> {
  // RepeaterBook: disable automatic redirects for authenticated requests and treat any 3xx as a
  // stop condition, so the token is never re-sent to another URL.
  const response = await fetchImpl(url, { headers, redirect: 'manual', signal });
  if (isRedirectResponse(response)) {
    throw new Error(REDIRECT_STOPPED_MESSAGE);
  }
  // "API errors are returned as JSON when possible", with a code from the wiki's list
  const body = await readJsonBody(response);
  const code = repeaterBookErrorCode(body);
  if (response.status === 429 || code === 'rate_limited') {
    throw new Error(rateLimitMessage(response.headers.get('Retry-After')));
  }
  if (code) {
    throw new Error(`RepeaterBook refused the search (${code}): ${REPEATERBOOK_ERROR_MESSAGES[code]}`);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `RepeaterBook API access denied (HTTP ${response.status}). An approved User-Agent and valid personal app token (rbuapp_...) are required by RepeaterBook.`
      );
    }
    throw new Error(`RepeaterBook API returned HTTP ${response.status}`);
  }
  if (body === undefined) {
    throw new Error('RepeaterBook sent an empty or non-JSON response, so nothing was imported. Try again later.');
  }
  return body;
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
