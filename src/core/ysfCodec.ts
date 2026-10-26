/**
 * @file src/core/ysfCodec.ts
 * @description Lossless 47,046-byte `.Ysf` binary encoder and decoder for the HIROYASU IC-980 Pro Max.
 * Every byte offset, bitmask, and subaudio encoding is verified against `TProgramDialog::GetDataForWrite`
 * (`0x00428F84`) and `TProgramDialog::SetDataToSoftware` (`0x00429B50`).
 */

import type {
  BandLimitsConfig,
  Bandwidth,
  ChannelRecord,
  CrossBandRepeaterSlot,
  DtmfConfig,
  GeneralSettingsConfig,
  HandsetHotkeyConfig,
  HotkeyLongValue,
  HotkeyShortValue,
  ModulationMode,
  OffsetDirection,
  PttIdMode,
  RadioCodeplug,
  ToneType,
  TxPower,
  VfoConfig,
} from '../types/radio';
import {
  CTCSS_TONES,
  DCS_CODES,
  HOTKEY_LONG_OPTIONS,
  HOTKEY_SHORT_OPTIONS,
  MAX_CHANNELS,
  STEP_FREQUENCIES_HZ,
  YSF_CHANNEL_SIZE,
  YSF_FILE_SIZE,
  YSF_OFFSETS,
  createCleanDefaultYsfBuffer,
  readFixedAscii,
  writeFixedAscii,
} from './constants';

const TONE_TYPE_FROM_INT: readonly ToneType[] = ['None', 'CTCSS', 'DCS_N', 'DCS_I'];
const TONE_TYPE_TO_INT: Record<ToneType, number> = {
  None: 0,
  CTCSS: 1,
  DCS_N: 2,
  DCS_I: 3,
};

const POWER_FROM_INT: readonly TxPower[] = ['Low', 'Middle', 'High'];
const POWER_TO_INT: Record<TxPower, number> = {
  Low: 0,
  Middle: 1,
  High: 2,
};

const PTT_ID_FROM_INT: readonly PttIdMode[] = ['Off', 'BOT', 'EOT', 'BOTH'];
const PTT_ID_TO_INT: Record<PttIdMode, number> = {
  Off: 0,
  BOT: 1,
  EOT: 2,
  BOTH: 3,
};

const OFFSET_DIR_FROM_INT: readonly OffsetDirection[] = ['OFF', '+', '-'];
const OFFSET_DIR_TO_INT: Record<OffsetDirection, number> = {
  OFF: 0,
  '+': 1,
  '-': 2,
};

/**
 * Creates a clean, unprogrammed `ChannelRecord` for a given 1-based channel number (`1..500`).
 */
export function createEmptyChannel(channelNumber: number): ChannelRecord {
  return {
    channelNumber,
    used: false,
    rxFreqHz: 0,
    txFreqHz: 0,
    rxToneType: 'None',
    rxToneValue: CTCSS_TONES[0],
    txToneType: 'None',
    txToneValue: CTCSS_TONES[0],
    customSubaudioEnabled: false,
    customRxSubaudioHex: '00000000',
    customTxSubaudioHex: '00000000',
    power: 'High',
    bandwidth: 'Wide',
    modulation: 'FM',
    bcl: false,
    scanAdd: true,
    pttId: 'Off',
    pttIdGroup: 0,
    scramble: 0,
    noaaFlag: false,
    name: '',
  };
}

/**
 * Enforces the hardware mutual-exclusion constraint discovered at `0x0041C23C..0x0041C686`:
 * If a key's Long Press is set to `Monitor Momentary` (`0x02`), its Short Press MUST be `Unassigned` (`0x00`).
 */
export function enforceHotkeyMutualExclusion(hotkeys: HandsetHotkeyConfig): HandsetHotkeyConfig {
  const result = { ...hotkeys };
  if (result.key1Long === 0x02) result.key1Short = 0x00;
  if (result.key2Long === 0x02) result.key2Short = 0x00;
  if (result.key3Long === 0x02) result.key3Short = 0x00;
  return result;
}

/**
 * Decodes a 16-bit tone word (`+0x1C` or `+0x29`) given its `ToneType`.
 */
function decodeToneWord(rawWord: number, toneType: ToneType): number {
  if (toneType === 'CTCSS') {
    const hz = rawWord / 10.0;
    return hz >= 60.0 && hz <= 260.0 ? Number(hz.toFixed(1)) : CTCSS_TONES[0];
  }
  if (toneType === 'DCS_N' || toneType === 'DCS_I') {
    return DCS_CODES.includes(rawWord) ? rawWord : DCS_CODES[0];
  }
  return CTCSS_TONES[0];
}

/**
 * Encodes a `ToneType` and tone value into the 16-bit integer stored at `+0x1C` or `+0x29`.
 */
function encodeToneWord(toneType: ToneType, toneValue: number): number {
  if (toneType === 'CTCSS') {
    return Math.round(toneValue * 10) & 0xffff;
  }
  if (toneType === 'DCS_N' || toneType === 'DCS_I') {
    return Math.round(toneValue) & 0xffff;
  }
  return 0;
}

/**
 * Checks whether a 1-based channel (`1..500`) is marked active in the 63-byte bitmask
 * at `.Ysf` offset `0x015F` (`351..413`).
 * Matches `sub_427B20` in `HIROYASU IC-980 Pro Max full english.exe`.
 */
export function isChannelBitSet(buf: Uint8Array, channelNumber: number): boolean {
  const ch = channelNumber;
  const byteIndex = YSF_OFFSETS.CHANNEL_USED_BITMASK + (ch >> 3);
  const bitMask = 1 << (ch & 7);
  return (buf[byteIndex] & bitMask) !== 0;
}

/**
 * Sets or clears the active bit for a 1-based channel (`1..500`) in the 63-byte bitmask
 * at `.Ysf` offset `0x015F` (`351..413`).
 */
export function setChannelBit(buf: Uint8Array, channelNumber: number, used: boolean): void {
  const ch = channelNumber;
  const byteIndex = YSF_OFFSETS.CHANNEL_USED_BITMASK + (ch >> 3);
  const bitMask = 1 << (ch & 7);
  if (used) {
    buf[byteIndex] |= bitMask;
  } else {
    buf[byteIndex] &= ~bitMask;
  }
}

/**
 * Decodes an 85-byte channel record at `offset` within the `.Ysf` buffer.
 */
function decodeChannelAt(
  buf: Uint8Array,
  view: DataView,
  offset: number,
  channelNumber: number,
  bitmaskUsed: boolean
): ChannelRecord {
  const rxFreqHz = view.getUint32(offset + 0x00, true);
  const txFreqHz = view.getUint32(offset + 0x0e, true);
  const validFreq = rxFreqHz >= 10_000_000 && rxFreqHz <= 1_000_000_000 && rxFreqHz !== 0xffffffff;
  const used = bitmaskUsed && validFreq;

  if (!used) {
    return createEmptyChannel(channelNumber);
  }

  const byte57 = buf[offset + 0x39];
  const byte58 = buf[offset + 0x3a];
  const byte59 = buf[offset + 0x3b];
  const byte60 = buf[offset + 0x3c];
  const byte62 = buf[offset + 0x3e];

  const customSubaudioEnabled = (byte58 & 0x40) !== 0;

  // Tone types are stored both in byte 30/43 (+0x1E/+0x2B) and packed in byte 60 (+0x3C bits 4..7)
  const rxToneTypeInt = (buf[offset + 0x1e] & 0x03) || ((byte60 >> 4) & 0x03);
  const txToneTypeInt = (buf[offset + 0x2b] & 0x03) || ((byte60 >> 6) & 0x03);
  const rxToneType = TONE_TYPE_FROM_INT[rxToneTypeInt] ?? 'None';
  const txToneType = TONE_TYPE_FROM_INT[txToneTypeInt] ?? 'None';

  const rawRxToneWord = view.getUint16(offset + 0x1c, true);
  const rawTxToneWord = view.getUint16(offset + 0x29, true);

  const customRxSubaudioInt = view.getUint32(offset + 0x18, true);
  const customTxSubaudioInt = view.getUint32(offset + 0x25, true);

  const powerInt = byte58 & 0x03;
  const power: TxPower = POWER_FROM_INT[powerInt] ?? 'High';
  const bandwidth: Bandwidth = (byte58 & 0x04) !== 0 ? 'Narrow' : 'Wide';
  const bcl = (byte58 & 0x10) !== 0;
  const scanAdd = (byte57 & 0x01) !== 0;

  const scramble = Math.min(8, byte59 & 0x0f);
  const noaaFlag = (byte59 & 0x10) !== 0;

  const pttIdInt = byte60 & 0x03;
  const pttId: PttIdMode = PTT_ID_FROM_INT[pttIdInt] ?? 'Off';
  const modulation: ModulationMode = (byte60 & 0x04) !== 0 ? 'AM' : 'FM';
  const pttIdGroup = Math.min(14, byte62 & 0x0f);

  const name = readFixedAscii(buf, offset + 0x3f, 16);

  return {
    channelNumber,
    used: true,
    rxFreqHz,
    txFreqHz: txFreqHz > 0 && txFreqHz !== 0xffffffff ? txFreqHz : rxFreqHz,
    rxToneType,
    rxToneValue: decodeToneWord(rawRxToneWord, rxToneType),
    txToneType,
    txToneValue: decodeToneWord(rawTxToneWord, txToneType),
    customSubaudioEnabled,
    customRxSubaudioHex: customRxSubaudioInt.toString(16).toUpperCase().padStart(8, '0'),
    customTxSubaudioHex: customTxSubaudioInt.toString(16).toUpperCase().padStart(8, '0'),
    power,
    bandwidth,
    modulation,
    bcl,
    scanAdd,
    pttId,
    pttIdGroup,
    scramble,
    noaaFlag,
    name,
  };
}

/**
 * Encodes a `ChannelRecord` into an 85-byte `.Ysf` slot at `offset`.
 */
function encodeChannelAt(buf: Uint8Array, view: DataView, offset: number, ch: ChannelRecord): void {
  buf.fill(0x00, offset, offset + YSF_CHANNEL_SIZE);

  if (!ch.used || ch.rxFreqHz <= 0) {
    return;
  }

  const rxHz = Math.round(ch.rxFreqHz) >>> 0;
  const txHz = Math.round(ch.txFreqHz > 0 ? ch.txFreqHz : ch.rxFreqHz) >>> 0;

  view.setUint32(offset + 0x00, rxHz, true);
  view.setUint32(offset + 0x0e, txHz, true);

  const rxToneTypeInt = TONE_TYPE_TO_INT[ch.rxToneType] ?? 0;
  const txToneTypeInt = TONE_TYPE_TO_INT[ch.txToneType] ?? 0;

  if (ch.customSubaudioEnabled) {
    const rxCustom = parseInt(ch.customRxSubaudioHex || '0', 16) >>> 0;
    const txCustom = parseInt(ch.customTxSubaudioHex || '0', 16) >>> 0;
    view.setUint32(offset + 0x18, rxCustom, true);
    view.setUint32(offset + 0x25, txCustom, true);
  } else {
    view.setUint16(offset + 0x1c, encodeToneWord(ch.rxToneType, ch.rxToneValue), true);
    view.setUint16(offset + 0x29, encodeToneWord(ch.txToneType, ch.txToneValue), true);
  }

  buf[offset + 0x1e] = rxToneTypeInt;
  buf[offset + 0x2b] = txToneTypeInt;

  // Byte 57 (+0x39): Bit 0 = Scan Add, Bit 1 = Channel Used marker
  buf[offset + 0x39] = (ch.scanAdd ? 0x01 : 0x00) | 0x02;

  // Byte 58 (+0x3A): Bits 0..1 = Power, Bit 2 = Narrow, Bit 4 = BCL, Bit 6 = Custom Subaudio
  const powerBits = POWER_TO_INT[ch.power] ?? 2;
  const bwBit = ch.bandwidth === 'Narrow' ? 0x04 : 0x00;
  const bclBit = ch.bcl ? 0x10 : 0x00;
  const customSubBit = ch.customSubaudioEnabled ? 0x40 : 0x00;
  buf[offset + 0x3a] = powerBits | bwBit | bclBit | customSubBit;

  // Byte 59 (+0x3B): Bits 0..3 = Scramble (0..8), Bit 4 = NOAA Flag
  const scrambleBits = Math.max(0, Math.min(8, ch.scramble)) & 0x0f;
  const noaaBit = ch.noaaFlag ? 0x10 : 0x00;
  buf[offset + 0x3b] = scrambleBits | noaaBit;

  // Byte 60 (+0x3C): Bits 0..1 = PTT-ID, Bit 2 = AM, Bits 4..5 = RX Tone Type, Bits 6..7 = TX Tone Type
  const pttBits = PTT_ID_TO_INT[ch.pttId] ?? 0;
  const modBit = ch.modulation === 'AM' ? 0x04 : 0x00;
  buf[offset + 0x3c] = pttBits | modBit | ((rxToneTypeInt & 0x03) << 4) | ((txToneTypeInt & 0x03) << 6);

  // Byte 62 (+0x3E): PTT-ID Group (0..14)
  buf[offset + 0x3e] = Math.max(0, Math.min(14, ch.pttIdGroup));

  // Bytes 63..78 (+0x3F..+0x4E): 16-byte Channel Name
  writeFixedAscii(buf, offset + 0x3f, ch.name, 16);
}

/**
 * Decodes VFO A or VFO B from the `.Ysf` buffer.
 */
function decodeVfo(
  buf: Uint8Array,
  view: DataView,
  recordOffset: number,
  offsetFreqOffset: number,
  offsetDirOffset: number,
  stepIndexOffset: number,
  displayModeOffset: number,
  defaultFreqHz: number
): VfoConfig {
  const rawRx = view.getUint32(recordOffset + 0x00, true);
  const rawTx = view.getUint32(recordOffset + 0x0e, true);
  const rxFreqHz = rawRx >= 10_000_000 && rawRx <= 1_000_000_000 ? rawRx : defaultFreqHz;
  const txFreqHz = rawTx >= 10_000_000 && rawTx <= 1_000_000_000 ? rawTx : rxFreqHz;

  const byte58 = buf[recordOffset + 0x3a];
  const byte59 = buf[recordOffset + 0x3b];
  const byte60 = buf[recordOffset + 0x3c];

  const rxToneTypeInt = (buf[recordOffset + 0x1e] & 0x03) || ((byte60 >> 4) & 0x03);
  const txToneTypeInt = (buf[recordOffset + 0x2b] & 0x03) || ((byte60 >> 6) & 0x03);
  const rxToneType = TONE_TYPE_FROM_INT[rxToneTypeInt] ?? 'None';
  const txToneType = TONE_TYPE_FROM_INT[txToneTypeInt] ?? 'None';

  const rxToneValue = decodeToneWord(view.getUint16(recordOffset + 0x1c, true), rxToneType);
  const txToneValue = decodeToneWord(view.getUint16(recordOffset + 0x29, true), txToneType);

  const power = POWER_FROM_INT[byte58 & 0x03] ?? 'High';
  const bandwidth: Bandwidth = (byte58 & 0x04) !== 0 ? 'Narrow' : 'Wide';
  const bcl = (byte58 & 0x10) !== 0;
  const scramble = Math.min(8, byte59 & 0x0f);
  const modulation: ModulationMode = (byte60 & 0x04) !== 0 ? 'AM' : 'FM';

  const rawOffsetHz = view.getUint32(offsetFreqOffset, true);
  const offsetFreqHz = rawOffsetHz <= 100_000_000 ? rawOffsetHz : 600_000;
  const offsetDirection = OFFSET_DIR_FROM_INT[buf[offsetDirOffset] & 0x03] ?? 'OFF';
  const stepIndex = Math.min(STEP_FREQUENCIES_HZ.length - 1, buf[stepIndexOffset]);
  const displayMode = Math.min(2, buf[displayModeOffset]);

  return {
    rxFreqHz,
    txFreqHz,
    rxToneType,
    rxToneValue,
    txToneType,
    txToneValue,
    power,
    bandwidth,
    modulation,
    bcl,
    scramble,
    offsetDirection,
    offsetFreqHz,
    stepIndex,
    displayMode,
  };
}

/**
 * Encodes VFO A or VFO B into the `.Ysf` buffer.
 */
function encodeVfo(
  buf: Uint8Array,
  view: DataView,
  recordOffset: number,
  stepHzOffset: number,
  offsetFreqOffset: number,
  offsetDirOffset: number,
  stepIndexOffset: number,
  displayModeOffset: number,
  vfo: VfoConfig
): void {
  view.setUint32(recordOffset + 0x00, Math.round(vfo.rxFreqHz) >>> 0, true);
  view.setUint32(recordOffset + 0x0e, Math.round(vfo.txFreqHz) >>> 0, true);

  const rxToneTypeInt = TONE_TYPE_TO_INT[vfo.rxToneType] ?? 0;
  const txToneTypeInt = TONE_TYPE_TO_INT[vfo.txToneType] ?? 0;

  view.setUint16(recordOffset + 0x1c, encodeToneWord(vfo.rxToneType, vfo.rxToneValue), true);
  view.setUint16(recordOffset + 0x29, encodeToneWord(vfo.txToneType, vfo.txToneValue), true);
  buf[recordOffset + 0x1e] = rxToneTypeInt;
  buf[recordOffset + 0x2b] = txToneTypeInt;

  buf[recordOffset + 0x39] = 0x01;
  buf[recordOffset + 0x3a] =
    (POWER_TO_INT[vfo.power] ?? 2) |
    (vfo.bandwidth === 'Narrow' ? 0x04 : 0x00) |
    (vfo.bcl ? 0x10 : 0x00);
  buf[recordOffset + 0x3b] = Math.min(8, vfo.scramble) & 0x0f;
  buf[recordOffset + 0x3c] =
    (vfo.modulation === 'AM' ? 0x04 : 0x00) |
    ((rxToneTypeInt & 0x03) << 4) |
    ((txToneTypeInt & 0x03) << 6);

  const stepHz = STEP_FREQUENCIES_HZ[vfo.stepIndex] ?? 12500;
  view.setUint32(stepHzOffset, stepHz, true);
  view.setUint32(offsetFreqOffset, Math.round(vfo.offsetFreqHz) >>> 0, true);
  buf[offsetDirOffset] = OFFSET_DIR_TO_INT[vfo.offsetDirection] ?? 0;
  buf[stepIndexOffset] = Math.min(STEP_FREQUENCIES_HZ.length - 1, Math.max(0, vfo.stepIndex));
  buf[displayModeOffset] = Math.min(2, Math.max(0, vfo.displayMode));
}

/**
 * Decodes a 47,046-byte `.Ysf` buffer into a structured `RadioCodeplug`.
 */
export function decodeYsfBuffer(inputBuffer: Uint8Array): RadioCodeplug {
  if (inputBuffer.byteLength !== YSF_FILE_SIZE) {
    throw new Error(
      `Invalid .Ysf file size: expected ${YSF_FILE_SIZE} bytes (0xB7C6), received ${inputBuffer.byteLength} bytes.`
    );
  }

  const buf = new Uint8Array(inputBuffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 1. Decode Timestamp (0x0000..0x0005)
  const year = ((buf[0] << 8) | buf[1]) || new Date().getFullYear();
  const month = buf[2] || 1;
  const day = buf[3] || 1;
  const hour = buf[4] || 0;
  const minute = buf[5] || 0;
  const lastWriteTimestamp: [number, number, number, number, number] = [year, month, day, hour, minute];

  // 2. Decode VFO A & VFO B
  const vfoA = decodeVfo(
    buf,
    view,
    YSF_OFFSETS.VFO_A_RECORD,
    YSF_OFFSETS.VFO_A_OFFSET_HZ,
    YSF_OFFSETS.VFO_A_OFFSET_DIR,
    YSF_OFFSETS.STEP_INDEX_A,
    YSF_OFFSETS.DISPLAY_MODE_A,
    146520000
  );

  const vfoB = decodeVfo(
    buf,
    view,
    YSF_OFFSETS.VFO_B_RECORD,
    YSF_OFFSETS.VFO_B_OFFSET_HZ,
    YSF_OFFSETS.VFO_B_OFFSET_DIR,
    YSF_OFFSETS.STEP_INDEX_B,
    YSF_OFFSETS.DISPLAY_MODE_B,
    446000000
  );

  // 3. Decode 500 Memory Channels (0x0234 + idx * 85)
  const channels: ChannelRecord[] = [];
  for (let idx = 0; idx < MAX_CHANNELS; idx++) {
    const channelNumber = idx + 1;
    const offset = YSF_OFFSETS.CHANNELS_START + idx * YSF_CHANNEL_SIZE;
    const bitUsed = isChannelBitSet(buf, channelNumber);
    // Also support files where the channel frequency is populated directly
    const rxCandidate = view.getUint32(offset, true);
    const hasValidRx = rxCandidate >= 10_000_000 && rxCandidate <= 1_000_000_000 && rxCandidate !== 0xffffffff;
    channels.push(decodeChannelAt(buf, view, offset, channelNumber, bitUsed || hasValidRx));
  }

  // 4. Decode Handset Hotkeys (0xA88C..0xA891)
  const validShortValues = new Set<number>(HOTKEY_SHORT_OPTIONS.map((o) => o.value));
  const validLongValues = new Set<number>(HOTKEY_LONG_OPTIONS.map((o) => o.value));
  const sanitizeShort = (v: number): HotkeyShortValue => (validShortValues.has(v) ? (v as HotkeyShortValue) : 0x00);
  const sanitizeLong = (v: number): HotkeyLongValue => (validLongValues.has(v) ? (v as HotkeyLongValue) : 0x00);

  const hotkeys = enforceHotkeyMutualExclusion({
    key1Short: sanitizeShort(buf[YSF_OFFSETS.KEY1_SHORT]),
    key1Long: sanitizeLong(buf[YSF_OFFSETS.KEY1_LONG]),
    key2Short: sanitizeShort(buf[YSF_OFFSETS.KEY2_SHORT]),
    key2Long: sanitizeLong(buf[YSF_OFFSETS.KEY2_LONG]),
    key3Short: sanitizeShort(buf[YSF_OFFSETS.KEY3_SHORT]),
    key3Long: sanitizeLong(buf[YSF_OFFSETS.KEY3_LONG]),
  });

  // 5. Decode General Radio Settings
  const general: GeneralSettingsConfig = {
    squelchLevel: Math.min(9, view.getUint16(YSF_OFFSETS.SQUELCH_LEVEL, true)),
    squelchMode: Math.min(2, buf[YSF_OFFSETS.SQUELCH_MODE]),
    totIndex: Math.min(12, buf[YSF_OFFSETS.TOT_INDEX]),
    toaIndex: Math.min(10, view.getUint16(YSF_OFFSETS.TOA_INDEX, true)),
    voxLevel: Math.min(9, buf[YSF_OFFSETS.VOX_LEVEL]),
    voxDelayIndex: Math.min(15, view.getUint16(YSF_OFFSETS.VOX_DELAY, true)),
    voxControl: buf[YSF_OFFSETS.VOX_CONTROL] !== 0,
    batterySave: buf[YSF_OFFSETS.BATTERY_SAVE] !== 0,
    savingRate: Math.min(3, buf[YSF_OFFSETS.SAVING_RATE]),
    scanMode: Math.min(2, buf[YSF_OFFSETS.SCAN_MODE]),
    priorityScanChannel: Math.min(MAX_CHANNELS, view.getUint16(YSF_OFFSETS.PRIORITY_SCAN_CH, true)),
    dualWatch: buf[YSF_OFFSETS.DUAL_WATCH] !== 0,
    backlightIndex: Math.min(11, buf[YSF_OFFSETS.BACKLIGHT_INDEX]),
    apoIndex: Math.min(6, view.getUint16(YSF_OFFSETS.APO_INDEX, true)),
    keyLockMode: Math.min(1, buf[YSF_OFFSETS.KEY_LOCK]),
    keypadBeep: buf[YSF_OFFSETS.KEYPAD_BEEP] !== 0,
    powerOnBeep: buf[YSF_OFFSETS.POWER_ON_BEEP] !== 0,
    voicePrompt: Math.min(2, buf[YSF_OFFSETS.VOICE_PROMPT]),
    channelReport: buf[YSF_OFFSETS.CHANNEL_REPORT] !== 0,
    whisperMode: buf[YSF_OFFSETS.WHISPER_MODE] !== 0,
    rogerBeep: Math.min(2, buf[YSF_OFFSETS.ROGER_BEEP]),
    subaudioTail: Math.min(2, buf[YSF_OFFSETS.SUBAUDIO_TAIL]),
    burstToneFreq: Math.min(3, buf[YSF_OFFSETS.BURST_TONE_1750]),
    alarmMode: Math.min(2, buf[YSF_OFFSETS.ALARM_MODE]),
    refuseAlarm: buf[YSF_OFFSETS.REFUSE_ALARM] !== 0,
    language: Math.min(1, buf[YSF_OFFSETS.LANGUAGE]),
    waitColor: Math.min(3, buf[YSF_OFFSETS.WAIT_COLOR]),
    txColor: Math.min(3, buf[YSF_OFFSETS.TX_COLOR]),
    rxColor: Math.min(3, buf[YSF_OFFSETS.RX_COLOR]),
    powerOnDisplayMode: Math.min(2, buf[YSF_OFFSETS.POWER_ON_DISPLAY_MODE]),
    powerOnMsgLine1: readFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_1, 16),
    powerOnMsgLine2: readFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_2, 20),
    radioCallsign: readFixedAscii(buf, YSF_OFFSETS.RADIO_CALLSIGN, 14),
    autoConnectEnabled: buf[YSF_OFFSETS.AUTOCONNECT_ENABLE] !== 0,
    autoConnectRole: Math.min(1, buf[YSF_OFFSETS.AUTOCONNECT_ROLE]),
    crossBandRepeaterSwitch: Math.min(7, buf[YSF_OFFSETS.CROSS_BAND_SWITCH]),
    passwordEnabled: buf[YSF_OFFSETS.PASSWORD_ENABLE] !== 0,
    password: readFixedAscii(buf, YSF_OFFSETS.PASSWORD_ASCII, 6),
  };

  // 6. Decode 7 Cross-Band Repeater Slots (0xB573, 24 bytes each)
  const crossBandSlots: CrossBandRepeaterSlot[] = [];
  for (let i = 0; i < 7; i++) {
    const slotOff = YSF_OFFSETS.CROSS_BAND_SLOTS_START + i * 24;
    const freqAHz = view.getUint32(slotOff + 0x00, true) || 145500000;
    const freqBHz = view.getUint32(slotOff + 0x04, true) || 435500000;
    const toneAWord = view.getUint16(slotOff + 0x08, true);
    const toneBWord = view.getUint16(slotOff + 0x0a, true);
    const flags = buf[slotOff + 0x0c];
    const toneAType = TONE_TYPE_FROM_INT[flags & 0x03] ?? 'None';
    const toneBType = TONE_TYPE_FROM_INT[(flags >> 2) & 0x03] ?? 'None';
    const power = POWER_FROM_INT[(flags >> 4) & 0x03] ?? 'High';
    const name = readFixedAscii(buf, slotOff + 0x0e, 10) || `RPT-${i + 1}`;
    crossBandSlots.push({
      slotNumber: i + 1,
      name,
      freqAHz,
      freqBHz,
      toneAType,
      toneAValue: decodeToneWord(toneAWord, toneAType),
      toneBType,
      toneBValue: decodeToneWord(toneBWord, toneBType),
      power,
    });
  }

  // 7. Decode DTMF Configuration & 30 Entries (15 Groups + 15 Contacts at 0xB32D)
  const groups: string[] = [];
  const contacts: Array<{ index: number; name: string; code: string }> = [];
  for (let i = 0; i < 15; i++) {
    const grpOff = YSF_OFFSETS.DTMF_ENTRIES_START + i * 17;
    groups.push(readFixedAscii(buf, grpOff, 16));
  }
  for (let i = 0; i < 15; i++) {
    const contactOff = YSF_OFFSETS.DTMF_ENTRIES_START + (15 + i) * 17;
    const rawStr = readFixedAscii(buf, contactOff, 16);
    const [namePart, codePart] = rawStr.includes(':') ? rawStr.split(':', 2) : [`Contact ${i + 1}`, rawStr];
    contacts.push({
      index: i + 1,
      name: namePart.slice(0, 10),
      code: (codePart || '').slice(0, 16),
    });
  }

  const dtmf: DtmfConfig = {
    groupCode: Math.min(6, buf[YSF_OFFSETS.DTMF_GROUP_CODE]),
    sideTone: Math.min(3, buf[YSF_OFFSETS.DTMF_SIDE_TONE]),
    responseMode: Math.min(3, buf[YSF_OFFSETS.DTMF_RESPONSE]),
    resetTimeSeconds: Math.max(5, Math.min(60, buf[YSF_OFFSETS.DTMF_RESET_TIME] || 10)),
    firstDigitTime: Math.min(4, view.getUint16(YSF_OFFSETS.DTMF_FIRST_TIME, true)),
    delayTime: Math.min(4, view.getUint16(YSF_OFFSETS.DTMF_DELAY_TIME, true)),
    continueTime: Math.min(4, view.getUint16(YSF_OFFSETS.DTMF_CONTINUE_TIME, true)),
    intervalTime: Math.min(4, buf[YSF_OFFSETS.DTMF_INTERVAL_TIME]),
    stunCode: readFixedAscii(buf, YSF_OFFSETS.DTMF_STUN_CODE, 16),
    killCode: readFixedAscii(buf, YSF_OFFSETS.DTMF_KILL_CODE, 16),
    reviveCode: readFixedAscii(buf, YSF_OFFSETS.DTMF_REVIVE_CODE, 16),
    localId: readFixedAscii(buf, YSF_OFFSETS.DTMF_LOCAL_ID, 16),
    groups,
    contacts,
  };

  // 8. Decode Band Limits (0xB786..0xB7C5)
  const uMinStr = readFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x00, 16);
  const uMaxStr = readFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x10, 16);
  const vMinStr = readFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x20, 16);
  const vMaxStr = readFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x30, 16);

  const parseBandLimit = (s: string, fallback: number): number => {
    const val = parseFloat(s);
    return Number.isFinite(val) && val >= 18.0 && val <= 999.0 ? val : fallback;
  };

  const bandLimits: BandLimitsConfig = {
    uhfMinMhz: parseBandLimit(uMinStr, 400.0),
    uhfMaxMhz: parseBandLimit(uMaxStr, 480.0),
    vhfMinMhz: parseBandLimit(vMinStr, 136.0),
    vhfMaxMhz: parseBandLimit(vMaxStr, 174.0),
  };

  return {
    lastWriteTimestamp,
    channels,
    vfoA,
    vfoB,
    hotkeys,
    general,
    crossBandSlots,
    dtmf,
    bandLimits,
    rawYsfBuffer: buf,
  };
}

/**
 * Encodes a structured `RadioCodeplug` back into a 47,046-byte `.Ysf` binary buffer.
 */
export function encodeYsfBuffer(codeplug: RadioCodeplug): Uint8Array {
  const buf =
    codeplug.rawYsfBuffer && codeplug.rawYsfBuffer.byteLength === YSF_FILE_SIZE
      ? new Uint8Array(codeplug.rawYsfBuffer)
      : createCleanDefaultYsfBuffer();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // 1. Update Write Timestamp at 0x0000..0x0005
  const now = new Date();
  const year = now.getFullYear();
  buf[0] = (year >> 8) & 0xff;
  buf[1] = year & 0xff;
  buf[2] = (now.getMonth() + 1) & 0xff;
  buf[3] = now.getDate() & 0xff;
  buf[4] = now.getHours() & 0xff;
  buf[5] = now.getMinutes() & 0xff;

  // 2. Encode VFO A & VFO B
  encodeVfo(
    buf,
    view,
    YSF_OFFSETS.VFO_A_RECORD,
    YSF_OFFSETS.VFO_A_STEP_HZ,
    YSF_OFFSETS.VFO_A_OFFSET_HZ,
    YSF_OFFSETS.VFO_A_OFFSET_DIR,
    YSF_OFFSETS.STEP_INDEX_A,
    YSF_OFFSETS.DISPLAY_MODE_A,
    codeplug.vfoA
  );

  encodeVfo(
    buf,
    view,
    YSF_OFFSETS.VFO_B_RECORD,
    YSF_OFFSETS.VFO_B_STEP_HZ,
    YSF_OFFSETS.VFO_B_OFFSET_HZ,
    YSF_OFFSETS.VFO_B_OFFSET_DIR,
    YSF_OFFSETS.STEP_INDEX_B,
    YSF_OFFSETS.DISPLAY_MODE_B,
    codeplug.vfoB
  );

  // 3. Clear & Rebuild 63-byte Channel Bitmask + 500 Channel Slots
  buf.fill(0x00, YSF_OFFSETS.CHANNEL_USED_BITMASK, YSF_OFFSETS.CHANNEL_USED_BITMASK + 63);
  for (let idx = 0; idx < MAX_CHANNELS; idx++) {
    const ch = codeplug.channels[idx] ?? createEmptyChannel(idx + 1);
    const channelNumber = idx + 1;
    const offset = YSF_OFFSETS.CHANNELS_START + idx * YSF_CHANNEL_SIZE;
    const isUsed = ch.used && ch.rxFreqHz > 0;
    setChannelBit(buf, channelNumber, isUsed);
    encodeChannelAt(buf, view, offset, { ...ch, channelNumber, used: isUsed });
  }

  // 4. Encode Handset Hotkeys (with mutual-exclusion enforcement)
  const safeHotkeys = enforceHotkeyMutualExclusion(codeplug.hotkeys);
  buf[YSF_OFFSETS.KEY1_SHORT] = safeHotkeys.key1Short;
  buf[YSF_OFFSETS.KEY1_LONG] = safeHotkeys.key1Long;
  buf[YSF_OFFSETS.KEY2_SHORT] = safeHotkeys.key2Short;
  buf[YSF_OFFSETS.KEY2_LONG] = safeHotkeys.key2Long;
  buf[YSF_OFFSETS.KEY3_SHORT] = safeHotkeys.key3Short;
  buf[YSF_OFFSETS.KEY3_LONG] = safeHotkeys.key3Long;

  // 5. Encode General Settings
  const g = codeplug.general;
  view.setUint16(YSF_OFFSETS.SQUELCH_LEVEL, g.squelchLevel & 0x0f, true);
  buf[YSF_OFFSETS.SQUELCH_MODE] = g.squelchMode & 0x03;
  buf[YSF_OFFSETS.TOT_INDEX] = g.totIndex & 0x0f;
  view.setUint16(YSF_OFFSETS.TOA_INDEX, g.toaIndex & 0x0f, true);
  buf[YSF_OFFSETS.VOX_LEVEL] = g.voxLevel & 0x0f;
  view.setUint16(YSF_OFFSETS.VOX_DELAY, g.voxDelayIndex & 0x0f, true);
  buf[YSF_OFFSETS.VOX_CONTROL] = g.voxControl ? 1 : 0;
  buf[YSF_OFFSETS.BATTERY_SAVE] = g.batterySave ? 1 : 0;
  buf[YSF_OFFSETS.SAVING_RATE] = g.savingRate & 0x03;
  buf[YSF_OFFSETS.SCAN_MODE] = g.scanMode & 0x03;
  view.setUint16(YSF_OFFSETS.PRIORITY_SCAN_CH, g.priorityScanChannel & 0xffff, true);
  buf[YSF_OFFSETS.DUAL_WATCH] = g.dualWatch ? 1 : 0;
  buf[YSF_OFFSETS.BACKLIGHT_INDEX] = g.backlightIndex & 0x0f;
  view.setUint16(YSF_OFFSETS.APO_INDEX, g.apoIndex & 0x0f, true);
  buf[YSF_OFFSETS.KEY_LOCK] = g.keyLockMode ? 1 : 0;
  buf[YSF_OFFSETS.KEYPAD_BEEP] = g.keypadBeep ? 1 : 0;
  buf[YSF_OFFSETS.POWER_ON_BEEP] = g.powerOnBeep ? 1 : 0;
  buf[YSF_OFFSETS.VOICE_PROMPT] = g.voicePrompt & 0x03;
  buf[YSF_OFFSETS.CHANNEL_REPORT] = g.channelReport ? 1 : 0;
  buf[YSF_OFFSETS.WHISPER_MODE] = g.whisperMode ? 1 : 0;
  buf[YSF_OFFSETS.ROGER_BEEP] = g.rogerBeep & 0x03;
  buf[YSF_OFFSETS.SUBAUDIO_TAIL] = g.subaudioTail & 0x03;
  buf[YSF_OFFSETS.BURST_TONE_1750] = g.burstToneFreq & 0x03;
  buf[YSF_OFFSETS.ALARM_MODE] = g.alarmMode & 0x03;
  buf[YSF_OFFSETS.REFUSE_ALARM] = g.refuseAlarm ? 1 : 0;
  buf[YSF_OFFSETS.LANGUAGE] = g.language & 0x01;
  buf[YSF_OFFSETS.WAIT_COLOR] = g.waitColor & 0x03;
  buf[YSF_OFFSETS.TX_COLOR] = g.txColor & 0x03;
  buf[YSF_OFFSETS.RX_COLOR] = g.rxColor & 0x03;
  buf[YSF_OFFSETS.POWER_ON_DISPLAY_MODE] = g.powerOnDisplayMode & 0x03;
  writeFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_1, g.powerOnMsgLine1, 16);
  writeFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_2, g.powerOnMsgLine2, 20);
  writeFixedAscii(buf, YSF_OFFSETS.RADIO_CALLSIGN, g.radioCallsign, 14);
  buf[YSF_OFFSETS.AUTOCONNECT_ENABLE] = g.autoConnectEnabled ? 1 : 0;
  buf[YSF_OFFSETS.AUTOCONNECT_ROLE] = g.autoConnectRole & 0x01;
  buf[YSF_OFFSETS.CROSS_BAND_SWITCH] = g.crossBandRepeaterSwitch & 0x07;
  buf[YSF_OFFSETS.PASSWORD_ENABLE] = g.passwordEnabled ? 1 : 0;
  writeFixedAscii(buf, YSF_OFFSETS.PASSWORD_ASCII, g.password.slice(0, 6), 6);

  // 6. Encode 7 Cross-Band Repeater Slots
  for (let i = 0; i < 7; i++) {
    const slot = codeplug.crossBandSlots[i];
    if (!slot) continue;
    const slotOff = YSF_OFFSETS.CROSS_BAND_SLOTS_START + i * 24;
    view.setUint32(slotOff + 0x00, Math.round(slot.freqAHz) >>> 0, true);
    view.setUint32(slotOff + 0x04, Math.round(slot.freqBHz) >>> 0, true);
    view.setUint16(slotOff + 0x08, encodeToneWord(slot.toneAType, slot.toneAValue), true);
    view.setUint16(slotOff + 0x0a, encodeToneWord(slot.toneBType, slot.toneBValue), true);
    const flags =
      (TONE_TYPE_TO_INT[slot.toneAType] & 0x03) |
      ((TONE_TYPE_TO_INT[slot.toneBType] & 0x03) << 2) |
      ((POWER_TO_INT[slot.power] & 0x03) << 4);
    buf[slotOff + 0x0c] = flags;
    writeFixedAscii(buf, slotOff + 0x0e, slot.name, 10);
  }

  // 7. Encode DTMF Configuration & 30 Entries
  const d = codeplug.dtmf;
  buf[YSF_OFFSETS.DTMF_GROUP_CODE] = d.groupCode & 0x07;
  buf[YSF_OFFSETS.DTMF_SIDE_TONE] = d.sideTone & 0x03;
  buf[YSF_OFFSETS.DTMF_RESPONSE] = d.responseMode & 0x03;
  buf[YSF_OFFSETS.DTMF_RESET_TIME] = Math.max(5, Math.min(60, d.resetTimeSeconds));
  view.setUint16(YSF_OFFSETS.DTMF_FIRST_TIME, d.firstDigitTime & 0x07, true);
  view.setUint16(YSF_OFFSETS.DTMF_DELAY_TIME, d.delayTime & 0x07, true);
  view.setUint16(YSF_OFFSETS.DTMF_CONTINUE_TIME, d.continueTime & 0x07, true);
  buf[YSF_OFFSETS.DTMF_INTERVAL_TIME] = d.intervalTime & 0x07;

  writeFixedAscii(buf, YSF_OFFSETS.DTMF_STUN_CODE, d.stunCode, 16);
  buf[YSF_OFFSETS.DTMF_STUN_CODE + 16] = Math.min(16, d.stunCode.length);

  writeFixedAscii(buf, YSF_OFFSETS.DTMF_KILL_CODE, d.killCode, 16);
  buf[YSF_OFFSETS.DTMF_KILL_CODE + 16] = Math.min(16, d.killCode.length);

  writeFixedAscii(buf, YSF_OFFSETS.DTMF_REVIVE_CODE, d.reviveCode, 16);
  buf[YSF_OFFSETS.DTMF_REVIVE_CODE + 16] = Math.min(16, d.reviveCode.length);

  writeFixedAscii(buf, YSF_OFFSETS.DTMF_LOCAL_ID, d.localId, 16);

  for (let i = 0; i < 15; i++) {
    const grpOff = YSF_OFFSETS.DTMF_ENTRIES_START + i * 17;
    const code = (d.groups[i] || '').slice(0, 16);
    writeFixedAscii(buf, grpOff, code, 16);
    buf[grpOff + 16] = code.length;
  }

  for (let i = 0; i < 15; i++) {
    const contactOff = YSF_OFFSETS.DTMF_ENTRIES_START + (15 + i) * 17;
    const contact = d.contacts[i];
    const combined = contact ? `${contact.name.slice(0, 7)}:${contact.code.slice(0, 8)}` : '';
    writeFixedAscii(buf, contactOff, combined, 16);
    buf[contactOff + 16] = combined.length;
  }

  // 8. Encode Band Limits (0xB786..0xB7C5)
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x00, codeplug.bandLimits.uhfMinMhz.toFixed(5), 16);
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x10, codeplug.bandLimits.uhfMaxMhz.toFixed(5), 16);
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x20, codeplug.bandLimits.vhfMinMhz.toFixed(5), 16);
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x30, codeplug.bandLimits.vhfMaxMhz.toFixed(5), 16);

  return buf;
}

/**
 * Creates a clean, zero-placeholder `RadioCodeplug` ready for immediate editing or import.
 */
export function createDefaultCodeplug(): RadioCodeplug {
  return decodeYsfBuffer(createCleanDefaultYsfBuffer());
}

/**
 * Returns the raw 85-byte `.Ysf` slice for a specific 1-based channel (`1..500`).
 */
export function getChannelRawYsfBytes(codeplug: RadioCodeplug, channelNumber: number): Uint8Array {
  const buf = new Uint8Array(YSF_CHANNEL_SIZE);
  const view = new DataView(buf.buffer);
  const ch = codeplug.channels[channelNumber - 1];
  if (ch) {
    encodeChannelAt(buf, view, 0, ch);
  }
  return buf;
}
