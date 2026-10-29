/**
 * @file electron/repeaterBookProxy.ts
 * @description RepeaterBook API requests made from the Electron main process (no browser CORS,
 * and the app's User-Agent can be set). Follows the RepeaterBook API wiki: the user's app-bound
 * `rbuapp_` token travels only in the `X-RB-App-Token` header, never in the URL.
 */

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

export const REDIRECT_STOPPED_MESSAGE =
  'RepeaterBook answered with a redirect, so the request was stopped without following it (your token was not re-sent). Try again later.';

/** Whether a `redirect: 'manual'` response is a redirect (Node keeps the 3xx status). */
export function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

/**
 * Fetches a RepeaterBook API URL with the app's User-Agent and, when given, the user's token.
 */
export async function fetchRepeaterBookJson(
  url: string,
  apiToken: string | undefined,
  userAgent: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  if (!isValidRepeaterBookUrl(url)) {
    throw new Error('Access denied: URL must be an official https://www.repeaterbook.com endpoint.');
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': userAgent,
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
      throw new Error('RepeaterBook API rate limit exceeded (HTTP 429). Please wait a moment before trying again.');
    }
    throw new Error(`RepeaterBook API returned HTTP ${response.status}`);
  }
  return response.json();
}
