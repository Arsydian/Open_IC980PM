/**
 * @file src/core/codeplugValidator.ts
 * @description Shared band-limit check and the pre-write validator that blocks codeplugs the
 * radio cannot use (out-of-band frequencies, invalid tones, bad band limits or password).
 */

import type { BandLimitsConfig, RadioCodeplug, ToneType } from '../types/radio';
import { CTCSS_TONES, DCS_CODES } from './constants';

/** A problem that must be fixed before the codeplug may be written to the radio. */
export interface CodeplugIssue {
  /** Where the problem is, e.g. `Channel 12 "W1AW"`, `VFO A`, `Band limits`. */
  location: string;
  message: string;
}

/** Lowest / highest band limit (MHz) the `.Ysf` and EEPROM codecs can represent. */
const BAND_LIMIT_MIN_MHZ = 18.0;
const BAND_LIMIT_MAX_MHZ = 999.0;

/**
 * Checks whether a frequency in Hz falls within the configured VHF or UHF band limits.
 * Non-positive frequencies (empty fields) are treated as in band.
 */
export function isFrequencyInBand(freqHz: number, limits: BandLimitsConfig): boolean {
  if (freqHz <= 0) return true;
  const mhz = freqHz / 1_000_000;
  const inVhf = mhz >= limits.vhfMinMhz - 0.0001 && mhz <= limits.vhfMaxMhz + 0.0001;
  const inUhf = mhz >= limits.uhfMinMhz - 0.0001 && mhz <= limits.uhfMaxMhz + 0.0001;
  return inVhf || inUhf;
}

const formatMhz = (hz: number) => `${(hz / 1_000_000).toFixed(5)} MHz`;

const describeLimits = (l: BandLimitsConfig) =>
  `VHF ${l.vhfMinMhz}–${l.vhfMaxMhz} MHz, UHF ${l.uhfMinMhz}–${l.uhfMaxMhz} MHz`;

function toneProblem(type: ToneType, value: number): string | null {
  if (type === 'CTCSS' && !CTCSS_TONES.includes(value)) {
    return `${value} Hz is not a standard CTCSS tone`;
  }
  if ((type === 'DCS_N' || type === 'DCS_I') && !DCS_CODES.includes(value)) {
    return `D${String(value).padStart(3, '0')} is not a valid DCS code`;
  }
  return null;
}

/** Largest custom subaudio value the radio's 16-bit channel tone word can hold. */
export const MAX_RADIO_CUSTOM_SUBAUDIO = 0xffff;

function customSubaudioProblem(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{1,8}$/.test(hex)) {
    return `"${hex}" is not a hex value.`;
  }
  if (parseInt(hex, 16) > MAX_RADIO_CUSTOM_SUBAUDIO) {
    return `${hex.toUpperCase()} does not fit the radio's 16-bit field (0000–FFFF); only the last 4 hex digits would be stored.`;
  }
  return null;
}

/**
 * Lists everything that must be fixed before `codeplug` is written to the radio.
 * An empty array means the codeplug may be written.
 */
export function validateCodeplugForWrite(codeplug: RadioCodeplug): CodeplugIssue[] {
  const issues: CodeplugIssue[] = [];
  const limits = codeplug.bandLimits;

  // 1. Band limits must be representable and ordered, or every other check is meaningless
  const pairs: Array<[string, number, number]> = [
    ['VHF', limits.vhfMinMhz, limits.vhfMaxMhz],
    ['UHF', limits.uhfMinMhz, limits.uhfMaxMhz],
  ];
  for (const [band, min, max] of pairs) {
    const inRange = (v: number) => Number.isFinite(v) && v >= BAND_LIMIT_MIN_MHZ && v <= BAND_LIMIT_MAX_MHZ;
    if (!inRange(min) || !inRange(max)) {
      issues.push({
        location: 'Band limits',
        message: `${band} limits ${min}–${max} MHz must be between ${BAND_LIMIT_MIN_MHZ} and ${BAND_LIMIT_MAX_MHZ} MHz.`,
      });
    } else if (min >= max) {
      issues.push({ location: 'Band limits', message: `${band} minimum ${min} MHz must be below its maximum ${max} MHz.` });
    }
  }

  // 2. Memory channels
  for (const ch of codeplug.channels) {
    if (!ch.used) continue;
    const location = `Channel ${ch.channelNumber}${ch.name ? ` "${ch.name}"` : ''}`;
    if (!(ch.rxFreqHz > 0)) {
      issues.push({ location, message: 'Channel is active but has no RX frequency.' });
      continue;
    }
    for (const [label, hz] of [['RX', ch.rxFreqHz], ['TX', ch.txFreqHz]] as const) {
      if (!isFrequencyInBand(hz, limits)) {
        issues.push({ location, message: `${label} ${formatMhz(hz)} is outside the band limits (${describeLimits(limits)}).` });
      }
    }
    if (ch.customSubaudioEnabled) {
      for (const [label, hex] of [['RX', ch.customRxSubaudioHex], ['TX', ch.customTxSubaudioHex]] as const) {
        const problem = customSubaudioProblem(hex);
        if (problem) issues.push({ location, message: `Custom ${label} subaudio ${problem}` });
      }
    } else {
      const rx = toneProblem(ch.rxToneType, ch.rxToneValue);
      const tx = toneProblem(ch.txToneType, ch.txToneValue);
      if (rx) issues.push({ location, message: `RX tone: ${rx}.` });
      if (tx) issues.push({ location, message: `TX tone: ${tx}.` });
    }
  }

  // 3. VFO A & VFO B
  for (const [label, vfo] of [['VFO A', codeplug.vfoA], ['VFO B', codeplug.vfoB]] as const) {
    for (const [dir, hz] of [['RX', vfo.rxFreqHz], ['TX', vfo.txFreqHz]] as const) {
      if (!isFrequencyInBand(hz, limits)) {
        issues.push({ location: label, message: `${dir} ${formatMhz(hz)} is outside the band limits (${describeLimits(limits)}).` });
      }
    }
    const rx = toneProblem(vfo.rxToneType, vfo.rxToneValue);
    const tx = toneProblem(vfo.txToneType, vfo.txToneValue);
    if (rx) issues.push({ location: label, message: `RX tone: ${rx}.` });
    if (tx) issues.push({ location: label, message: `TX tone: ${tx}.` });
  }

  // 4. Programming password (anything but 6 digits is silently written as "no password")
  if (codeplug.general.passwordEnabled && !/^\d{6}$/.test(codeplug.general.password.trim())) {
    issues.push({
      location: 'Programming password',
      message: 'Password protection is on, but the password is not exactly 6 digits.',
    });
  }

  return issues;
}
