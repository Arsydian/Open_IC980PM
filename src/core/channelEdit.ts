/**
 * @file src/core/channelEdit.ts
 * @description Parsing and apply rules for frequencies typed into the channel grid.
 */

import type { ChannelRecord, ToneType } from '../types/radio';
import { CTCSS_TONES, DCS_CODES } from './constants';

/**
 * Tone value to keep after switching a tone selector to `type`: the current value if it is valid
 * for the new type, otherwise a standard default (CTCSS 100.0 Hz, DCS 023). Without this, a
 * CTCSS 88.5 left in place after switching to DCS is written as the invalid code "D089".
 */
export function toneValueForType(type: ToneType, current: number): number {
  if (type === 'CTCSS') return CTCSS_TONES.includes(current) ? current : CTCSS_TONES[12];
  if (type === 'DCS_N' || type === 'DCS_I') return DCS_CODES.includes(current) ? current : DCS_CODES[0];
  return current;
}

/**
 * Parses a frequency typed in MHz (e.g. `"146.52"`) into Hz.
 * Returns `null` for anything that is not a plain positive decimal number.
 */
export function parseMhzInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const mhz = parseFloat(trimmed);
  if (!Number.isFinite(mhz) || mhz <= 0) return null;
  return Math.round(mhz * 1_000_000);
}

/** Formats a frequency in Hz for an editable MHz field (up to 5 decimals, no trailing zeros). */
export function formatMhzInput(hz: number): string {
  return hz > 0 ? String(Number((hz / 1_000_000).toFixed(5))) : '';
}

/**
 * Sets a channel's RX frequency. An empty channel becomes simplex; a programmed channel keeps
 * its TX offset (simplex stays simplex, a -600 kHz repeater pair stays -600 kHz).
 */
export function applyRxFrequencyEdit(prev: ChannelRecord, rxHz: number): ChannelRecord {
  const keepsOffset = prev.used && prev.rxFreqHz > 0 && prev.txFreqHz > 0;
  const txHz = keepsOffset ? rxHz + (prev.txFreqHz - prev.rxFreqHz) : rxHz;
  return { ...prev, used: true, rxFreqHz: rxHz, txFreqHz: txHz > 0 ? txHz : rxHz };
}

/** Old 1-based channel number → new number, for channels that moved when the list was reordered. */
export type ChannelRenumbering = ReadonlyMap<number, number>;

/**
 * Where a setting that refers to channel `channelNumber` (e.g. the priority scan channel; `0` = off)
 * should point after `renumbering`.
 */
export function remapChannelNumber(channelNumber: number, renumbering: ChannelRenumbering): number {
  return renumbering.get(channelNumber) ?? channelNumber;
}

/**
 * Sorts every programmed channel by frequency or name into channels 1..N (channels without an RX
 * frequency go last when sorting by frequency) and empties the rest.
 */
export function sortChannels(
  channels: ChannelRecord[],
  by: 'freq' | 'name',
  makeEmpty: (channelNumber: number) => ChannelRecord
): { channels: ChannelRecord[]; renumbering: ChannelRenumbering } {
  const freqKey = (c: ChannelRecord) => (c.rxFreqHz > 0 ? c.rxFreqHz : Number.MAX_SAFE_INTEGER);
  const programmed = channels.filter((c) => c.used);
  programmed.sort((a, b) =>
    by === 'freq'
      ? freqKey(a) - freqKey(b) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name) || freqKey(a) - freqKey(b)
  );
  const renumbering = new Map<number, number>();
  const sorted = channels.map((_, i) => {
    const ch = programmed[i];
    if (!ch) return makeEmpty(i + 1);
    if (ch.channelNumber !== i + 1) renumbering.set(ch.channelNumber, i + 1);
    return { ...ch, channelNumber: i + 1 };
  });
  return { channels: sorted, renumbering };
}

/** Swaps channels `a` and `b` (1-based). */
export function swapChannels(
  channels: ChannelRecord[],
  a: number,
  b: number
): { channels: ChannelRecord[]; renumbering: ChannelRenumbering } {
  const next = [...channels];
  next[a - 1] = { ...channels[b - 1], channelNumber: a };
  next[b - 1] = { ...channels[a - 1], channelNumber: b };
  return { channels: next, renumbering: new Map([[a, b], [b, a]]) };
}

/** Sets a channel's TX frequency. An empty channel gets the same RX frequency (simplex). */
export function applyTxFrequencyEdit(prev: ChannelRecord, txHz: number): ChannelRecord {
  const rxHz = prev.used && prev.rxFreqHz > 0 ? prev.rxFreqHz : txHz;
  return { ...prev, used: true, rxFreqHz: rxHz, txFreqHz: txHz };
}
