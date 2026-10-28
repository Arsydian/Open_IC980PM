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

/** Sets a channel's TX frequency. An empty channel gets the same RX frequency (simplex). */
export function applyTxFrequencyEdit(prev: ChannelRecord, txHz: number): ChannelRecord {
  const rxHz = prev.used && prev.rxFreqHz > 0 ? prev.rxFreqHz : txHz;
  return { ...prev, used: true, rxFreqHz: rxHz, txFreqHz: txHz };
}
