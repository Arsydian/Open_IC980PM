/**
 * @file tests/codeplugValidator.test.ts
 * @description Pre-write validation (`src/core/codeplugValidator.ts`) and the CHIRP importer's
 * handling of modes the radio cannot use (`src/core/chirpCsvCodec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { applyBandLimitEdit, isFrequencyInBand, validateCodeplugForWrite } from '../src/core/codeplugValidator';
import { mergeImportedChannels, parseChirpOrCpsCsv } from '../src/core/chirpCsvCodec';
import { createDefaultCodeplug } from '../src/core/ysfCodec';
import type { RadioCodeplug } from '../src/types/radio';

function withChannel1(patch: Partial<RadioCodeplug['channels'][number]>): RadioCodeplug {
  const cp = createDefaultCodeplug();
  Object.assign(cp.channels[0], { used: true, rxFreqHz: 146_520_000, txFreqHz: 146_520_000, name: 'TEST' }, patch);
  return cp;
}

describe('validateCodeplugForWrite', () => {
  it('accepts a clean default codeplug and an in-band channel', () => {
    expect(validateCodeplugForWrite(createDefaultCodeplug())).toEqual([]);
    expect(validateCodeplugForWrite(withChannel1({}))).toEqual([]);
  });

  it('blocks channels outside the band limits, including a 1 MHz TX left by a half-typed edit', () => {
    const issues = validateCodeplugForWrite(withChannel1({ txFreqHz: 1_000_000 }));
    expect(issues).toHaveLength(1);
    expect(issues[0].location).toBe('Channel 1 "TEST"');
    expect(issues[0].message).toMatch(/^TX 1\.00000 MHz is outside the band limits/);

    // Raising the UHF limit makes 500 MHz writable.
    const cp = withChannel1({ rxFreqHz: 500_000_000, txFreqHz: 500_000_000 });
    expect(validateCodeplugForWrite(cp)).toHaveLength(2);
    cp.bandLimits.uhfMaxMhz = 520;
    expect(validateCodeplugForWrite(cp)).toEqual([]);
  });

  it('blocks invalid tones such as a CTCSS value left behind when switching to DCS', () => {
    const issues = validateCodeplugForWrite(withChannel1({ txToneType: 'DCS_N', txToneValue: 88.5 }));
    expect(issues.map((i) => i.message)).toEqual(['TX tone: D88.5 is not a valid DCS code.']);
    expect(validateCodeplugForWrite(withChannel1({ rxToneType: 'CTCSS', rxToneValue: 100.1 }))).toHaveLength(1);
    // Custom 8-digit subaudio bypasses the standard tone tables.
    expect(
      validateCodeplugForWrite(withChannel1({ txToneType: 'DCS_N', txToneValue: 88.5, customSubaudioEnabled: true }))
    ).toEqual([]);
  });

  it('blocks custom subaudio values the radio cannot store', () => {
    const custom = (rx: string, tx: string) =>
      validateCodeplugForWrite(
        withChannel1({ customSubaudioEnabled: true, customRxSubaudioHex: rx, customTxSubaudioHex: tx })
      ).map((i) => i.message);

    expect(custom('0000FFFF', 'ABCD')).toEqual([]);
    expect(custom('12345678', '0000ABCD')).toEqual([
      "Custom RX subaudio 12345678 does not fit the radio's 16-bit field (0000–FFFF); only the last 4 hex digits would be stored.",
    ]);
    expect(custom('0000ABCD', '')).toEqual(['Custom TX subaudio "" is not a hex value.']);
  });

  it('blocks inverted or unrepresentable band limits', () => {
    const inverted = createDefaultCodeplug();
    inverted.bandLimits.vhfMinMhz = 180;
    expect(validateCodeplugForWrite(inverted).some((i) => i.location === 'Band limits')).toBe(true);

    const negative = createDefaultCodeplug();
    negative.bandLimits.uhfMinMhz = -136;
    expect(validateCodeplugForWrite(negative).some((i) => i.location === 'Band limits')).toBe(true);
  });

  it('applyBandLimitEdit refuses out-of-range or unordered limits', () => {
    const limits = createDefaultCodeplug().bandLimits; // VHF 136-174, UHF 400-480
    expect(applyBandLimitEdit(limits, 'uhfMaxMhz', 520)).toEqual({ limits: { ...limits, uhfMaxMhz: 520 } });
    expect(applyBandLimitEdit(limits, 'vhfMinMhz', -136)).toEqual({
      error: 'Band limits must be between 18 and 999 MHz.',
    });
    expect(applyBandLimitEdit(limits, 'vhfMinMhz', 180)).toEqual({
      error: 'VHF minimum (180 MHz) must be below VHF maximum (174 MHz).',
    });
    expect(applyBandLimitEdit(limits, 'uhfMaxMhz', 400)).toHaveProperty('error');
  });

  it('blocks an enabled password that is not exactly 6 digits', () => {
    const cp = createDefaultCodeplug();
    cp.general.passwordEnabled = true;
    cp.general.password = '1234';
    expect(validateCodeplugForWrite(cp).map((i) => i.location)).toEqual(['Programming password']);
    cp.general.password = '123456';
    expect(validateCodeplugForWrite(cp)).toEqual([]);
  });

  it('treats empty frequencies as in band and checks both VHF and UHF windows', () => {
    const limits = createDefaultCodeplug().bandLimits;
    expect(isFrequencyInBand(0, limits)).toBe(true);
    expect(isFrequencyInBand(146_520_000, limits)).toBe(true);
    expect(isFrequencyInBand(446_000_000, limits)).toBe(true);
    expect(isFrequencyInBand(7_200_000, limits)).toBe(false);
    expect(isFrequencyInBand(1_296_000_000, limits)).toBe(false);
  });
});

describe('CHIRP import of unsupported rows', () => {
  const csv = [
    'Location,Name,Frequency,Duplex,Offset,Tone,Mode,Power',
    '1,HF,7.200000,,0,,FM,High',
    '2,23cm,1296.000000,,0,,FM,High',
    '3,DMR,145.000000,,0,,DMR,High',
    '4,DSTAR,145.670000,,0,,DV,High',
    '5,AIR,124.500000,,0,,NAM,High',
    '6,SIMPLEX,146.520000,,0,,FM,High',
  ].join('\n');

  it('skips digital-mode rows instead of importing them as analog FM', () => {
    const names = parseChirpOrCpsCsv(csv).map((c) => c.name);
    expect(names).toEqual(['HF', '23cm', 'AIR', 'SIMPLEX']);
  });

  it('imports NAM as narrow AM', () => {
    const air = parseChirpOrCpsCsv(csv).find((c) => c.name === 'AIR')!;
    expect(air.modulation).toBe('AM');
    expect(air.bandwidth).toBe('Narrow');
  });

  it('flags imported out-of-band rows before they can be written', () => {
    const cp = createDefaultCodeplug();
    cp.channels = mergeImportedChannels(cp.channels, parseChirpOrCpsCsv(csv)).channels;
    const flagged = new Set(validateCodeplugForWrite(cp).map((i) => i.location));
    expect(flagged).toEqual(new Set(['Channel 1 "HF"', 'Channel 2 "23cm"', 'Channel 3 "AIR"']));
  });
});
