/**
 * @file src/core/constants.ts
 * @description Hardware lookup tables, CTCSS/DCS tone tables, handset hotkey enumerations,
 * binary layout offsets, and clean factory-default codeplug generator for the
 * HIROYASU IC-980 Pro Max.
 */

import type { HotkeyLongValue, HotkeyShortValue } from '../types/radio';

/** Total byte length of a native `.Ysf` codeplug file (`0xB7C6` = `47,046` bytes). */
export const YSF_FILE_SIZE = 47046;

/** `.Ysf` header length before Channel 1 (`0x0234` = `564` bytes). */
export const YSF_HEADER_SIZE = 564;

/** Byte size of a single `.Ysf` channel record (`0x55` = `85` bytes). */
export const YSF_CHANNEL_SIZE = 85;

/** Total number of memory channels supported by the HIROYASU IC-980 Pro Max (`500`). */
export const MAX_CHANNELS = 500;

/** Total byte size of the Radio EEPROM user image (`0x18307` = `99,079` bytes). */
export const EEPROM_IMAGE_SIZE = 0x18307;

/** Byte size of the RF Calibration block (`0x18000..0x18306` = `775` bytes). */
export const RF_CALIBRATION_SIZE = 775;

/**
 * Exact `.Ysf` file offsets (`VA - 0x0058CFA6`) verified from `TProgramDialog::GetDataForWrite` (`0x00428F84`)
 * and `TProgramDialog::SetDataToSoftware` (`0x00429B50`).
 */
export const YSF_OFFSETS = {
  LAST_WRITE_TIMESTAMP: 0x0000, // 6 bytes: [Year_hi, Year_lo, Month, Day, Hour, Minute]
  PASSWORD_ENABLE: 0x0053, // 1 byte
  PASSWORD_ASCII: 0x0060, // 6 bytes at 0x58D006 - 0x58CFA6 = 0x0060
  VFO_A_RECORD: 0x00ad, // 85 bytes (0x58D053 - 0x58CFA6)
  VFO_B_RECORD: 0x0102, // 85 bytes (0x58D0A8 - 0x58CFA6)
  VFO_A_STEP_HZ: 0x0157, // u32 LE (0x58D0FD - 0x58CFA6)
  VFO_B_STEP_HZ: 0x015b, // u32 LE (0x58D101 - 0x58CFA6)
  CHANNEL_USED_BITMASK: 0x015f, // 63 bytes (351..413, 0x58D105 - 0x58CFA6)
  CHANNELS_START: 0x0234, // 500 * 85 bytes (564..43063, 0x58D1DA - 0x58CFA6)

  // General Settings & VFO Offsets in .Ysf Tail (0xA839+)
  DUAL_WATCH: 0xa839, // 0x5977DF
  SQUELCH_MODE: 0xa840, // 0x5977E6
  KEY_LOCK: 0xa841, // 0x5977E7
  VFO_A_OFFSET_HZ: 0xa843, // u32 LE (0x5977E9)
  VFO_B_OFFSET_HZ: 0xa847, // u32 LE (0x5977ED)
  VOX_LEVEL: 0xa84d, // 0x5977F3
  VOX_DELAY: 0xa84e, // u16 LE (0x5977F4)
  SQUELCH_LEVEL: 0xa850, // u16 LE (0x5977F6)
  TOT_INDEX: 0xa853, // 0x5977F9
  TOA_INDEX: 0xa854, // u16 LE (0x5977FA)
  SAVING_RATE: 0xa856, // 0x5977FC
  SCAN_MODE: 0xa857, // 0x5977FD
  PRIORITY_SCAN_CH: 0xa858, // u16 LE (0x5977FE)
  VFO_A_OFFSET_DIR: 0xa85a, // 0x597800 (0=OFF, 1=+, 2=-)
  VFO_B_OFFSET_DIR: 0xa85b, // 0x597801 (0=OFF, 1=+, 2=-)
  BACKLIGHT_INDEX: 0xa85e, // 0x597804
  DISPLAY_MODE_A: 0xa85f, // 0x597805
  STEP_INDEX_A: 0xa860, // 0x597806
  DISPLAY_MODE_B: 0xa862, // 0x597808
  APO_INDEX: 0xa863, // u16 LE (0x597809)
  KEYPAD_BEEP: 0xa869, // 0x59780F
  ROGER_BEEP: 0xa86b, // 0x597811
  STEP_INDEX_B: 0xa86d, // 0x597813
  BATTERY_SAVE: 0xa86e, // 0x597814
  LANGUAGE: 0xa86f, // 0x597815 (0=Chinese, 1=English)
  SYNC_CLOCK: 0xa876, // 6 bytes (0x59781C)
  WAIT_COLOR: 0xa87e, // 0x597824
  TX_COLOR: 0xa87f, // 0x597825
  RX_COLOR: 0xa880, // 0x597826
  ALARM_MODE: 0xa881, // 0x597827
  AUTOCONNECT_ENABLE: 0xa886, // 0x59782C
  AUTOCONNECT_ROLE: 0xa887, // 0x59782D

  // Handset Hotkey Offsets (0x597832..0x597837 -> 0xA88C..0xA891)
  KEY1_SHORT: 0xa88c,
  KEY1_LONG: 0xa88d,
  KEY2_SHORT: 0xa88e,
  KEY2_LONG: 0xa88f,
  KEY3_SHORT: 0xa890,
  KEY3_LONG: 0xa891,

  // Audio & Tone Flags
  SUBAUDIO_TAIL: 0xa89c, // 0x597842
  VOICE_PROMPT: 0xa89d, // 0x597843
  REFUSE_ALARM: 0xa89e, // 0x597844
  VOX_CONTROL: 0xa8a0, // 0x597846
  CHANNEL_REPORT: 0xa8a1, // 0x597847
  POWER_ON_BEEP: 0xa8a3, // 0x597849
  WHISPER_MODE: 0xa8a4, // 0x59784A
  BURST_TONE_1750: 0xa8a6, // 0x59784C

  // DTMF Configuration
  DTMF_GROUP_CODE: 0xa8a9, // 0x59784F
  DTMF_SIDE_TONE: 0xa8aa, // 0x597850
  DTMF_RESPONSE: 0xa8ac, // 0x597852
  DTMF_RESET_TIME: 0xa8ad, // 0x597853
  DTMF_FIRST_TIME: 0xa8ae, // u16 LE (0x597854)
  DTMF_DELAY_TIME: 0xa8b0, // u16 LE (0x597856)
  DTMF_CONTINUE_TIME: 0xa8b2, // u16 LE (0x597858)
  DTMF_INTERVAL_TIME: 0xa8b5, // 0x59785B
  DTMF_STUN_CODE: 0xa8b9, // 16 bytes (0x59785F) + 1B len at 0xA8C9
  DTMF_KILL_CODE: 0xa8ca, // 16 bytes (0x597870) + 1B len at 0xA8DA
  DTMF_REVIVE_CODE: 0xa8db, // 16 bytes (0x597881) + 1B len at 0xA8EB
  DTMF_LOCAL_ID: 0xa8ec, // 16 bytes
  DTMF_ENTRIES_START: 0xb32d, // 30 * 17 bytes (0x5982D3 - 0x58CFA6)

  // Welcome Messages & Callsign
  POWER_ON_MSG_1: 0xb52b, // 16 bytes (0x5984D1)
  POWER_ON_MSG_2: 0xb53c, // 20 bytes (0x5984E2)
  RADIO_CALLSIGN: 0xb551, // 14 bytes (0x5984F7)
  POWER_ON_DISPLAY_MODE: 0xb560, // 0x598506
  CROSS_BAND_SWITCH: 0xb571, // 0x598517 (EEPROM 0x120E5)
  CROSS_BAND_SLOTS_START: 0xb573, // 7 * 24 bytes (0x598519)

  // Band Limits (0x59872C - 0x58CFA6 = 0xB786)
  BAND_LIMITS_START: 0xb786, // 64 bytes (4 * 16B ASCII or u32 limits)
} as const;

/**
 * Standard 50 CTCSS frequencies in Hz (`67.0` to `254.1`).
 * Stored in binary as `Math.round(freq * 10)` (e.g., `67.0 Hz` -> `670` = `0x029E`).
 */
export const CTCSS_TONES: readonly number[] = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5,
  94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3,
  131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9,
  171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5,
  203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1,
];

/**
 * Standard 104 DCS Octal Codes (`023` to `754`).
 * Stored in binary as the integer value of the octal digits (e.g., `D023N` -> `23` = `0x0017`).
 */
export const DCS_CODES: readonly number[] = [
  23, 25, 26, 31, 32, 36, 43, 47, 51, 53, 54, 65, 71, 72, 73, 74,
  114, 115, 116, 122, 125, 131, 132, 134, 143, 145, 152, 155, 156, 162, 165, 172, 174,
  205, 212, 223, 225, 226, 243, 244, 245, 246, 251, 252, 255, 261, 263, 265, 266, 271, 274,
  306, 311, 315, 325, 331, 332, 343, 346, 351, 356, 364, 365, 371,
  411, 412, 413, 423, 431, 432, 445, 446, 452, 454, 455, 462, 464, 465, 466,
  503, 506, 516, 523, 526, 532, 546, 565,
  606, 612, 624, 627, 631, 632, 654, 662, 664,
  703, 712, 723, 731, 732, 734, 743, 754,
];

/**
 * Handset Hotkey Short Press Options (`Key 1`, `Key 2`, `Key 3` Short Press).
 * Verified from `TForm1::FormCreate` (`0x004054D8`..`0x004056D0`, lookup table `0x0058BD64`).
 */
export interface HotkeyOption<T extends number> {
  value: T;
  label: string;
  description: string;
  highlighted?: boolean;
}

export const HOTKEY_SHORT_OPTIONS: readonly HotkeyOption<HotkeyShortValue>[] = [
  {
    value: 0x00,
    label: 'Unassigned',
    description: 'No action performed on short press (required if Long Press is Monitor Momentary)',
  },
  {
    value: 0x04,
    label: 'Reverse Frequency',
    description: 'Swaps RX and TX frequencies & tones to listen directly on repeater input (Repeater Reverse)',
    highlighted: true,
  },
  {
    value: 0x02,
    label: 'Monitor',
    description: 'Opens squelch to monitor weak signals or bypass CTCSS/DCS muting',
    highlighted: true,
  },
  {
    value: 0x03,
    label: 'Scan',
    description: 'Starts or stops frequency/channel scanning',
  },
  {
    value: 0x08,
    label: 'Radio (FM Broadcast)',
    description: 'Toggles the built-in 65–108 MHz commercial FM broadcast receiver',
  },
  {
    value: 0x0c,
    label: 'Frequency match',
    description: 'Starts one-key frequency counter / subaudio capture sweep',
  },
  {
    value: 0x09,
    label: 'Alarm beep',
    description: 'Triggers emergency alarm siren/code according to Alarm Mode setting',
  },
];

/**
 * Handset Hotkey Long Press (Hold) Options (`Key 1`, `Key 2`, `Key 3` Long Press).
 * Verified from `TForm1::FormCreate` (`0x004056E0`..`0x00405907`, lookup table `0x0058BEA4`).
 */
export const HOTKEY_LONG_OPTIONS: readonly HotkeyOption<HotkeyLongValue>[] = [
  {
    value: 0x00,
    label: 'Unassigned',
    description: 'No action performed on long press',
  },
  {
    value: 0x04,
    label: 'Reverse Frequency',
    description: 'Swaps RX and TX frequencies & tones to listen directly on repeater input (Repeater Reverse)',
    highlighted: true,
  },
  {
    value: 0x01,
    label: 'Monitor (Latching)',
    description: 'Latches squelch open until pressed again',
    highlighted: true,
  },
  {
    value: 0x02,
    label: 'Monitor Momentary',
    description: 'Opens squelch only while key is held down (automatically sets Short Press on same key to Unassigned)',
    highlighted: true,
  },
  {
    value: 0x03,
    label: 'Scan',
    description: 'Starts or stops frequency/channel scanning',
  },
  {
    value: 0x08,
    label: 'Radio (FM Broadcast)',
    description: 'Toggles the built-in 65–108 MHz commercial FM broadcast receiver',
  },
  {
    value: 0x0b,
    label: 'Warning light',
    description: 'Toggles the handset LED flashlight / emergency strobe',
  },
  {
    value: 0x0c,
    label: 'Frequency match',
    description: 'Starts one-key frequency counter / subaudio capture sweep',
  },
  {
    value: 0x09,
    label: 'Alarm beep',
    description: 'Triggers emergency alarm siren/code according to Alarm Mode setting',
  },
];

/** VFO Step Frequency options in Hz (`0..8`). */
export const STEP_FREQUENCIES_HZ: readonly number[] = [
  2500,  // 0: 2.50K
  5000,  // 1: 5.00K
  6250,  // 2: 6.25K
  10000, // 3: 10.00K
  12500, // 4: 12.50K
  20000, // 5: 20.00K
  25000, // 6: 25.00K
  30000, // 7: 30.00K
  50000, // 8: 50.00K
];

export const STEP_FREQUENCY_LABELS: readonly string[] = [
  '2.50 kHz',
  '5.00 kHz',
  '6.25 kHz',
  '10.00 kHz',
  '12.50 kHz',
  '20.00 kHz',
  '25.00 kHz',
  '30.00 kHz',
  '50.00 kHz',
];

/** Time-Out Timer (`cbTOT`) options (`0..12`). */
export const TOT_LABELS: readonly string[] = [
  'OFF',
  '30 sec',
  '60 sec',
  '90 sec',
  '120 sec',
  '150 sec',
  '180 sec',
  '210 sec',
  '240 sec',
  '270 sec',
  '300 sec',
  '330 sec',
  '360 sec',
];

/** VOX Delay (`cbVOX_DELAY`) options (`0..15`). */
export const VOX_DELAY_LABELS: readonly string[] = [
  '0.5 sec', '0.6 sec', '0.7 sec', '0.8 sec', '0.9 sec',
  '1.0 sec', '1.1 sec', '1.2 sec', '1.3 sec', '1.4 sec',
  '1.5 sec', '1.6 sec', '1.7 sec', '1.8 sec', '1.9 sec', '2.0 sec',
];

/** Auto Power Off (`cbAPO`) options (`0..6`). */
export const APO_LABELS: readonly string[] = [
  'OFF',
  '30 min',
  '60 min',
  '90 min',
  '120 min',
  '150 min',
  '180 min',
];

/** Backlight Timeout (`cbBackLight`) options (`0..11`). */
export const BACKLIGHT_LABELS: readonly string[] = [
  'Always On',
  '1 sec', '2 sec', '3 sec', '4 sec', '5 sec',
  '6 sec', '7 sec', '8 sec', '9 sec', '10 sec',
  'OFF',
];

/** LED Color options (`cbWaitColor`, `cbTxColor`, `cbRxColor`). */
export const LED_COLOR_LABELS: readonly string[] = [
  'OFF',
  'Red',
  'Green',
  'Blue',
];

/**
 * Generates a clean, zero-placeholder 47,046-byte `.Ysf` buffer initialized to
 * factory hardware defaults:
 * - 0 active memory channels (all 500 channel slots clean & empty; no leftover sample data)
 * - VFO A: `146.52000 MHz` FM High Wide
 * - VFO B: `446.00000 MHz` FM High Wide
 * - Handset Hotkeys: Unassigned (`0x00`) by default so the user chooses from the dropdowns
 * - Standard VHF (`136–174 MHz`) and UHF (`400–480 MHz`) band limits
 */
export function createCleanDefaultYsfBuffer(): Uint8Array {
  const buf = new Uint8Array(YSF_FILE_SIZE);
  const view = new DataView(buf.buffer);

  // 1. Write current timestamp at 0x0000..0x0005
  const now = new Date();
  const year = now.getFullYear();
  buf[0] = (year >> 8) & 0xff;
  buf[1] = year & 0xff;
  buf[2] = (now.getMonth() + 1) & 0xff;
  buf[3] = now.getDate() & 0xff;
  buf[4] = now.getHours() & 0xff;
  buf[5] = now.getMinutes() & 0xff;

  // 2. Initialize VFO A at 0x00AD (146.52000 MHz, FM, High Power, Wide)
  const vfoA = YSF_OFFSETS.VFO_A_RECORD;
  view.setUint32(vfoA + 0x00, 146520000, true); // RX Hz
  view.setUint32(vfoA + 0x0e, 146520000, true); // TX Hz
  buf[vfoA + 0x39] = 0x01; // Used / Scan bit
  buf[vfoA + 0x3a] = 0x02; // High Power (2), Wide (0)
  buf[vfoA + 0x3b] = 0x00; // Scramble Off, NOAA Off
  buf[vfoA + 0x3c] = 0x00; // FM, Tone None

  // 3. Initialize VFO B at 0x0102 (446.00000 MHz, FM, High Power, Wide)
  const vfoB = YSF_OFFSETS.VFO_B_RECORD;
  view.setUint32(vfoB + 0x00, 446000000, true); // RX Hz
  view.setUint32(vfoB + 0x0e, 446000000, true); // TX Hz
  buf[vfoB + 0x39] = 0x01;
  buf[vfoB + 0x3a] = 0x02; // High Power (2), Wide (0)
  buf[vfoB + 0x3b] = 0x00;
  buf[vfoB + 0x3c] = 0x00;

  // 4. VFO A & B Step Hz (12.5 kHz = 12500 Hz)
  view.setUint32(YSF_OFFSETS.VFO_A_STEP_HZ, 12500, true);
  view.setUint32(YSF_OFFSETS.VFO_B_STEP_HZ, 12500, true);

  // 5. Channel Used Bitmask at 0x015F..0x019D (all 0x00 = 0 active channels)
  buf.fill(0x00, YSF_OFFSETS.CHANNEL_USED_BITMASK, YSF_OFFSETS.CHANNEL_USED_BITMASK + 63);

  // 6. General Settings defaults in Tail (0xA839+)
  view.setUint32(YSF_OFFSETS.VFO_A_OFFSET_HZ, 600000, true); // 0.6 MHz
  view.setUint32(YSF_OFFSETS.VFO_B_OFFSET_HZ, 5000000, true); // 5.0 MHz
  buf[YSF_OFFSETS.VFO_A_OFFSET_DIR] = 0; // OFF
  buf[YSF_OFFSETS.VFO_B_OFFSET_DIR] = 0; // OFF
  view.setUint16(YSF_OFFSETS.SQUELCH_LEVEL, 3, true); // SQL 3
  buf[YSF_OFFSETS.TOT_INDEX] = 6; // 180s
  view.setUint16(YSF_OFFSETS.TOA_INDEX, 5, true); // 5s
  buf[YSF_OFFSETS.VOX_LEVEL] = 0; // OFF
  view.setUint16(YSF_OFFSETS.VOX_DELAY, 5, true); // 1.0s
  buf[YSF_OFFSETS.SAVING_RATE] = 1; // 1:2
  buf[YSF_OFFSETS.BATTERY_SAVE] = 1; // ON
  buf[YSF_OFFSETS.SCAN_MODE] = 1; // CO (Carrier Operated)
  buf[YSF_OFFSETS.BACKLIGHT_INDEX] = 5; // 5 sec
  buf[YSF_OFFSETS.DISPLAY_MODE_A] = 0; // Frequency
  buf[YSF_OFFSETS.DISPLAY_MODE_B] = 0; // Frequency
  buf[YSF_OFFSETS.STEP_INDEX_A] = 4; // 12.5K
  buf[YSF_OFFSETS.STEP_INDEX_B] = 4; // 12.5K
  view.setUint16(YSF_OFFSETS.APO_INDEX, 0, true); // OFF
  buf[YSF_OFFSETS.KEYPAD_BEEP] = 1; // ON
  buf[YSF_OFFSETS.POWER_ON_BEEP] = 1; // ON
  buf[YSF_OFFSETS.VOICE_PROMPT] = 2; // English
  buf[YSF_OFFSETS.LANGUAGE] = 1; // English
  buf[YSF_OFFSETS.WAIT_COLOR] = 0; // OFF
  buf[YSF_OFFSETS.TX_COLOR] = 1; // Red
  buf[YSF_OFFSETS.RX_COLOR] = 2; // Green
  buf[YSF_OFFSETS.SUBAUDIO_TAIL] = 1; // 120 deg
  buf[YSF_OFFSETS.BURST_TONE_1750] = 2; // 1750 Hz

  // 7. Handset Hotkeys (0xA88C..0xA891): Unassigned (0x00) — no forced default per User Requirement #4
  buf[YSF_OFFSETS.KEY1_SHORT] = 0x00;
  buf[YSF_OFFSETS.KEY1_LONG] = 0x00;
  buf[YSF_OFFSETS.KEY2_SHORT] = 0x00;
  buf[YSF_OFFSETS.KEY2_LONG] = 0x00;
  buf[YSF_OFFSETS.KEY3_SHORT] = 0x00;
  buf[YSF_OFFSETS.KEY3_LONG] = 0x00;

  // 8. DTMF Timing Defaults
  buf[YSF_OFFSETS.DTMF_SIDE_TONE] = 1;
  buf[YSF_OFFSETS.DTMF_RESET_TIME] = 10;
  view.setUint16(YSF_OFFSETS.DTMF_FIRST_TIME, 1, true);
  view.setUint16(YSF_OFFSETS.DTMF_DELAY_TIME, 1, true);
  view.setUint16(YSF_OFFSETS.DTMF_CONTINUE_TIME, 1, true);
  buf[YSF_OFFSETS.DTMF_INTERVAL_TIME] = 1;

  // 9. Welcome Messages (Clean default strings)
  writeFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_1, 'IC-980 PRO MAX', 16);
  writeFixedAscii(buf, YSF_OFFSETS.POWER_ON_MSG_2, 'OPEN_IC980PM', 20);
  writeFixedAscii(buf, YSF_OFFSETS.RADIO_CALLSIGN, '', 14);
  buf[YSF_OFFSETS.POWER_ON_DISPLAY_MODE] = 0; // Welcome Picture

  // 10. Band Limits at 0xB786..0xB7C5 (4 * 16B ASCII strings in MHz as stored by factory CPS)
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x00, '400.00000', 16); // U_min
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x10, '480.00000', 16); // U_max
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x20, '136.00000', 16); // V_min
  writeFixedAscii(buf, YSF_OFFSETS.BAND_LIMITS_START + 0x30, '174.00000', 16); // V_max

  return buf;
}

/**
 * Helper to write a null-padded ASCII string into a fixed-length slice of a Uint8Array.
 */
export function writeFixedAscii(buf: Uint8Array, offset: number, text: string, maxLength: number): void {
  buf.fill(0x00, offset, offset + maxLength);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  const len = Math.min(encoded.length, maxLength);
  for (let i = 0; i < len; i++) {
    buf[offset + i] = encoded[i];
  }
}

/**
 * Helper to read a null-terminated or fixed-length string from a Uint8Array.
 */
export function readFixedAscii(buf: Uint8Array, offset: number, maxLength: number): string {
  let end = offset;
  const limit = offset + maxLength;
  while (end < limit && buf[end] !== 0x00 && buf[end] !== 0xff) {
    end++;
  }
  const slice = buf.subarray(offset, end);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(slice).trim();
}
