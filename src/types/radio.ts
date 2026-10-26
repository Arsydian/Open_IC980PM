/**
 * @file src/types/radio.ts
 * @description Comprehensive TypeScript domain models and binary layout contracts for the
 * HIROYASU IC-980 Pro Max transceiver. Grounded in the reverse-engineered factory CPS
 * (`HIROYASU IC-980 Pro Max full english.exe`, TProgramDialog @ 0x00428F84 & TForm1 @ 0x004054D8).
 */

/** Subaudio tone signaling mode stored in Channel Byte 60 (bits 4..5 for RX, bits 6..7 for TX). */
export type ToneType = 'None' | 'CTCSS' | 'DCS_N' | 'DCS_I';

/** Transmit power level stored in Channel Byte 58 bits 0..1 (`0`=Low, `1`=Middle, `2`=High). */
export type TxPower = 'Low' | 'Middle' | 'High';

/** Channel bandwidth stored in Channel Byte 58 bit 2 (`0`=Wide 25kHz, `1`=Narrow 12.5kHz). */
export type Bandwidth = 'Wide' | 'Narrow';

/** Modulation mode stored in Channel Byte 60 bit 2 (`0`=FM, `1`=AM). */
export type ModulationMode = 'FM' | 'AM';

/** Repeater shift / offset direction (`0`=OFF, `1`=`+`, `2`=`-`). */
export type OffsetDirection = 'OFF' | '+' | '-';

/** PTT-ID signaling timing (`0`=Off, `1`=BOT, `2`=EOT, `3`=BOTH). */
export type PttIdMode = 'Off' | 'BOT' | 'EOT' | 'BOTH';

/**
 * Hardware Short Press values for Handset Hotkeys (`Key 1`, `Key 2`, `Key 3`).
 * Extracted from TForm1::FormCreate (`0x004054D8` - `0x004056D0`, lookup table `0x0058BD64`).
 */
export type HotkeyShortValue =
  | 0x00 // Unassigned
  | 0x08 // Radio (FM Broadcast)
  | 0x02 // Monitor
  | 0x09 // Alarm beep
  | 0x03 // Scan
  | 0x04 // Reverse Frequency (Repeater Reverse)
  | 0x0c; // Frequency match

/**
 * Hardware Long Press (Hold) values for Handset Hotkeys (`Key 1`, `Key 2`, `Key 3`).
 * Extracted from TForm1::FormCreate (`0x004056E0` - `0x00405907`, lookup table `0x0058BEA4`).
 */
export type HotkeyLongValue =
  | 0x00 // Unassigned
  | 0x08 // Radio (FM Broadcast)
  | 0x01 // Monitor (Latching)
  | 0x02 // Monitor Momentary
  | 0x09 // Alarm beep
  | 0x03 // Scan
  | 0x04 // Reverse Frequency (Repeater Reverse)
  | 0x0b // Warning light
  | 0x0c; // Frequency match

/**
 * Handset Hotkey configuration mapped to `.Ysf` `0xA88C..0xA891` and Radio EEPROM `0x0120C5..0x0120CA`.
 */
export interface HandsetHotkeyConfig {
  /** Key 1 Short Press (`.Ysf` `0xA88C`, EEPROM `0x0120C5`) */
  key1Short: HotkeyShortValue;
  /** Key 1 Long Press (`.Ysf` `0xA88D`, EEPROM `0x0120C6`) */
  key1Long: HotkeyLongValue;
  /** Key 2 Short Press (`.Ysf` `0xA88E`, EEPROM `0x0120C7`) */
  key2Short: HotkeyShortValue;
  /** Key 2 Long Press (`.Ysf` `0xA88F`, EEPROM `0x0120C8`) */
  key2Long: HotkeyLongValue;
  /** Key 3 Short Press (`.Ysf` `0xA890`, EEPROM `0x0120C9`) */
  key3Short: HotkeyShortValue;
  /** Key 3 Long Press (`.Ysf` `0xA891`, EEPROM `0x0120CA`) */
  key3Long: HotkeyLongValue;
}

/**
 * Single memory channel record (`1..500`).
 * Maps to an 85-byte `.Ysf` record (`offset = 564 + (channelNumber - 1) * 85`)
 * and a 34-byte Radio EEPROM record (`0x1000 + ((ch / 32) << 12) + (ch % 32) * 34`).
 */
export interface ChannelRecord {
  /** 1-based channel number (`1..500`) */
  channelNumber: number;
  /** Whether the channel slot is active/occupied (also mirrored in the 63-byte bitmask at `.Ysf` `0x015F`) */
  used: boolean;
  /** Receive frequency in Hz (e.g. `146520000` for `146.52000 MHz`) */
  rxFreqHz: number;
  /** Transmit frequency in Hz (e.g. `146520000` for `146.52000 MHz`) */
  txFreqHz: number;
  /** RX Subaudio mode (`None`, `CTCSS`, `DCS_N`, `DCS_I`) */
  rxToneType: ToneType;
  /** RX CTCSS frequency in Hz (e.g. `100.0`) or DCS octal code (e.g. `23` for `D023N`) */
  rxToneValue: number;
  /** TX Subaudio mode (`None`, `CTCSS`, `DCS_N`, `DCS_I`) */
  txToneType: ToneType;
  /** TX CTCSS frequency in Hz (e.g. `100.0`) or DCS octal code (e.g. `23` for `D023N`) */
  txToneValue: number;
  /** Enable 8-digit custom hex subaudio (`Byte 58 Bit 6 = 0x40`) */
  customSubaudioEnabled: boolean;
  /** 8-digit custom RX hex subaudio value (`u32`, stored when `customSubaudioEnabled` is true) */
  customRxSubaudioHex: string;
  /** 8-digit custom TX hex subaudio value (`u32`, stored when `customSubaudioEnabled` is true) */
  customTxSubaudioHex: string;
  /** TX Power (`Low`, `Middle`, `High`) */
  power: TxPower;
  /** Bandwidth (`Wide` 25kHz, `Narrow` 12.5kHz) */
  bandwidth: Bandwidth;
  /** Modulation (`FM` or `AM`) — `Byte 60 Bit 2 (0x04)` */
  modulation: ModulationMode;
  /** Busy Channel Lockout (`Byte 58 Bit 4 = 0x10`) */
  bcl: boolean;
  /** Include in Scan list (`Byte 57 Bit 0 = 0x01` is Scan Add; `true` = included) */
  scanAdd: boolean;
  /** PTT-ID transmit mode (`Byte 60 Bits 0..1`) */
  pttId: PttIdMode;
  /** PTT-ID Group index (`0..14` corresponding to Group `1..15`, stored in `Byte 62`) */
  pttIdGroup: number;
  /** Voice Scrambler index (`0` = Off, `1..8`, stored in `Byte 59 Bits 0..3`) */
  scramble: number;
  /** Hardware NOAA Weather Alert / Vague Subaudio flag (`Byte 59 Bit 4 = 0x10`) */
  noaaFlag: boolean;
  /** Channel Name (`up to 16 ASCII/GBK bytes`, stored at `+0x3F..+0x4E`) */
  name: string;
  /** Optional rich metadata preserved in `.ic980.json` bundles (e.g. RepeaterBook location, notes) */
  metadata?: {
    source?: 'manual' | 'repeaterbook' | 'chirp' | 'quickpack';
    callsign?: string;
    city?: string;
    state?: string;
    distanceMiles?: number;
    notes?: string;
  };
}

/**
 * VFO A or VFO B configuration record.
 * Stored in `.Ysf` Header (`0x00AD` for VFO A, `0x0102` for VFO B) plus tail offset fields (`0xA843..0xA86D`).
 * Maps to Radio EEPROM `0x11000..0x1105A`.
 */
export interface VfoConfig {
  /** Receive frequency in Hz */
  rxFreqHz: number;
  /** Transmit frequency in Hz */
  txFreqHz: number;
  /** RX Subaudio mode */
  rxToneType: ToneType;
  /** RX CTCSS (Hz) or DCS (octal int) */
  rxToneValue: number;
  /** TX Subaudio mode */
  txToneType: ToneType;
  /** TX CTCSS (Hz) or DCS (octal int) */
  txToneValue: number;
  /** TX Power (`Low`, `Middle`, `High`) */
  power: TxPower;
  /** Bandwidth (`Wide` or `Narrow`) */
  bandwidth: Bandwidth;
  /** Modulation (`FM` or `AM`) */
  modulation: ModulationMode;
  /** Busy Channel Lockout */
  bcl: boolean;
  /** Scrambler (`0..8`) */
  scramble: number;
  /** Repeater Shift Direction (`OFF`, `+`, `-`) */
  offsetDirection: OffsetDirection;
  /** Repeater Offset Frequency in Hz (e.g. `600000` for `0.600 MHz` or `5000000` for `5.000 MHz`) */
  offsetFreqHz: number;
  /** Frequency Step index (`0..8`: `2.5K, 5K, 6.25K, 10K, 12.5K, 20K, 25K, 30K, 50K`) */
  stepIndex: number;
  /** Display Mode (`0`=Frequency, `1`=Channel, `2`=Name) */
  displayMode: number;
}

/**
 * Cross-Band Repeater Preset Slot (`1..7`).
 * Stored in `.Ysf` at `0xB573..0xB61A` (`7 × 24` bytes) and `cbRepeatSwitch` at `0xB571` (EEPROM `0x120E5`).
 */
export interface CrossBandRepeaterSlot {
  /** Slot number (`1..7`) */
  slotNumber: number;
  /** Slot name / label */
  name: string;
  /** Band A Frequency in Hz */
  freqAHz: number;
  /** Band B Frequency in Hz */
  freqBHz: number;
  /** Subaudio Tone A Type */
  toneAType: ToneType;
  /** Subaudio Tone A Value */
  toneAValue: number;
  /** Subaudio Tone B Type */
  toneBType: ToneType;
  /** Subaudio Tone B Value */
  toneBValue: number;
  /** Power Level (`Low`, `Middle`, `High`) */
  power: TxPower;
}

/**
 * DTMF Signaling & Address Book Configuration.
 * Stored in `.Ysf` `0xA8A9..0xA911` and `0xB32D..0xB52A` (EEPROM `0x12082..0x120C4` and `0x15000..0x151FD`).
 */
export interface DtmfConfig {
  /** DTMF Side Tone (`0`=Off, `1`=DT-ST, `2`=ANI-ST, `3`=DT+ANI) */
  sideTone: number;
  /** First Digit Time (`0..4` = `100ms..500ms`) */
  firstDigitTime: number;
  /** Pre-load / Delay Time (`0..4` = `100ms..500ms`) */
  delayTime: number;
  /** Tone Duration (`0..4` = `50ms..250ms`) */
  continueTime: number;
  /** Inter-digit Interval (`0..4` = `50ms..250ms`) */
  intervalTime: number;
  /** Group Code character (`0`=None, `1`=A, `2`=B, `3`=C, `4`=D, `5`=`*`, `6`=`#`) */
  groupCode: number;
  /** Remote Control Response Mode (`0`=None, `1`=Remind, `2`=Reply, `3`=Remind+Reply) */
  responseMode: number;
  /** Auto Reset Time in seconds (`5..60`) */
  resetTimeSeconds: number;
  /** Local DTMF ID (up to 16 digits `0-9, A-D, *, #`) */
  localId: string;
  /** Remote Stun Code (up to 16 digits) */
  stunCode: string;
  /** Remote Kill Code (up to 16 digits) */
  killCode: string;
  /** Remote Revive / Wake Code (up to 16 digits) */
  reviveCode: string;
  /** 15 DTMF Memory Groups (`Group 1..15`, up to 16 digits each) */
  groups: string[];
  /** 15 DTMF Address Book Contact Entries (`1..15`, Name + Code) */
  contacts: Array<{
    index: number;
    name: string;
    code: string;
  }>;
}

/**
 * VHF / UHF Hardware Frequency Band Limits (`_config.ini` & `.Ysf` `0xB786..0xB7C5`, EEPROM `0x12006..0x12015`).
 */
export interface BandLimitsConfig {
  /** VHF Minimum Frequency in MHz (default `136.00000`) */
  vhfMinMhz: number;
  /** VHF Maximum Frequency in MHz (default `174.00000`) */
  vhfMaxMhz: number;
  /** UHF Minimum Frequency in MHz (default `400.00000`) */
  uhfMinMhz: number;
  /** UHF Maximum Frequency in MHz (default `480.00000`) */
  uhfMaxMhz: number;
}

/**
 * General Radio Settings mapped to `.Ysf` `0xA839..0xB572` and Radio EEPROM `0x12000..0x120FB`.
 */
export interface GeneralSettingsConfig {
  /** Squelch Level (`0..9`) — `.Ysf` `0xA850`, EEPROM `0x12056` */
  squelchLevel: number;
  /** Squelch Mode (`0`=Carrier, `1`=CTCSS/DCS, `2`=Carrier+CTCSS) — `.Ysf` `0xA840`, EEPROM `0x12075` */
  squelchMode: number;
  /** Time-Out Timer (`0`=OFF, `1..12` = `30s..360s`) — `.Ysf` `0xA853`, EEPROM `0x12058` */
  totIndex: number;
  /** Time-Out Pre-Alert (`0`=OFF, `1..10` seconds) — `.Ysf` `0xA854`, EEPROM `0x12076` */
  toaIndex: number;
  /** VOX Sensitivity Level (`0`=OFF, `1..9`) — `.Ysf` `0xA84D`, EEPROM `0x12064` */
  voxLevel: number;
  /** VOX Delay (`0..15` = `0.5s..2.0s`) — `.Ysf` `0xA84E`, EEPROM `0x12065` */
  voxDelayIndex: number;
  /**VOX Control enabled — `.Ysf` `0xA8A0` */
  voxControl: boolean;
  /** Battery Save Toggle — `.Ysf` `0xA86E`, EEPROM `0x12068` */
  batterySave: boolean;
  /** Battery Save Ratio (`0`=`1:1`, `1`=`1:2`, `2`=`1:4`, `3`=`1:8`) — `.Ysf` `0xA856`, EEPROM `0x12067` */
  savingRate: number;
  /** Scan Resume Mode (`0`=TO, `1`=CO, `2`=SE) — `.Ysf` `0xA857`, EEPROM `0x12059` */
  scanMode: number;
  /** Priority Scan Channel (`0`=OFF, `1..500`) — `.Ysf` `0xA858`, EEPROM `0x1205A` */
  priorityScanChannel: number;
  /** Dual Watch / Double Wait (`0`=OFF, `1`=ON) — `.Ysf` `0xA839`, EEPROM `0x12063` */
  dualWatch: boolean;
  /** Backlight Timeout (`0`=Always On, `1..10` sec, `11`=Off) — `.Ysf` `0xA85E`, EEPROM `0x1205C` */
  backlightIndex: number;
  /** Auto Power Off (`0`=OFF, `1..6` = `30m..180m`) — `.Ysf` `0xA863`, EEPROM `0x1205E` */
  apoIndex: number;
  /** Keypad Lock (`0`=Manual, `1`=Auto) — `.Ysf` `0xA841`, EEPROM `0x12073` */
  keyLockMode: number;
  /** Keypad Beep Toggle — `.Ysf` `0xA869`, EEPROM `0x1206D` */
  keypadBeep: boolean;
  /** Power-On Beep Toggle — `.Ysf` `0xA8A3` */
  powerOnBeep: boolean;
  /** Voice Prompt (`0`=OFF, `1`=Chinese, `2`=English) — `.Ysf` `0xA89D`, EEPROM `0x1206B` */
  voicePrompt: number;
  /** Channel Report on Startup — `.Ysf` `0xA8A1` */
  channelReport: boolean;
  /** Whisper High-Mic-Gain Mode — `.Ysf` `0xA8A4` */
  whisperMode: boolean;
  /** Roger Beep (`0`=OFF, `1`=Beep, `2`=1200Hz) — `.Ysf` `0xA86B`, EEPROM `0x1207B` */
  rogerBeep: number;
  /** Subaudio Tail Elimination (`0`=OFF, `1`=120 deg, `2`=180 deg) — `.Ysf` `0xA89C`, EEPROM `0x1206C` */
  subaudioTail: number;
  /** 1750Hz Burst Tone (`0`=1000Hz, `1`=1450Hz, `2`=1750Hz, `3`=2100Hz) — `.Ysf` `0xA8A6`, EEPROM `0x1207C` */
  burstToneFreq: number;
  /** Alarm Mode (`0`=On-Site, `1`=Send Sound, `2`=Send Code) — `.Ysf` `0xA881`, EEPROM `0x1206A` */
  alarmMode: number;
  /** Refuse Alarm Toggle — `.Ysf` `0xA89E`, EEPROM `0x1206F` */
  refuseAlarm: boolean;
  /** UI Menu Language (`0`=Chinese, `1`=English) — `.Ysf` `0xA86F`, EEPROM `0x12062` */
  language: number;
  /** Standby LED Color (`0`=Off, `1`=Red, `2`=Green, `3`=Blue) — `.Ysf` `0xA87E`, EEPROM `0x12070` */
  waitColor: number;
  /** Transmit LED Color — `.Ysf` `0xA87F`, EEPROM `0x12071` */
  txColor: number;
  /** Receive LED Color — `.Ysf` `0xA880`, EEPROM `0x12072` */
  rxColor: number;
  /** Power-On Display Mode (`0`=Welcome Picture, `1`=Welcome String, `2`=Battery Voltage) — `.Ysf` `0xB560`, EEPROM `0x1B000` */
  powerOnDisplayMode: number;
  /** Power-On Welcome Message Line 1 (up to 16 chars) — `.Ysf` `0xB52B`, EEPROM `0x1201E` */
  powerOnMsgLine1: string;
  /** Power-On Welcome Message Line 2 (up to 20 chars) — `.Ysf` `0xB53C`, EEPROM `0x1202E` */
  powerOnMsgLine2: string;
  /** Radio Callsign / Owner Name (`eHuHao`, up to 14 chars) — `.Ysf` `0xB551`, EEPROM `0x12046` */
  radioCallsign: string;
  /** Auto-Connect / Transponder Range Check Enable — `.Ysf` `0xA886`, EEPROM `0x1207D` */
  autoConnectEnabled: boolean;
  /** Auto-Connect Role (`0`=Master, `1`=Slave) — `.Ysf` `0xA887`, EEPROM `0x1207E` */
  autoConnectRole: number;
  /** Cross-Band Repeater Switch (`0`=OFF, `1..7`=Active Slot) — `.Ysf` `0xB571`, EEPROM `0x120E5` */
  crossBandRepeaterSwitch: number;
  /** Radio Programming Password Enable Flag */
  passwordEnabled: boolean;
  /** 6-Digit Programming Password (ASCII `0-9`, stored at `.Ysf` `0x0060`, encrypted to EEPROM `0x16000`) */
  password: string;
}

/**
 * Complete parsed state of a HIROYASU IC-980 Pro Max Codeplug.
 */
export interface RadioCodeplug {
  /** Timestamp of last write or save `[Year, Month, Day, Hour, Minute]` */
  lastWriteTimestamp: [number, number, number, number, number];
  /** 500 Memory Channels (`index 0..499` corresponding to Channel `1..500`) */
  channels: ChannelRecord[];
  /** VFO A Configuration */
  vfoA: VfoConfig;
  /** VFO B Configuration */
  vfoB: VfoConfig;
  /** Handset Hotkeys (`Key 1..3 Short & Long`) */
  hotkeys: HandsetHotkeyConfig;
  /** General Radio Settings */
  general: GeneralSettingsConfig;
  /** 7 Cross-Band Repeater Preset Slots */
  crossBandSlots: CrossBandRepeaterSlot[];
  /** DTMF Signaling & Address Book */
  dtmf: DtmfConfig;
  /** VHF / UHF Hardware Frequency Band Limits */
  bandLimits: BandLimitsConfig;
  /** Optional 775-byte RF Calibration snapshot (`0x18000..0x18306`) in Base64 */
  rfCalibrationBase64?: string;
  /** Underlying 47,046-byte `.Ysf` buffer preserved for lossless round-trip of unmapped bytes */
  rawYsfBuffer: Uint8Array;
}

/**
 * Channel Import Insertion Mode (User Requirement #6):
 * - `append_empty` (Default): Append imported channels into the first available empty channel slots.
 * - `insert_at`: Insert at the currently selected channel, shifting existing subsequent channels down.
 * - `overwrite_at`: Overwrite existing channels starting at the currently selected channel number.
 */
export type ChannelInsertionMode = 'append_empty' | 'insert_at' | 'overwrite_at';

/**
 * RepeaterBook API Query Parameters (User Requirement #5).
 */
export interface RepeaterBookQuery {
  /** Region selector: North America (`us_ca`) or Rest of World (`row`) */
  region: 'us_ca' | 'row';
  /** Search mode: `location` (State/Province + City/County) or `proximity` (Lat/Long + Radius) */
  searchMode: 'location' | 'proximity';
  /** Country (for RoW or US/Canada) */
  country?: string;
  /** State / Province ID or name */
  state?: string;
  /** City or County filter */
  city?: string;
  /** Center Latitude in decimal degrees (for `proximity` mode) */
  latitude?: number;
  /** Center Longitude in decimal degrees (for `proximity` mode) */
  longitude?: number;
  /** Search radius (for `proximity` mode) */
  radius?: number;
  /** Distance unit (`miles` or `km`) */
  distanceUnit?: 'miles' | 'km';
  /** Arbitrary maximum number of results to return (`N`) */
  maxResults: number;
  /** Only include On-Air / Operational repeaters */
  openOnly?: boolean;
}

/**
 * Automatic Pre-Write EEPROM Safety Snapshot stored in the Rollback Vault.
 */
export interface RollbackSnapshot {
  /** Unique snapshot identifier */
  id: string;
  /** ISO-8601 timestamp when the snapshot was captured */
  createdAt: string;
  /** Human-readable label (e.g. `"Pre-Write Safety Snapshot"`, `"Manual Backup"`) */
  label: string;
  /** Number of active channels in the snapshot */
  activeChannelCount: number;
  /** Base64-encoded 47,046-byte `.Ysf` binary */
  ysfBase64: string;
  /** Optional Base64-encoded 775-byte RF Calibration (`0x18000..0x18306`) */
  calibrationBase64?: string;
}
