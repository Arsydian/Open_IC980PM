/**
 * @file src/core/chirpCsvCodec.ts
 * @description CHIRP CSV & Factory CPS CSV parser, exporter, and 3-mode channel list merger
 * for Open_IC980PM.
 */

import type { Bandwidth, ChannelInsertionMode, ChannelRecord, ModulationMode, ToneType, TxPower } from '../types/radio';
import { CTCSS_TONES, DCS_CODES, MAX_CHANNELS } from './constants';
import { createEmptyChannel } from './ysfCodec';

/**
 * Splits a single CSV line into fields while respecting double-quoted strings and escaped quotes.
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Snaps a CTCSS frequency in Hz to the nearest valid HIROYASU IC-980 Pro Max CTCSS tone.
 */
function snapCtcssTone(hzStr: string): number {
  const val = parseFloat(hzStr);
  if (!Number.isFinite(val)) return CTCSS_TONES[0];
  let best = CTCSS_TONES[0];
  let minDiff = Math.abs(val - best);
  for (const t of CTCSS_TONES) {
    const d = Math.abs(val - t);
    if (d < minDiff) {
      minDiff = d;
      best = t;
    }
  }
  return best;
}

/**
 * Snaps a DCS octal code string (e.g. `"023"` or `"23"`) to a valid hardware DCS code.
 */
function snapDcsCode(codeStr: string): number {
  const val = parseInt(codeStr.replace(/\D/g, ''), 10);
  if (!Number.isFinite(val)) return DCS_CODES[0];
  return DCS_CODES.includes(val) ? val : DCS_CODES[0];
}

/**
 * Parses a standard CHIRP CSV or HIROYASU CPS CSV string into an array of `ChannelRecord` objects.
 *
 * Supported CHIRP columns:
 * `Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment`
 */
export function parseChirpOrCpsCsv(csvText: string): ChannelRecord[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return [];
  }

  const rawHeaders = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const colIndex = (names: string[]): number => {
    for (const n of names) {
      const idx = rawHeaders.indexOf(n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxName = colIndex(['name', 'channel name', 'ch name', 'alpha']);
  const idxFreq = colIndex(['frequency', 'rx freq', 'rxfreq', 'rx_freq', 'receive frequency']);
  const idxTxFreq = colIndex(['tx freq', 'txfreq', 'tx_freq', 'transmit frequency']);
  const idxDuplex = colIndex(['duplex', 'shift', 'offset dir']);
  const idxOffset = colIndex(['offset', 'shift freq']);
  const idxTone = colIndex(['tone', 'tone mode']);
  const idxRTone = colIndex(['rtonefreq', 'tx ctcss', 'tx tone']);
  const idxCTone = colIndex(['ctonefreq', 'rx ctcss', 'rx tone']);
  const idxDtcs = colIndex(['dtcscode', 'dcs', 'dcs code']);
  const idxRxDtcs = colIndex(['rxdtcscode']);
  const idxDtcsPol = colIndex(['dtcspolarity', 'dcs polarity']);
  const idxCrossMode = colIndex(['crossmode']);
  const idxMode = colIndex(['mode', 'modulation', 'bandwidth']);
  const idxSkip = colIndex(['skip', 'scan']);
  const idxPower = colIndex(['power', 'tx power']);
  const idxComment = colIndex(['comment', 'notes']);

  if (idxFreq === -1) {
    throw new Error('CSV is missing a recognized Frequency column (expected "Frequency" or "RX Freq").');
  }

  const parsed: ChannelRecord[] = [];

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cols = splitCsvLine(lines[rowIdx]);
    const rxMhz = parseFloat(cols[idxFreq] || '');
    if (!Number.isFinite(rxMhz) || rxMhz <= 0) {
      continue;
    }

    const rxFreqHz = Math.round(rxMhz * 1_000_000);
    let txFreqHz = rxFreqHz;

    if (idxTxFreq !== -1 && cols[idxTxFreq]) {
      const txMhz = parseFloat(cols[idxTxFreq]);
      if (Number.isFinite(txMhz) && txMhz > 0) {
        txFreqHz = Math.round(txMhz * 1_000_000);
      }
    } else if (idxDuplex !== -1) {
      const duplex = (cols[idxDuplex] || '').trim().toLowerCase();
      const offsetVal = idxOffset !== -1 ? parseFloat(cols[idxOffset] || '0') : 0;
      if (duplex === '+' && Number.isFinite(offsetVal)) {
        txFreqHz = Math.round((rxMhz + offsetVal) * 1_000_000);
      } else if (duplex === '-' && Number.isFinite(offsetVal)) {
        txFreqHz = Math.round((rxMhz - offsetVal) * 1_000_000);
      } else if (duplex === 'split' && Number.isFinite(offsetVal) && offsetVal > 10) {
        txFreqHz = Math.round(offsetVal * 1_000_000);
      }
    }

    // Tone decoding
    let rxToneType: ToneType = 'None';
    let rxToneValue = CTCSS_TONES[0];
    let txToneType: ToneType = 'None';
    let txToneValue = CTCSS_TONES[0];

    const toneMode = idxTone !== -1 ? (cols[idxTone] || '').trim().toUpperCase() : '';
    const rTone = idxRTone !== -1 ? snapCtcssTone(cols[idxRTone] || '88.5') : 88.5;
    const cTone = idxCTone !== -1 ? snapCtcssTone(cols[idxCTone] || String(rTone)) : rTone;
    const dcsCode = idxDtcs !== -1 ? snapDcsCode(cols[idxDtcs] || '023') : 23;
    const rxDcsCode = idxRxDtcs !== -1 ? snapDcsCode(cols[idxRxDtcs] || String(dcsCode)) : dcsCode;
    const pol = idxDtcsPol !== -1 ? (cols[idxDtcsPol] || 'NN').trim().toUpperCase() : 'NN';
    const txDcsType: ToneType = pol.startsWith('R') || pol.startsWith('I') ? 'DCS_I' : 'DCS_N';
    const rxDcsType: ToneType = pol.endsWith('R') || pol.endsWith('I') ? 'DCS_I' : 'DCS_N';

    if (toneMode === 'TONE') {
      txToneType = 'CTCSS';
      txToneValue = rTone;
    } else if (toneMode === 'TSQL') {
      txToneType = 'CTCSS';
      txToneValue = cTone;
      rxToneType = 'CTCSS';
      rxToneValue = cTone;
    } else if (toneMode === 'DTCS') {
      txToneType = txDcsType;
      txToneValue = dcsCode;
      rxToneType = rxDcsType;
      rxToneValue = dcsCode;
    } else if (toneMode === 'CROSS') {
      const cross = idxCrossMode !== -1 ? (cols[idxCrossMode] || '').trim().toUpperCase() : 'TONE->TONE';
      const [txPart, rxPart] = cross.split('->');
      if (txPart === 'TONE') {
        txToneType = 'CTCSS';
        txToneValue = rTone;
      } else if (txPart === 'DTCS') {
        txToneType = txDcsType;
        txToneValue = dcsCode;
      }
      if (rxPart === 'TONE') {
        rxToneType = 'CTCSS';
        rxToneValue = cTone;
      } else if (rxPart === 'DTCS') {
        rxToneType = rxDcsType;
        rxToneValue = rxDcsCode;
      }
    }

    // Mode & Bandwidth
    const modeStr = idxMode !== -1 ? (cols[idxMode] || 'FM').trim().toUpperCase() : 'FM';
    const modulation: ModulationMode = modeStr === 'AM' ? 'AM' : 'FM';
    const bandwidth: Bandwidth = modeStr === 'NFM' || modeStr === 'NARROW' ? 'Narrow' : 'Wide';

    // Power
    const powerStr = idxPower !== -1 ? (cols[idxPower] || 'High').trim().toLowerCase() : 'high';
    let power: TxPower = 'High';
    if (powerStr.includes('low') || powerStr.startsWith('1') || powerStr === 'l') {
      power = 'Low';
    } else if (powerStr.includes('mid') || powerStr.includes('med') || powerStr.startsWith('2') || powerStr.startsWith('3')) {
      power = 'Middle';
    }

    // Scan / Skip
    const skipStr = idxSkip !== -1 ? (cols[idxSkip] || '').trim().toUpperCase() : '';
    const scanAdd = skipStr !== 'S' && skipStr !== 'OFF' && skipStr !== 'FALSE';

    const rawName = idxName !== -1 ? (cols[idxName] || '').trim() : `CH ${parsed.length + 1}`;
    const name = rawName.replace(/[^\x20-\x7E]/g, '').slice(0, 16);

    const ch = createEmptyChannel(parsed.length + 1);
    ch.used = true;
    ch.rxFreqHz = rxFreqHz;
    ch.txFreqHz = txFreqHz;
    ch.rxToneType = rxToneType;
    ch.rxToneValue = rxToneValue;
    ch.txToneType = txToneType;
    ch.txToneValue = txToneValue;
    ch.power = power;
    ch.bandwidth = bandwidth;
    ch.modulation = modulation;
    ch.scanAdd = scanAdd;
    ch.name = name;
    ch.metadata = {
      source: 'chirp',
      notes: idxComment !== -1 ? cols[idxComment] : undefined,
    };

    parsed.push(ch);
  }

  return parsed;
}

/**
 * Exports active `ChannelRecord` entries to standard CHIRP CSV format.
 */
export function exportChirpCsv(channels: ChannelRecord[]): string {
  const header =
    'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment';
  const rows: string[] = [header];

  for (const ch of channels) {
    if (!ch.used || ch.rxFreqHz <= 0) continue;

    const rxMhz = (ch.rxFreqHz / 1_000_000).toFixed(6);
    const txMhz = (ch.txFreqHz / 1_000_000).toFixed(6);
    const diffHz = ch.txFreqHz - ch.rxFreqHz;
    let duplex = '';
    let offset = '0.000000';
    if (diffHz > 0) {
      duplex = '+';
      offset = (diffHz / 1_000_000).toFixed(6);
    } else if (diffHz < 0) {
      duplex = '-';
      offset = (Math.abs(diffHz) / 1_000_000).toFixed(6);
    } else if (ch.txFreqHz !== ch.rxFreqHz) {
      duplex = 'split';
      offset = txMhz;
    }

    let tone = '';
    let rToneFreq = '88.5';
    let cToneFreq = '88.5';
    let dtcsCode = '023';
    let dtcsPolarity = 'NN';
    let rxDtcsCode = '023';
    let crossMode = 'Tone->Tone';

    if (ch.txToneType === 'CTCSS' && ch.rxToneType === 'None') {
      tone = 'Tone';
      rToneFreq = ch.txToneValue.toFixed(1);
    } else if (ch.txToneType === 'CTCSS' && ch.rxToneType === 'CTCSS' && ch.txToneValue === ch.rxToneValue) {
      tone = 'TSQL';
      rToneFreq = ch.txToneValue.toFixed(1);
      cToneFreq = ch.rxToneValue.toFixed(1);
    } else if (
      (ch.txToneType === 'DCS_N' || ch.txToneType === 'DCS_I') &&
      (ch.rxToneType === 'DCS_N' || ch.rxToneType === 'DCS_I') &&
      ch.txToneValue === ch.rxToneValue
    ) {
      tone = 'DTCS';
      dtcsCode = String(ch.txToneValue).padStart(3, '0');
      rxDtcsCode = dtcsCode;
      dtcsPolarity = `${ch.txToneType === 'DCS_I' ? 'R' : 'N'}${ch.rxToneType === 'DCS_I' ? 'R' : 'N'}`;
    } else if (ch.txToneType !== 'None' || ch.rxToneType !== 'None') {
      tone = 'Cross';
      const txPart = ch.txToneType === 'CTCSS' ? 'Tone' : ch.txToneType.startsWith('DCS') ? 'DTCS' : '';
      const rxPart = ch.rxToneType === 'CTCSS' ? 'Tone' : ch.rxToneType.startsWith('DCS') ? 'DTCS' : '';
      crossMode = `${txPart}->${rxPart}`;
      if (ch.txToneType === 'CTCSS') rToneFreq = ch.txToneValue.toFixed(1);
      if (ch.rxToneType === 'CTCSS') cToneFreq = ch.rxToneValue.toFixed(1);
      if (ch.txToneType.startsWith('DCS')) dtcsCode = String(ch.txToneValue).padStart(3, '0');
      if (ch.rxToneType.startsWith('DCS')) rxDtcsCode = String(ch.rxToneValue).padStart(3, '0');
    }

    const mode = ch.modulation === 'AM' ? 'AM' : ch.bandwidth === 'Narrow' ? 'NFM' : 'FM';
    const skip = ch.scanAdd ? '' : 'S';
    const power = ch.power === 'High' ? 'High' : ch.power === 'Middle' ? 'Mid' : 'Low';
    
    // Sanitize against CSV Formula Injection / DDE execution in spreadsheet viewers
    const sanitizeCsvFormula = (str: string): string => {
      let val = str.replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(val)) {
        val = `'${val}`;
      }
      return `"${val}"`;
    };

    const safeName = sanitizeCsvFormula(ch.name);
    const safeComment = sanitizeCsvFormula(ch.metadata?.notes || '');

    rows.push(
      [
        ch.channelNumber,
        safeName,
        rxMhz,
        duplex,
        offset,
        tone,
        rToneFreq,
        cToneFreq,
        dtcsCode,
        dtcsPolarity,
        rxDtcsCode,
        crossMode,
        mode,
        '5.00',
        skip,
        power,
        safeComment,
      ].join(',')
    );
  }

  return rows.join('\n');
}

/**
 * Merges incoming imported channels into the 500-channel array according to User Requirement #6:
 * - `append_empty` (Default): Places each incoming channel into the next available empty slot (`!used`).
 * - `insert_at`: Inserts incoming channels starting at `startChannelNumber` (`1..500`), shifting existing
 *   channels at or after `startChannelNumber` down.
 * - `overwrite_at`: Overwrites slots consecutively starting at `startChannelNumber` (`1..500`).
 */
export function mergeImportedChannels(
  existingChannels: ChannelRecord[],
  incomingChannels: ChannelRecord[],
  mode: ChannelInsertionMode = 'append_empty',
  startChannelNumber: number = 1
): { channels: ChannelRecord[]; importedCount: number } {
  const result = existingChannels.map((ch, idx) => ({
    ...ch,
    channelNumber: idx + 1,
  }));

  const safeStartIdx = Math.max(0, Math.min(MAX_CHANNELS - 1, startChannelNumber - 1));
  let importedCount = 0;

  if (mode === 'append_empty') {
    let cursor = 0;
    for (const inc of incomingChannels) {
      while (cursor < MAX_CHANNELS && result[cursor].used) {
        cursor++;
      }
      if (cursor >= MAX_CHANNELS) break;
      result[cursor] = {
        ...inc,
        used: true,
        channelNumber: cursor + 1,
      };
      importedCount++;
      cursor++;
    }
  } else if (mode === 'overwrite_at') {
    let cursor = safeStartIdx;
    for (const inc of incomingChannels) {
      if (cursor >= MAX_CHANNELS) break;
      result[cursor] = {
        ...inc,
        used: true,
        channelNumber: cursor + 1,
      };
      importedCount++;
      cursor++;
    }
  } else if (mode === 'insert_at') {
    const prefix = result.slice(0, safeStartIdx);
    const suffix = result.slice(safeStartIdx);
    const inserted = incomingChannels.map((inc) => ({
      ...inc,
      used: true,
    }));
    const combined = [...prefix, ...inserted, ...suffix].slice(0, MAX_CHANNELS);
    importedCount = Math.min(incomingChannels.length, MAX_CHANNELS - safeStartIdx);
    for (let i = 0; i < MAX_CHANNELS; i++) {
      result[i] = {
        ...(combined[i] ?? createEmptyChannel(i + 1)),
        channelNumber: i + 1,
      };
    }
  }

  return { channels: result, importedCount };
}
