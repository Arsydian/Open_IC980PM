/**
 * @file src/core/repeaterBookClient.ts
 * @description Live RepeaterBook API query builder, Haversine distance filter, 2m/70cm analog
 * repeater filter, and ChannelRecord normalizer for Open_IC980PM.
 *
 * Implements User Requirement #5 & #6:
 * - Selector for North America (`us_ca` -> `export.php`) vs. Rest of World (`row` -> `exportROW.php`)
 * - Queries use only parameters the RepeaterBook API wiki documents: `state_id` (FIPS) + `city` on
 *   export.php (plus `stype=gmrs` for GMRS), `country` + `city` on exportROW.php; the radius around
 *   the city is applied in the app
 * - Option to limit the returned list to a maximum number (`maxResults`, up to 100)
 * - Automatic filtering to 2m (`144–148 MHz`) & 70cm (`420–450 MHz`) FM Analog repeaters
 * - Channel name formatted as `City - Callsign` (truncated cleanly to 16 characters)
 */

import type { ChannelRecord, RepeaterBandOptions, RepeaterBookQuery, ToneType } from '../types/radio';
import { CTCSS_TONES, DCS_CODES } from './constants';
import { createEmptyChannel } from './ysfCodec';

/** Shortest search lockout after an HTTP 429, used when RepeaterBook sends no longer Retry-After. */
export const MIN_RATE_LIMIT_COOLDOWN_SECONDS = 60;

/**
 * Shown when RepeaterBook search is attempted outside the desktop app. Browsers cannot send the
 * User-Agent registered with RepeaterBook, whose terms say browser-default User-Agents may be rejected.
 */
export const REPEATERBOOK_DESKTOP_ONLY_MESSAGE =
  'RepeaterBook search needs the Open_IC980PM desktop app: browsers cannot send the User-Agent registered with RepeaterBook. CHIRP CSV import and Quick-Packs work here.';

/** Whether RepeaterBook queries can be made here (only through the Electron proxy). */
export function isRepeaterBookAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.api?.fetchRepeaterBookJson === 'function';
}

/**
 * How long to lock RepeaterBook searches after `errorMessage` (as produced by `rateLimitMessage` in
 * electron/repeaterBookProxy.ts): `0` unless it is a 429, otherwise the Retry-After it carries, but
 * never less than `MIN_RATE_LIMIT_COOLDOWN_SECONDS`.
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
  NXDN?: string;
  'APCO P-25'?: string;
  M17?: string;
  Tetra?: string;
  'System Fusion'?: string;
  Notes?: string;
}

/**
 * The names each field may arrive under. The API wiki lists fields only by display label
 * ("Input Frequency", "Analog Capable", ...), so those labels are accepted after the JSON keys
 * RepeaterBook's export has used.
 */
const REPEATERBOOK_FIELD_ALIASES: Record<keyof RepeaterBookRawEntry, readonly string[]> = {
  'State ID': ['State ID', 'State ID (FIPS)'],
  'Rptr ID': ['Rptr ID', 'Repeater ID'],
  Frequency: ['Frequency'],
  'Input Freq': ['Input Freq', 'Input Frequency'],
  PL: ['PL', 'PL/CTCSS Uplink'],
  TSQ: ['TSQ', 'PL/CTCSS TSQ Downlink'],
  Lat: ['Lat', 'Latitude'],
  Long: ['Long', 'Longitude'],
  Callsign: ['Callsign'],
  'Nearest City': ['Nearest City', 'Location/Nearest City'],
  Landmark: ['Landmark'],
  County: ['County', 'County (US only)'],
  State: ['State'],
  Country: ['Country'],
  Use: ['Use', 'Use/Membership'],
  'Operational Status': ['Operational Status'],
  'FM Analog': ['FM Analog', 'Analog Capable'],
  DMR: ['DMR', 'DMR Capable'],
  'D-Star': ['D-Star', 'D-Star Capable'],
  NXDN: ['NXDN', 'NXDN Capable'],
  'APCO P-25': ['APCO P-25', 'P-25 Capable'],
  M17: ['M17'],
  Tetra: ['Tetra', 'Tetra Capable'],
  'System Fusion': ['System Fusion', 'Yaesu System Fusion Capable'],
  Notes: ['Notes'],
};

/** Fields without which no repeater can be programmed, with how to name them to the user. */
const REQUIRED_REPEATERBOOK_FIELDS: ReadonlyArray<[keyof RepeaterBookRawEntry, string]> = [
  ['Frequency', 'output frequency'],
  ['Input Freq', 'input frequency'],
];

/** Digital modes RepeaterBook flags per repeater. */
const DIGITAL_MODE_FIELDS: ReadonlyArray<keyof RepeaterBookRawEntry> = [
  'DMR',
  'D-Star',
  'NXDN',
  'APCO P-25',
  'M17',
  'Tetra',
  'System Fusion',
];

/** Thrown when a RepeaterBook response is not laid out the way this app reads it. */
export const REPEATERBOOK_FORMAT_MESSAGE =
  "RepeaterBook's response wasn't in a format this app recognises, so nothing was imported. Please report this at https://github.com/Arsydian/Open_IC980PM/issues.";

/** Copies a raw result into `RepeaterBookRawEntry` keys, taking the first alias that has a value. */
function canonicalizeEntry(raw: Record<string, unknown>): RepeaterBookRawEntry {
  const entry: RepeaterBookRawEntry = {};
  for (const [field, aliases] of Object.entries(REPEATERBOOK_FIELD_ALIASES) as [
    keyof RepeaterBookRawEntry,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const value = raw[alias];
      if (typeof value === 'string' && value.trim()) {
        entry[field] = value;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        entry[field] = String(value);
      } else if (typeof value === 'boolean') {
        entry[field] = value ? 'Yes' : 'No';
      } else {
        continue;
      }
      break;
    }
  }
  return entry;
}

/**
 * The repeaters in a RepeaterBook response (`{ results: [...] }` or a bare array), with field
 * names normalised. Throws rather than returning nothing when the layout or the frequency fields
 * aren't recognised, so a format change can't pass for "no repeaters found".
 */
export function extractRepeaterBookEntries(payload: unknown): RepeaterBookRawEntry[] {
  let items: unknown[];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      items = obj.results;
    } else if (obj.count === 0 || obj.count === '0') {
      return [];
    } else {
      const serverMessage = [obj.message, obj.error].find(
        (m): m is string => typeof m === 'string' && m.trim() !== ''
      );
      throw new Error(serverMessage ? `RepeaterBook: ${serverMessage.trim().slice(0, 200)}` : REPEATERBOOK_FORMAT_MESSAGE);
    }
  } else {
    throw new Error(REPEATERBOOK_FORMAT_MESSAGE);
  }
  if (items.length === 0) return [];

  const rows = items.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  );
  // A field counts as present when any row has the key, even blank, so one repeater with a
  // blank input frequency is skipped later instead of failing the whole search
  const missing = REQUIRED_REPEATERBOOK_FIELDS.filter(
    ([field]) => !rows.some((row) => REPEATERBOOK_FIELD_ALIASES[field].some((alias) => alias in row))
  ).map(([, label]) => label);
  if (rows.length === 0 || missing.length > 0) {
    throw new Error(missing.length > 0 ? `${REPEATERBOOK_FORMAT_MESSAGE} Missing: ${missing.join(', ')}.` : REPEATERBOOK_FORMAT_MESSAGE);
  }
  return rows.map(canonicalizeEntry);
}

/**
 * Whether a repeater carries FM analog. Without an analog field, a repeater that lists any digital
 * mode counts as digital-only, so a missing field can't turn a DMR repeater into an FM channel.
 */
function isFmAnalog(entry: RepeaterBookRawEntry): boolean {
  const analog = (entry['FM Analog'] || '').trim().toLowerCase();
  if (analog) return analog !== 'no';
  return !DIGITAL_MODE_FIELDS.some((field) => (entry[field] || '').trim().toLowerCase() === 'yes');
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

/**
 * `state_id` values for North America. The RepeaterBook API wiki describes the field as
 * "State ID (FIPS)": US states use FIPS 5-2 codes, Canadian provinces and territories FIPS 10-4 codes.
 */
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
  { id: 'CA12', name: 'Yukon (YT)' },
  { id: 'CA13', name: 'Northwest Territories (NT)' },
  { id: 'CA14', name: 'Nunavut (NU)' },
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

/** RepeaterBook keeps GMRS repeaters apart from amateur ones; GMRS searches need `stype=gmrs`. */
export type RepeaterBookService = 'amateur' | 'gmrs';

/**
 * The RepeaterBook searches a query needs: the amateur search when any amateur or extended band
 * is enabled, and a separate `stype=gmrs` search when GMRS is enabled (US/Canada only).
 */
export function buildRepeaterBookApiUrls(query: RepeaterBookQuery): string[] {
  const nonGmrsBands: RepeaterBandId[] = ['2m', '70cm', '1.25m', 'VHF Ext', 'UHF Ext'];
  const urls: string[] = [];
  if (nonGmrsBands.some((band) => isBandAllowed(band, query.bands))) {
    urls.push(buildRepeaterBookApiUrl(query, 'amateur'));
  }
  if (query.region === 'us_ca' && isBandAllowed('GMRS', query.bands)) {
    urls.push(buildRepeaterBookApiUrl(query, 'gmrs'));
  }
  return urls;
}

/**
 * Builds the RepeaterBook API URL for a given `RepeaterBookQuery` and service.
 */
export function buildRepeaterBookApiUrl(query: RepeaterBookQuery, service: RepeaterBookService = 'amateur'): string {
  const baseUrl =
    query.region === 'row'
      ? 'https://www.repeaterbook.com/api/exportROW.php'
      : 'https://www.repeaterbook.com/api/export.php';

  // Only parameters the RepeaterBook API wiki documents for each endpoint:
  //   export.php:    state_id (FIPS), city, stype (required for GMRS searches)
  //   exportROW.php: country, city
  const params = new URLSearchParams();
  if (query.region === 'row') {
    if (query.country && query.country.trim()) {
      params.set('country', query.country.trim());
    }
  } else if (query.state && query.state.trim()) {
    params.set('state_id', query.state.trim());
  }
  if (query.city && query.city.trim()) {
    params.set('city', query.city.trim());
  }
  if (service === 'gmrs' && query.region === 'us_ca') {
    params.set('stype', 'gmrs');
  }

  // The user's token is never put in the URL (it would end up in logs and history); it is sent
  // in the X-RB-App-Token header by the Electron proxy instead.
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
 * Whether a repeater's (lower-case) city belongs to the searched city: the city contains the search
 * text ("san francisco" for "francisco"), or appears as whole words in it ("nashville" for
 * "nashville tn"). A blank city never matches, and "ada" does not match "adams".
 */
export function cityMatchesFilter(city: string, filter: string): boolean {
  if (!city || !filter) return false;
  if (city.includes(filter)) return true;
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(filter);
}

/**
 * A repeater's position, or `undefined` when it is missing, out of range, or 0/0 (a placeholder
 * for "unknown", which would otherwise drag the city centre thousands of miles away).
 */
export function parseRepeaterCoordinates(entry: RepeaterBookRawEntry): { lat: number; lon: number } | undefined {
  const lat = parseFloat(entry.Lat || '');
  const lon = parseFloat(entry.Long || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return undefined;
  return { lat, lon };
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

  const cityFilter = query.city ? query.city.trim().toLowerCase() : '';

  // With a city, find the center coordinates of that city to anchor the radius filter
  let cityCenterLat: number | undefined;
  let cityCenterLon: number | undefined;
  if (cityFilter) {
    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    for (let j = 0; j < rawResults.length; j++) {
      const r = rawResults[j];
      const rCity = (r['Nearest City'] || r.County || r.Landmark || '').trim().toLowerCase();
      const coords = parseRepeaterCoordinates(r);
      if (coords && cityMatchesFilter(rCity, cityFilter)) {
        sumLat += coords.lat;
        sumLon += coords.lon;
        count++;
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

    // 2. Check FM Analog capability
    if (!isFmAnalog(entry)) {
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

    // Without a usable input frequency the repeater is skipped: using the output frequency instead
    // would program it simplex, transmitting on top of the repeater's users
    const txMhz = parseFloat(entry['Input Freq'] || '');
    if (!Number.isFinite(txMhz) || txMhz < 100.0) continue;

    const rxFreqHz = Math.round(rxMhz * 1_000_000);
    const txFreqHz = Math.round(txMhz * 1_000_000);

    // 4. Geographic scoping & radius filtering
    const city = (entry['Nearest City'] || entry.County || entry.Landmark || '').trim();
    const county = (entry.County || '').trim();
    const coords = parseRepeaterCoordinates(entry);

    let distanceMiles: number | undefined;

    if (cityFilter) {
      if (cityCenterLat !== undefined && cityCenterLon !== undefined && coords) {
        distanceMiles = computeHaversineMiles(cityCenterLat, cityCenterLon, coords.lat, coords.lon);
        if (maxRadiusMiles !== undefined && distanceMiles > maxRadiusMiles) {
          continue;
        }
      } else if (
        !cityMatchesFilter(city.toLowerCase(), cityFilter) &&
        !cityMatchesFilter(county.toLowerCase(), cityFilter)
      ) {
        // No position to measure from: keep it only if it is listed under the searched city
        continue;
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
  if (cityCenterLat !== undefined) {
    candidates.sort((a, b) => (a.distanceMiles ?? 99999) - (b.distanceMiles ?? 99999));
  } else {
    candidates.sort((a, b) => a.city.localeCompare(b.city) || a.rxFreqHz - b.rxFreqHz);
  }

  // Apply result limit capped at 100
  const requestedLimit = query.maxResults > 0 ? Math.floor(query.maxResults) : candidates.length;
  const limit = Math.min(100, requestedLimit);
  return candidates.slice(0, limit);
}

/**
 * What to tell the user when the radius could not be applied to some or all `results` because
 * RepeaterBook gave no usable position for them, so they were matched by city name instead.
 */
export function radiusNotice(results: NormalizedRepeaterCandidate[], query: RepeaterBookQuery): string | undefined {
  const city = query.city?.trim();
  if (!city || !query.radius || results.length === 0) return undefined;
  const unplaced = results.filter((r) => r.distanceMiles === undefined).length;
  if (unplaced === 0) return undefined;
  if (unplaced === results.length) {
    const unit = query.distanceUnit === 'km' ? 'km' : 'mile';
    return `RepeaterBook gave no locations for these repeaters, so the ${query.radius} ${unit} radius wasn't applied: these are the repeaters it lists under "${city}".`;
  }
  return unplaced === 1
    ? `1 of these repeaters has no location, so it was matched by city name instead of distance.`
    : `${unplaced} of these repeaters have no location, so they were matched by city name instead of distance.`;
}

interface CachedApiResponse {
  timestamp: number;
  data: RepeaterBookRawEntry[];
}

const queryCache = new Map<string, CachedApiResponse>();
export const REPEATERBOOK_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute session cache for duplicate suppression
/** Most queries kept in the cache; RepeaterBook asks clients to cache only what the workflow needs. */
export const REPEATERBOOK_CACHE_MAX_ENTRIES = 20;

/** Number of query responses currently cached (for tests). */
export function repeaterBookCacheSize(): number {
  return queryCache.size;
}

/** Stores a response, dropping expired entries and then the oldest beyond the size cap. */
function cacheResponse(key: string, data: RepeaterBookRawEntry[], now: number): void {
  for (const [k, entry] of queryCache) {
    if (now - entry.timestamp >= REPEATERBOOK_CACHE_TTL_MS) queryCache.delete(k);
  }
  queryCache.delete(key);
  queryCache.set(key, { timestamp: now, data });
  while (queryCache.size > REPEATERBOOK_CACHE_MAX_ENTRIES) {
    const oldest = queryCache.keys().next().value as string;
    queryCache.delete(oldest);
  }
}

/** Clears all cached RepeaterBook query responses (useful for manual refresh or tests). */
export function clearRepeaterBookCache(): void {
  queryCache.clear();
}

/**
 * Executes a live RepeaterBook API query through the Electron main-process proxy
 * (electron/repeaterBookProxy.ts), which sends the registered User-Agent and the token header.
 * Throws `REPEATERBOOK_DESKTOP_ONLY_MESSAGE` anywhere else.
 *
 * Implements Duplicate Suppression: identical queries within a 5-minute window are served
 * immediately from local session memory to eliminate redundant hits on RepeaterBook servers.
 */
export async function queryRepeaterBookApi(
  query: RepeaterBookQuery
): Promise<NormalizedRepeaterCandidate[]> {
  if (!isRepeaterBookAvailable()) {
    throw new Error(REPEATERBOOK_DESKTOP_ONLY_MESSAGE);
  }

  // One request per needed search (amateur, and GMRS via stype=gmrs), made one after another
  const combined: RepeaterBookRawEntry[] = [];
  const seen = new Set<string>();
  for (const url of buildRepeaterBookApiUrls(query)) {
    const cacheKey = `${url}|${query.apiToken || ''}`;
    const cached = queryCache.get(cacheKey);
    let rawArray: RepeaterBookRawEntry[];
    if (cached && Date.now() - cached.timestamp < REPEATERBOOK_CACHE_TTL_MS) {
      rawArray = cached.data;
    } else {
      const jsonPayload: unknown = await window.api!.fetchRepeaterBookJson(url, query.apiToken);
      rawArray = extractRepeaterBookEntries(jsonPayload);
      cacheResponse(cacheKey, rawArray, Date.now());
    }
    for (const entry of rawArray) {
      const key = `${entry['State ID'] ?? ''}|${entry['Rptr ID'] ?? ''}|${entry.Frequency ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(entry);
      }
    }
  }

  return filterAndNormalizeRepeaterBookResults(combined, query);
}
