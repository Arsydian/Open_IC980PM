/**
 * @file src/core/repeaterBookClient.ts
 * @description Live RepeaterBook API query builder, Haversine distance filter, 2m/70cm analog
 * repeater filter, and ChannelRecord normalizer for Open_IC980PM.
 *
 * Implements User Requirement #5 & #6:
 * - Selector for North America (`us_ca` -> `export.php`) vs. Rest of World (`row` -> `exportROW.php`)
 * - Option to query by `(State/Province + City/County)` OR `(Lat/Long + Radius)`
 * - Option to limit the returned list to an arbitrary maximum number (`maxResults`)
 * - Automatic filtering to 2m (`144–148 MHz`) & 70cm (`420–450 MHz`) FM Analog repeaters
 * - Channel name formatted as `City - Callsign` (truncated cleanly to 16 characters)
 */

import type { ChannelRecord, RepeaterBandOptions, RepeaterBookQuery, ToneType } from '../types/radio';
import { CTCSS_TONES, DCS_CODES } from './constants';
import { createEmptyChannel } from './ysfCodec';

/**
 * Header that carries the user's app-bound `rbuapp_` token. The RepeaterBook API wiki calls it
 * the preferred header and documents no URL parameter for tokens.
 */
export const REPEATERBOOK_TOKEN_HEADER = 'X-RB-App-Token';

/** Shortest search lockout after an HTTP 429, used when RepeaterBook sends no longer Retry-After. */
export const MIN_RATE_LIMIT_COOLDOWN_SECONDS = 60;

/**
 * Error text for HTTP 429, including the server's Retry-After (seconds or HTTP date) when sent.
 * Mirrors `rateLimitMessage` in electron/repeaterBookProxy.ts.
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

/**
 * How long to lock RepeaterBook searches after `errorMessage`: `0` unless it is a 429, otherwise the
 * Retry-After it carries, but never less than `MIN_RATE_LIMIT_COOLDOWN_SECONDS`.
 */
export function rateLimitCooldownSeconds(errorMessage: string): number {
  if (!errorMessage.includes('429')) return 0;
  const retryAfter = /Retry after (\d+) seconds/.exec(errorMessage);
  return Math.max(MIN_RATE_LIMIT_COOLDOWN_SECONDS, retryAfter ? parseInt(retryAfter[1], 10) : 0);
}

/** Supported frequency band identifiers for RepeaterBook classification and filtering. */
export type RepeaterBandId = '2m' | '70cm' | 'GMRS' | '1.25m' | 'VHF Ext' | 'UHF Ext';

/** Raw repeater entry returned by the RepeaterBook JSON API (`results[]`). */
export interface RepeaterBookRawEntry {
  'State ID'?: string;
  'Rptr ID'?: string;
  Frequency?: string;
  'Input Freq'?: string;
  PL?: string;
  TSQ?: string;
  Lat?: string;
  Long?: string;
  Callsign?: string;
  'Nearest City'?: string;
  Landmark?: string;
  County?: string;
  State?: string;
  Country?: string;
  Use?: string;
  'Operational Status'?: string;
  'FM Analog'?: string;
  DMR?: string;
  'D-Star'?: string;
  'System Fusion'?: string;
  Notes?: string;
}

/** Normalized repeater candidate with computed distance and formatted `City - Callsign` channel name. */
export interface NormalizedRepeaterCandidate {
  id: string;
  callsign: string;
  city: string;
  state: string;
  country: string;
  rxFreqHz: number;
  txFreqHz: number;
  rxToneType: ToneType;
  rxToneValue: number;
  txToneType: ToneType;
  txToneValue: number;
  band: RepeaterBandId | string;
  distanceMiles?: number;
  formattedChannelName: string;
  channelRecord: ChannelRecord;
  detailUrl?: string;
  rptrId?: string;
}

/** North America US State & Canadian Province codes used by RepeaterBook `state_id` parameter. */
export const US_CA_STATES: ReadonlyArray<{ id: string; name: string }> = [
  { id: '01', name: 'Alabama (AL)' },
  { id: '02', name: 'Alaska (AK)' },
  { id: '04', name: 'Arizona (AZ)' },
  { id: '05', name: 'Arkansas (AR)' },
  { id: '06', name: 'California (CA)' },
  { id: '08', name: 'Colorado (CO)' },
  { id: '09', name: 'Connecticut (CT)' },
  { id: '10', name: 'Delaware (DE)' },
  { id: '11', name: 'District of Columbia (DC)' },
  { id: '12', name: 'Florida (FL)' },
  { id: '13', name: 'Georgia (GA)' },
  { id: '15', name: 'Hawaii (HI)' },
  { id: '16', name: 'Idaho (ID)' },
  { id: '17', name: 'Illinois (IL)' },
  { id: '18', name: 'Indiana (IN)' },
  { id: '19', name: 'Iowa (IA)' },
  { id: '20', name: 'Kansas (KS)' },
  { id: '21', name: 'Kentucky (KY)' },
  { id: '22', name: 'Louisiana (LA)' },
  { id: '23', name: 'Maine (ME)' },
  { id: '24', name: 'Maryland (MD)' },
  { id: '25', name: 'Massachusetts (MA)' },
  { id: '26', name: 'Michigan (MI)' },
  { id: '27', name: 'Minnesota (MN)' },
  { id: '28', name: 'Mississippi (MS)' },
  { id: '29', name: 'Missouri (MO)' },
  { id: '30', name: 'Montana (MT)' },
  { id: '31', name: 'Nebraska (NE)' },
  { id: '32', name: 'Nevada (NV)' },
  { id: '33', name: 'New Hampshire (NH)' },
  { id: '34', name: 'New Jersey (NJ)' },
  { id: '35', name: 'New Mexico (NM)' },
  { id: '36', name: 'New York (NY)' },
  { id: '37', name: 'North Carolina (NC)' },
  { id: '38', name: 'North Dakota (ND)' },
  { id: '39', name: 'Ohio (OH)' },
  { id: '40', name: 'Oklahoma (OK)' },
  { id: '41', name: 'Oregon (OR)' },
  { id: '42', name: 'Pennsylvania (PA)' },
  { id: '44', name: 'Rhode Island (RI)' },
  { id: '45', name: 'South Carolina (SC)' },
  { id: '46', name: 'South Dakota (SD)' },
  { id: '47', name: 'Tennessee (TN)' },
  { id: '48', name: 'Texas (TX)' },
  { id: '49', name: 'Utah (UT)' },
  { id: '50', name: 'Vermont (VT)' },
  { id: '51', name: 'Virginia (VA)' },
  { id: '53', name: 'Washington (WA)' },
  { id: '54', name: 'West Virginia (WV)' },
  { id: '55', name: 'Wisconsin (WI)' },
  { id: '56', name: 'Wyoming (WY)' },
  { id: 'CA01', name: 'Alberta (AB)' },
  { id: 'CA02', name: 'British Columbia (BC)' },
  { id: 'CA03', name: 'Manitoba (MB)' },
  { id: 'CA04', name: 'New Brunswick (NB)' },
  { id: 'CA05', name: 'Newfoundland and Labrador (NL)' },
  { id: 'CA07', name: 'Nova Scotia (NS)' },
  { id: 'CA08', name: 'Ontario (ON)' },
  { id: 'CA09', name: 'Prince Edward Island (PE)' },
  { id: 'CA10', name: 'Quebec (QC)' },
  { id: 'CA11', name: 'Saskatchewan (SK)' },
];

/**
 * Formats a channel name as `City - Callsign`, truncated cleanly to the 16-byte hardware limit.
 * If adding the full city name would truncate the callsign, it shortens the city portion first
 * so the callsign remains intact whenever possible.
 */
export function formatCityCallsignName(city: string, callsign: string): string {
  const cleanCity = (city || '').replace(/[^\x20-\x7E]/g, '').trim();
  const cleanCall = (callsign || '').replace(/[^\x20-\x7E]/g, '').trim().toUpperCase();

  if (!cleanCity && !cleanCall) return 'REPEATER';
  if (!cleanCity) return cleanCall.slice(0, 16);
  if (!cleanCall) return cleanCity.slice(0, 16);

  const full = `${cleanCity} - ${cleanCall}`;
  if (full.length <= 16) {
    return full;
  }

  // Preserve the callsign if we can fit "City-Callsign" or shortened city + " - " + Callsign
  const sep = ' - ';
  const availableForCity = 16 - sep.length - cleanCall.length;
  if (availableForCity >= 3) {
    return `${cleanCity.slice(0, availableForCity)}${sep}${cleanCall}`;
  }

  const compactSep = '-';
  const compactAvailable = 16 - compactSep.length - cleanCall.length;
  if (compactAvailable >= 2) {
    return `${cleanCity.slice(0, compactAvailable)}${compactSep}${cleanCall}`;
  }

  return full.slice(0, 16).trim();
}

/**
 * Computes the great-circle distance between two coordinates in Statute Miles using the Haversine formula.
 */
export function computeHaversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R_MILES = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_MILES * c;
}

/**
 * Parses a RepeaterBook `PL` or `TSQ` string (e.g., `"100.0"`, `"D023N"`, `"D023I"`, `"CSQ"`, `""`)
 * into a `ToneType` and numeric value.
 */
export function parseRepeaterBookTone(toneStr?: string): { type: ToneType; value: number } {
  if (!toneStr) {
    return { type: 'None', value: CTCSS_TONES[0] };
  }
  const s = toneStr.trim().toUpperCase();
  if (!s || s === 'CSQ' || s === 'NONE' || s === 'OPEN' || s === '0' || s === '0.0') {
    return { type: 'None', value: CTCSS_TONES[0] };
  }

  // Check DCS format: D023N, D023I, D023, etc.
  const dcsMatch = /^D?(\d{3})([NI])?$/i.exec(s);
  if (dcsMatch) {
    const code = parseInt(dcsMatch[1], 10);
    const polarity = dcsMatch[2] === 'I' ? 'DCS_I' : 'DCS_N';
    const validCode = DCS_CODES.includes(code) ? code : DCS_CODES[0];
    return { type: polarity, value: validCode };
  }

  // Check CTCSS frequency in Hz
  const hz = parseFloat(s);
  if (Number.isFinite(hz) && hz >= 60.0 && hz <= 260.0) {
    // Snap to closest standard CTCSS tone
    let closest = CTCSS_TONES[0];
    let minDiff = Math.abs(hz - closest);
    for (const t of CTCSS_TONES) {
      const diff = Math.abs(hz - t);
      if (diff < minDiff) {
        minDiff = diff;
        closest = t;
      }
    }
    return { type: 'CTCSS', value: closest };
  }

  return { type: 'None', value: CTCSS_TONES[0] };
}

/**
 * Builds the RepeaterBook API URL for a given `RepeaterBookQuery`.
 */
export function buildRepeaterBookApiUrl(query: RepeaterBookQuery): string {
  const baseUrl =
    query.region === 'row'
      ? 'https://www.repeaterbook.com/api/exportROW.php'
      : 'https://www.repeaterbook.com/api/export.php';

  const params = new URLSearchParams();

  if (
    query.searchMode === 'proximity' &&
    typeof query.latitude === 'number' &&
    typeof query.longitude === 'number' &&
    Number.isFinite(query.latitude) &&
    Number.isFinite(query.longitude)
  ) {
    // Native RepeaterBook Proximity Search (qtype=prox)
    params.set('qtype', 'prox');
    params.set('lat', query.latitude.toString());
    params.set('lng', query.longitude.toString());
    const radius = query.radius && query.radius > 0 ? query.radius : 35;
    params.set('dist', radius.toString());
    params.set('dunit', query.distanceUnit === 'km' ? 'km' : 'mi');
  } else {
    // Location / Regional Search (State/Province or Country + City)
    if (query.country && query.country.trim()) {
      params.set('country', query.country.trim());
    }
    if (query.state && query.state.trim()) {
      params.set('state_id', query.state.trim());
    }
    if (query.city && query.city.trim()) {
      params.set('city', query.city.trim());
    }
  }

  // The user's token is never put in the URL (it would end up in logs and history); it is sent
  // in the X-RB-App-Token header by queryRepeaterBookApi / the Electron proxy instead.
  const qs = params.toString();
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

/**
 * Classifies a repeater output frequency into standard amateur or out-of-band / unlocked bands.
 */
export function classifyRepeaterBand(
  rxMhz: number
): { bandId: RepeaterBandId; isDefaultBand: boolean } | null {
  if (rxMhz >= 144.0 && rxMhz <= 148.0) {
    return { bandId: '2m', isDefaultBand: true };
  }
  if (rxMhz >= 420.0 && rxMhz <= 450.0) {
    return { bandId: '70cm', isDefaultBand: true };
  }
  // GMRS Repeater pairs: 462.5500–462.7250 MHz output (+5 MHz input 467.5500–467.7250 MHz)
  if ((rxMhz >= 462.55 && rxMhz <= 462.7375) || (rxMhz >= 467.55 && rxMhz <= 467.7375)) {
    return { bandId: 'GMRS', isDefaultBand: false };
  }
  // 1.25m Amateur Band (222–225 MHz)
  if (rxMhz >= 222.0 && rxMhz <= 225.0) {
    return { bandId: '1.25m', isDefaultBand: false };
  }
  // Extended VHF (136–174 MHz outside 2m amateur band)
  if (rxMhz >= 136.0 && rxMhz <= 174.0) {
    return { bandId: 'VHF Ext', isDefaultBand: false };
  }
  // Extended UHF (400–520 MHz outside 70cm amateur band and GMRS)
  if (rxMhz >= 400.0 && rxMhz <= 520.0) {
    return { bandId: 'UHF Ext', isDefaultBand: false };
  }
  return null;
}

/**
 * Checks whether a given band is permitted under the active query band options.
 */
export function isBandAllowed(bandId: RepeaterBandId, bands?: RepeaterBandOptions): boolean {
  if (!bands) {
    // Default radio configuration: only standard 2m and 70cm amateur bands
    return bandId === '2m' || bandId === '70cm';
  }
  switch (bandId) {
    case '2m':
      return bands.include2m !== false;
    case '70cm':
      return bands.include70cm !== false;
    case 'GMRS':
      return Boolean(bands.includeGmrs);
    case '1.25m':
      return Boolean(bands.include125m);
    case 'VHF Ext':
      return Boolean(bands.includeVhfExt);
    case 'UHF Ext':
      return Boolean(bands.includeUhfExt);
    default:
      return false;
  }
}

/**
 * Filters and normalizes raw RepeaterBook entries according to User Requirement #5:
 * - Automatically filters to 2m, 70cm, or selected unlocked bands (GMRS, 1.25m, Extended VHF/UHF)
 * - Filters by City/State or Lat/Long + Radius (Haversine distance)
 * - Formats each channel name as `City - Callsign`
 * - Limits the returned list to `query.maxResults` (`N`)
 */
export function filterAndNormalizeRepeaterBookResults(
  rawResults: RepeaterBookRawEntry[],
  query: RepeaterBookQuery
): NormalizedRepeaterCandidate[] {
  const candidates: NormalizedRepeaterCandidate[] = [];

  const maxRadiusMiles =
    query.radius && query.radius > 0
      ? query.distanceUnit === 'km'
        ? query.radius * 0.621371
        : query.radius
      : undefined;

  const cityFilter =
    query.searchMode === 'location' && query.city ? query.city.trim().toLowerCase() : '';

  // In location mode with a city, find the center coordinates of that city to anchor the radius filter
  let cityCenterLat: number | undefined;
  let cityCenterLon: number | undefined;
  if (query.searchMode === 'location' && cityFilter) {
    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    for (let j = 0; j < rawResults.length; j++) {
      const r = rawResults[j];
      const rCity = (r['Nearest City'] || r.County || r.Landmark || '').trim().toLowerCase();
      if (rCity.includes(cityFilter) || cityFilter.includes(rCity)) {
        const lat = parseFloat(r.Lat || '');
        const lon = parseFloat(r.Long || '');
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          sumLat += lat;
          sumLon += lon;
          count++;
        }
      }
    }
    if (count > 0) {
      cityCenterLat = sumLat / count;
      cityCenterLon = sumLon / count;
    }
  }

  for (let i = 0; i < rawResults.length; i++) {
    const entry = rawResults[i];

    // 1. Check Operational Status if openOnly is enabled
    if (query.openOnly !== false) {
      const status = (entry['Operational Status'] || '').toLowerCase();
      if (status.includes('off-air') || status.includes('off air')) {
        continue;
      }
    }

    // 2. Check FM Analog capability (default to true if 'FM Analog' is 'Yes' or not explicitly 'No')
    const fmAnalog = (entry['FM Analog'] || 'Yes').trim().toLowerCase();
    if (fmAnalog === 'no') {
      continue;
    }

    // 3. Classify Output (RX) and Input (TX) Frequencies and check against allowed bands
    const rxMhz = parseFloat(entry.Frequency || '');
    if (!Number.isFinite(rxMhz)) continue;

    const classified = classifyRepeaterBand(rxMhz);
    if (!classified || !isBandAllowed(classified.bandId, query.bands)) {
      continue;
    }

    const band: RepeaterBandId = classified.bandId;

    const txMhzRaw = parseFloat(entry['Input Freq'] || '');
    const txMhz = Number.isFinite(txMhzRaw) && txMhzRaw >= 100.0 ? txMhzRaw : rxMhz;

    const rxFreqHz = Math.round(rxMhz * 1_000_000);
    const txFreqHz = Math.round(txMhz * 1_000_000);

    // 4. Geographic scoping & radius filtering
    const city = (entry['Nearest City'] || entry.County || entry.Landmark || '').trim();
    const county = (entry.County || '').trim();
    const rLat = parseFloat(entry.Lat || '');
    const rLon = parseFloat(entry.Long || '');
    const hasCoords = Number.isFinite(rLat) && Number.isFinite(rLon);

    let distanceMiles: number | undefined;

    if (
      query.searchMode === 'proximity' &&
      typeof query.latitude === 'number' &&
      typeof query.longitude === 'number' &&
      Number.isFinite(query.latitude) &&
      Number.isFinite(query.longitude)
    ) {
      if (!hasCoords) continue;
      distanceMiles = computeHaversineMiles(query.latitude, query.longitude, rLat, rLon);
      if (maxRadiusMiles !== undefined && distanceMiles > maxRadiusMiles) {
        continue;
      }
    } else if (query.searchMode === 'location' && cityFilter) {
      if (cityCenterLat !== undefined && cityCenterLon !== undefined && hasCoords) {
        distanceMiles = computeHaversineMiles(cityCenterLat, cityCenterLon, rLat, rLon);
        if (maxRadiusMiles !== undefined && distanceMiles > maxRadiusMiles) {
          continue;
        }
      } else {
        const matchesCity = city.toLowerCase().includes(cityFilter);
        const matchesCounty = county.toLowerCase().includes(cityFilter);
        if (!matchesCity && !matchesCounty) {
          continue;
        }
      }
    }

    // 6. Parse Subaudio Tones (PL = TX tone to open repeater, TSQ = RX tone squelch)
    const txTone = parseRepeaterBookTone(entry.PL);
    const rxTone = parseRepeaterBookTone(entry.TSQ);

    const callsign = (entry.Callsign || '').trim().toUpperCase();
    const state = (entry.State || entry['State ID'] || '').trim();
    const country = (entry.Country || (query.region === 'us_ca' ? 'US/CA' : '')).trim();
    const formattedChannelName = formatCityCallsignName(city, callsign);

    const ch = createEmptyChannel(1);
    ch.used = true;
    ch.rxFreqHz = rxFreqHz;
    ch.txFreqHz = txFreqHz;
    ch.txToneType = txTone.type;
    ch.txToneValue = txTone.value;
    ch.rxToneType = rxTone.type;
    ch.rxToneValue = rxTone.value;
    ch.power = 'High';
    ch.bandwidth = 'Wide';
    ch.modulation = 'FM';
    ch.scanAdd = true;
    const rptrId = entry['Rptr ID'];
    const stateId = entry['State ID'] || entry.State;
    const detailUrl = rptrId && stateId
      ? `https://www.repeaterbook.com/repeaters/details.php?state_id=${encodeURIComponent(stateId)}&ID=${encodeURIComponent(rptrId)}`
      : 'https://www.repeaterbook.com';

    ch.name = formattedChannelName;
    ch.metadata = {
      source: 'repeaterbook',
      callsign,
      city,
      state,
      distanceMiles: distanceMiles !== undefined ? Number(distanceMiles.toFixed(1)) : undefined,
      notes: `Data courtesy of RepeaterBook.com.${entry.Notes ? ' • ' + entry.Notes : ''}`,
    };

    candidates.push({
      id: `${entry['State ID'] || 'RB'}-${entry['Rptr ID'] || i}-${rxFreqHz}`,
      callsign,
      city,
      state,
      country,
      rxFreqHz,
      txFreqHz,
      rxToneType: rxTone.type,
      rxToneValue: rxTone.value,
      txToneType: txTone.type,
      txToneValue: txTone.value,
      band,
      distanceMiles: distanceMiles !== undefined ? Number(distanceMiles.toFixed(1)) : undefined,
      formattedChannelName,
      channelRecord: ch,
      detailUrl,
      rptrId,
    });
  }

  // Sort by distance if distance was computed, otherwise by city then frequency
  if (query.searchMode === 'proximity' || (query.searchMode === 'location' && cityCenterLat !== undefined)) {
    candidates.sort((a, b) => (a.distanceMiles ?? 99999) - (b.distanceMiles ?? 99999));
  } else {
    candidates.sort((a, b) => a.city.localeCompare(b.city) || a.rxFreqHz - b.rxFreqHz);
  }

  // Apply result limit capped at 100
  const requestedLimit = query.maxResults > 0 ? Math.floor(query.maxResults) : candidates.length;
  const limit = Math.min(100, requestedLimit);
  return candidates.slice(0, limit);
}

interface CachedApiResponse {
  timestamp: number;
  data: RepeaterBookRawEntry[];
}

const queryCache = new Map<string, CachedApiResponse>();
export const REPEATERBOOK_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute session cache for duplicate suppression

/** Clears all cached RepeaterBook query responses (useful for manual refresh or tests). */
export function clearRepeaterBookCache(): void {
  queryCache.clear();
}

/**
 * Executes a live RepeaterBook API query using either the Electron IPC proxy (no CORS)
 * or direct `fetch` in Web/PWA environments.
 *
 * Implements Duplicate Suppression: identical queries within a 5-minute window are served
 * immediately from local session memory to eliminate redundant hits on RepeaterBook servers.
 */
export async function queryRepeaterBookApi(
  query: RepeaterBookQuery
): Promise<NormalizedRepeaterCandidate[]> {
  const url = buildRepeaterBookApiUrl(query);
  const cacheKey = `${url}|${query.apiToken || ''}`;

  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REPEATERBOOK_CACHE_TTL_MS) {
    return filterAndNormalizeRepeaterBookResults(cached.data, query);
  }

  let jsonPayload: unknown;
  if (typeof window !== 'undefined' && window.api?.fetchRepeaterBookJson) {
    jsonPayload = await window.api.fetchRepeaterBookJson(url, query.apiToken);
  } else {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Open_IC980PM/1.0 (https://github.com/Arsydian/Open_IC980PM; open-source-cps)',
    };
    if (query.apiToken && query.apiToken.trim()) {
      headers[REPEATERBOOK_TOKEN_HEADER] = query.apiToken.trim();
    }
    // RepeaterBook: never follow redirects on authenticated requests; a 3xx is a stop condition
    // (browsers report it as an opaque redirect with status 0).
    const response = await fetch(url, { headers, redirect: 'manual' });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new Error(
        'RepeaterBook answered with a redirect, so the request was stopped without following it (your token was not re-sent). Try again later.'
      );
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
    jsonPayload = await response.json();
  }

  const rawArray: RepeaterBookRawEntry[] = Array.isArray(
    (jsonPayload as { results?: RepeaterBookRawEntry[] })?.results
  )
    ? (jsonPayload as { results: RepeaterBookRawEntry[] }).results
    : Array.isArray(jsonPayload)
    ? (jsonPayload as RepeaterBookRawEntry[])
    : [];

  queryCache.set(cacheKey, { timestamp: Date.now(), data: rawArray });

  return filterAndNormalizeRepeaterBookResults(rawArray, query);
}
