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
  remapChannelNumber,
  sortChannels,
  swapChannels,
  toneValueForType,
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

describe('toneValueForType', () => {
  it('replaces a value that is invalid for the new tone type with a standard one', () => {
    expect(toneValueForType('DCS_N', 88.5)).toBe(23);
    expect(toneValueForType('DCS_I', 100.0)).toBe(23);
    expect(toneValueForType('CTCSS', 23)).toBe(100.0);
  });

  it('keeps a value that is already valid for the new type', () => {
    expect(toneValueForType('CTCSS', 88.5)).toBe(88.5);
    expect(toneValueForType('DCS_I', 754)).toBe(754);
    expect(toneValueForType('None', 88.5)).toBe(88.5);
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

describe('reordering channels', () => {
  const ch = (n: number, name: string, rxHz: number) => ({ ...createEmptyChannel(n), used: true, name, rxFreqHz: rxHz, txFreqHz: rxHz });
  const list = () => {
    const channels = Array.from({ length: 6 }, (_, i) => createEmptyChannel(i + 1));
    channels[0] = ch(1, 'HIGH', 147_000_000);
    channels[2] = ch(3, 'NOFREQ', 0); // programmed but without an RX frequency
    channels[4] = ch(5, 'LOW', 146_000_000);
    return channels;
  };

  it('sortChannels keeps every programmed channel and reports where each moved', () => {
    const { channels, renumbering } = sortChannels(list(), 'freq', createEmptyChannel);
    expect(channels.map((c) => (c.used ? c.name : '-'))).toEqual(['LOW', 'HIGH', 'NOFREQ', '-', '-', '-']);
    expect(channels.map((c) => c.channelNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...renumbering]).toEqual([[5, 1], [1, 2]]);
  });

  it('swapChannels reports both moves', () => {
    const { channels, renumbering } = swapChannels(list(), 1, 2);
    expect(channels[1].name).toBe('HIGH');
    expect([...renumbering]).toEqual([[1, 2], [2, 1]]);
  });

  it('remapChannelNumber follows moved channels and leaves 0 (off) alone', () => {
    const renumbering = new Map([[5, 1]]);
    expect(remapChannelNumber(5, renumbering)).toBe(1);
    expect(remapChannelNumber(3, renumbering)).toBe(3);
    expect(remapChannelNumber(0, renumbering)).toBe(0);
  });
});
