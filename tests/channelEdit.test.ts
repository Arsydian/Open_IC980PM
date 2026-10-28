/**
 * @file tests/channelEdit.test.ts
 * @description Frequency entry rules used by the channel grid (`src/core/channelEdit.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  applyRxFrequencyEdit,
  applyTxFrequencyEdit,
  formatMhzInput,
  parseMhzInput,
} from '../src/core/channelEdit';
import { createEmptyChannel } from '../src/core/ysfCodec';

const programmed = (rxHz: number, txHz: number) => ({
  ...createEmptyChannel(5),
  used: true,
  rxFreqHz: rxHz,
  txFreqHz: txHz,
});

describe('parseMhzInput / formatMhzInput', () => {
  it('accepts plain positive MHz values and rejects everything else', () => {
    expect(parseMhzInput('146.52')).toBe(146_520_000);
    expect(parseMhzInput(' 446.00625 ')).toBe(446_006_250);
    expect(parseMhzInput('146.')).toBe(146_000_000);
    expect(parseMhzInput('.5')).toBe(500_000);
    for (const bad of ['', '   ', 'abc', '-146.52', '0', '1e3', '146.52.1', '146,52']) {
      expect(parseMhzInput(bad)).toBeNull();
    }
  });

  it('formats Hz back to the shortest MHz string', () => {
    expect(formatMhzInput(146_520_000)).toBe('146.52');
    expect(formatMhzInput(446_006_250)).toBe('446.00625');
    expect(formatMhzInput(0)).toBe('');
  });
});

describe('applyRxFrequencyEdit', () => {
  it('makes an empty channel simplex on the typed frequency', () => {
    const ch = applyRxFrequencyEdit(createEmptyChannel(5), 146_520_000);
    expect(ch).toMatchObject({ used: true, rxFreqHz: 146_520_000, txFreqHz: 146_520_000 });
  });

  it('keeps a simplex channel simplex instead of creating an accidental split', () => {
    const ch = applyRxFrequencyEdit(programmed(146_520_000, 146_520_000), 445_500_000);
    expect(ch.txFreqHz).toBe(445_500_000);
  });

  it('keeps the repeater offset when the output frequency changes', () => {
    const ch = applyRxFrequencyEdit(programmed(146_940_000, 146_340_000), 147_000_000);
    expect(ch.txFreqHz).toBe(146_400_000);
  });

  it('falls back to simplex if keeping the offset would give a non-positive TX', () => {
    const ch = applyRxFrequencyEdit(programmed(446_000_000, 146_000_000), 100_000_000);
    expect(ch.txFreqHz).toBe(100_000_000);
  });
});

describe('applyTxFrequencyEdit', () => {
  it('sets only TX on a programmed channel', () => {
    const ch = applyTxFrequencyEdit(programmed(146_940_000, 146_940_000), 146_340_000);
    expect(ch).toMatchObject({ rxFreqHz: 146_940_000, txFreqHz: 146_340_000 });
  });

  it('makes an empty channel simplex when TX is typed first', () => {
    const ch = applyTxFrequencyEdit(createEmptyChannel(5), 446_000_000);
    expect(ch).toMatchObject({ used: true, rxFreqHz: 446_000_000, txFreqHz: 446_000_000 });
  });
});
