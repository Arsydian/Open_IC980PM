/**
 * @file src/core/eepromCodec.ts
 * @description Bidirectional marshaler between the 47,046-byte `.Ysf` file format and the
 * HIROYASU IC-980 Pro Max Radio EEPROM memory map (`0x00000` - `0x18306`).
 * Verified line-by-line from `TProgramDialog::GetDataForWrite` (`0x00428F84`) and
 * `TProgramDialog::SetDataToSoftware` (`0x00429B50`).
 */

import {
  EEPROM_IMAGE_SIZE,
  MAX_CHANNELS,
  YSF_CHANNEL_SIZE,
  YSF_FILE_SIZE,
  YSF_OFFSETS,
  createCleanDefaultYsfBuffer,
  readFixedAscii,
  writeFixedAscii,
} from './constants';
import { decryptRadioPassword, encryptRadioPassword } from './passwordCipher';
import { isChannelBitSet } from './ysfCodec';

/**
 * Computes the exact Radio EEPROM byte address for a 1-based channel (`1..500`).
 * Disassembled from `sub_4280E0`:
 *   `addr = 0x1000 + ((channelNumber / 32) << 12) + (channelNumber % 32) * 34`
 * Each 4,096-byte (`0x1000`) flash sector holds 32 channels of 34 bytes (`1,088` bytes used per sector).
 */
export function computeChannelEepromAddress(channelNumber: number): number {
  if (channelNumber < 1 || channelNumber > MAX_CHANNELS) {
    throw new RangeError(`Channel number out of range (1..${MAX_CHANNELS}): ${channelNumber}`);
  }
  const sector = channelNumber >> 5; // channelNumber / 32
  const slotInSector = channelNumber & 0x1f; // channelNumber % 32
  return 0x1000 + (sector << 12) + slotInSector * 34;
}

/**
 * Returns the compact 34-byte Radio EEPROM representation of a channel from a `.Ysf` buffer.
 */
export function extractChannelEeprom34Bytes(ysfBuf: Uint8Array, channelNumber: number): Uint8Array {
  const out = new Uint8Array(34);
  out.fill(0xff);

  if (!isChannelBitSet(ysfBuf, channelNumber)) {
    return out;
  }

  const ysfOff = YSF_OFFSETS.CHANNELS_START + (channelNumber - 1) * YSF_CHANNEL_SIZE;
  const ysfView = new DataView(ysfBuf.buffer, ysfBuf.byteOffset + ysfOff, YSF_CHANNEL_SIZE);
  const outView = new DataView(out.buffer);

  out.fill(0x00);
  // +0x00..+0x03: RX Frequency (u32 LE)
  outView.setUint32(0x00, ysfView.getUint32(0x00, true), true);
  // +0x04..+0x07: TX Frequency (u32 LE)
  outView.setUint32(0x04, ysfView.getUint32(0x0e, true), true);

  const byte58 = ysfBuf[ysfOff + 0x3a];
  const customSub = (byte58 & 0x40) !== 0;

  if (customSub) {
    // 8-digit custom subaudio mode writes 4-byte custom RX/TX at +0x08..+0x0B or tone words
    outView.setUint16(0x08, ysfView.getUint16(0x18, true), true);
    outView.setUint16(0x0a, ysfView.getUint16(0x25, true), true);
  } else {
    // +0x08..+0x09: RX Tone Word (u16 LE)
    outView.setUint16(0x08, ysfView.getUint16(0x1c, true), true);
    // +0x0A..+0x0B: TX Tone Word (u16 LE)
    outView.setUint16(0x0a, ysfView.getUint16(0x29, true), true);
  }

  // +0x0C..+0x11: 6 Flag bytes (+0x39..+0x3E)
  for (let i = 0; i < 6; i++) {
    out[0x0c + i] = ysfBuf[ysfOff + 0x39 + i];
  }

  // +0x12..+0x21: 16-byte Channel Name (+0x3F..+0x4E)
  for (let i = 0; i < 16; i++) {
    out[0x12 + i] = ysfBuf[ysfOff + 0x3f + i];
  }

  return out;
}

/**
 * Marshals a 47,046-byte `.Ysf` buffer into a full Radio EEPROM binary image (`0x00000..0x18306`).
 * Implements `TProgramDialog::GetDataForWrite` (`0x00428F84`).
 */
export function ysfToEepromImage(ysfBuf: Uint8Array): Uint8Array {
  if (ysfBuf.byteLength !== YSF_FILE_SIZE) {
    throw new Error(`Expected ${YSF_FILE_SIZE}-byte .Ysf buffer, got ${ysfBuf.byteLength}`);
  }

  const eeprom = new Uint8Array(EEPROM_IMAGE_SIZE);
  eeprom.fill(0xff);
  const ysfView = new DataView(ysfBuf.buffer, ysfBuf.byteOffset, ysfBuf.byteLength);
  const eepView = new DataView(eeprom.buffer);

  // 1. Copy 63-byte Channel Used Bitmask to EEPROM 0x000000..0x00003E
  eeprom.set(
    ysfBuf.subarray(YSF_OFFSETS.CHANNEL_USED_BITMASK, YSF_OFFSETS.CHANNEL_USED_BITMASK + 63),
    0x000000
  );

  // 2. Marshal all 500 Channels into banked sectors 0x01000..0x1043F
  for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
    if (isChannelBitSet(ysfBuf, ch)) {
      const addr = computeChannelEepromAddress(ch);
      const chBytes = extractChannelEeprom34Bytes(ysfBuf, ch);
      eeprom.set(chBytes, addr);
    }
  }

  // 3. Marshal VFO A (0x11000..0x1102A) & VFO B (0x11030..0x1105A)
  const vfoAOff = YSF_OFFSETS.VFO_A_RECORD;
  eepView.setUint32(0x11000, ysfView.getUint32(vfoAOff + 0x00, true), true);
  eepView.setUint32(0x11004, ysfView.getUint32(vfoAOff + 0x0e, true), true);
  eepView.setUint16(0x11008, ysfView.getUint16(vfoAOff + 0x1c, true), true);
  eepView.setUint16(0x1100a, ysfView.getUint16(vfoAOff + 0x29, true), true);
  for (let i = 0; i < 6; i++) {
    eeprom[0x1100c + i] = ysfBuf[vfoAOff + 0x39 + i];
  }
  eepView.setUint32(0x11022, ysfView.getUint32(YSF_OFFSETS.VFO_A_STEP_HZ, true), true);
  eeprom[0x11026] = ysfBuf[YSF_OFFSETS.VFO_A_OFFSET_DIR];
  eepView.setUint32(0x11027, ysfView.getUint32(YSF_OFFSETS.VFO_A_OFFSET_HZ, true), true);

  const vfoBOff = YSF_OFFSETS.VFO_B_RECORD;
  eepView.setUint32(0x11030, ysfView.getUint32(vfoBOff + 0x00, true), true);
  eepView.setUint32(0x11034, ysfView.getUint32(vfoBOff + 0x0e, true), true);
  eepView.setUint16(0x11038, ysfView.getUint16(vfoBOff + 0x1c, true), true);
  eepView.setUint16(0x1103a, ysfView.getUint16(vfoBOff + 0x29, true), true);
  for (let i = 0; i < 6; i++) {
    eeprom[0x1103c + i] = ysfBuf[vfoBOff + 0x39 + i];
  }
  eepView.setUint32(0x11052, ysfView.getUint32(YSF_OFFSETS.VFO_B_STEP_HZ, true), true);
  eeprom[0x11056] = ysfBuf[YSF_OFFSETS.VFO_B_OFFSET_DIR];
  eepView.setUint32(0x11057, ysfView.getUint32(YSF_OFFSETS.VFO_B_OFFSET_HZ, true), true);

  // 4. Marshal General Settings & Hotkeys into 0x12000..0x120FB
  eeprom.fill(0x00, 0x12000, 0x12100);
  // Write timestamp 0x12000..0x12005
  eeprom.set(ysfBuf.subarray(0x0000, 0x0006), 0x12000);

  // Band Limits in 10Hz units at 0x12006..0x12015 (vMin, vMax, uMin, uMax)
  const uMinMhz = parseFloat(readFixedAscii(ysfBuf, YSF_OFFSETS.BAND_LIMITS_START + 0x00, 16)) || 400.0;
  const uMaxMhz = parseFloat(readFixedAscii(ysfBuf, YSF_OFFSETS.BAND_LIMITS_START + 0x10, 16)) || 480.0;
  const vMinMhz = parseFloat(readFixedAscii(ysfBuf, YSF_OFFSETS.BAND_LIMITS_START + 0x20, 16)) || 136.0;
  const vMaxMhz = parseFloat(readFixedAscii(ysfBuf, YSF_OFFSETS.BAND_LIMITS_START + 0x30, 16)) || 174.0;
  eepView.setUint32(0x12006, Math.round(vMinMhz * 100000) >>> 0, true);
  eepView.setUint32(0x1200a, Math.round(vMaxMhz * 100000) >>> 0, true);
  eepView.setUint32(0x1200e, Math.round(uMinMhz * 100000) >>> 0, true);
  eepView.setUint32(0x12012, Math.round(uMaxMhz * 100000) >>> 0, true);

  // Welcome messages & Callsign
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.POWER_ON_MSG_1, YSF_OFFSETS.POWER_ON_MSG_1 + 16), 0x1201e);
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.POWER_ON_MSG_2, YSF_OFFSETS.POWER_ON_MSG_2 + 20), 0x1202e);
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.RADIO_CALLSIGN, YSF_OFFSETS.RADIO_CALLSIGN + 14), 0x12046);

  // Radio Parameters
  eepView.setUint16(0x12056, ysfView.getUint16(YSF_OFFSETS.SQUELCH_LEVEL, true), true);
  eeprom[0x12058] = ysfBuf[YSF_OFFSETS.TOT_INDEX];
  eeprom[0x12059] = ysfBuf[YSF_OFFSETS.SCAN_MODE];
  eepView.setUint16(0x1205a, ysfView.getUint16(YSF_OFFSETS.PRIORITY_SCAN_CH, true), true);
  eeprom[0x1205c] = ysfBuf[YSF_OFFSETS.BACKLIGHT_INDEX];
  eeprom[0x1205d] = ysfBuf[YSF_OFFSETS.STEP_INDEX_A];
  eepView.setUint16(0x1205e, ysfView.getUint16(YSF_OFFSETS.APO_INDEX, true), true);
  eeprom[0x12060] = ysfBuf[YSF_OFFSETS.DISPLAY_MODE_A];
  eeprom[0x12061] = ysfBuf[YSF_OFFSETS.DISPLAY_MODE_B];
  eeprom[0x12062] = ysfBuf[YSF_OFFSETS.LANGUAGE];
  eeprom[0x12063] = ysfBuf[YSF_OFFSETS.DUAL_WATCH];
  eeprom[0x12064] = ysfBuf[YSF_OFFSETS.VOX_LEVEL];
  eepView.setUint16(0x12065, ysfView.getUint16(YSF_OFFSETS.VOX_DELAY, true), true);
  eeprom[0x12067] = ysfBuf[YSF_OFFSETS.SAVING_RATE];
  eeprom[0x12068] = ysfBuf[YSF_OFFSETS.BATTERY_SAVE];
  eeprom[0x1206a] = ysfBuf[YSF_OFFSETS.ALARM_MODE];
  eeprom[0x1206b] = ysfBuf[YSF_OFFSETS.VOICE_PROMPT];
  eeprom[0x1206c] = ysfBuf[YSF_OFFSETS.SUBAUDIO_TAIL];
  eeprom[0x1206d] = ysfBuf[YSF_OFFSETS.KEYPAD_BEEP];
  eeprom[0x1206f] = ysfBuf[YSF_OFFSETS.REFUSE_ALARM];
  eeprom[0x12070] = ysfBuf[YSF_OFFSETS.WAIT_COLOR];
  eeprom[0x12071] = ysfBuf[YSF_OFFSETS.TX_COLOR];
  eeprom[0x12072] = ysfBuf[YSF_OFFSETS.RX_COLOR];
  eeprom[0x12073] = ysfBuf[YSF_OFFSETS.KEY_LOCK];
  eeprom[0x12074] = ysfBuf[YSF_OFFSETS.VOX_CONTROL];
  eeprom[0x12075] = ysfBuf[YSF_OFFSETS.SQUELCH_MODE];
  eepView.setUint16(0x12076, ysfView.getUint16(YSF_OFFSETS.TOA_INDEX, true), true);
  eeprom[0x12078] = ysfBuf[YSF_OFFSETS.CHANNEL_REPORT];
  eeprom[0x12079] = ysfBuf[YSF_OFFSETS.POWER_ON_BEEP];
  eeprom[0x1207a] = ysfBuf[YSF_OFFSETS.WHISPER_MODE];
  eeprom[0x1207b] = ysfBuf[YSF_OFFSETS.ROGER_BEEP];
  eeprom[0x1207c] = ysfBuf[YSF_OFFSETS.BURST_TONE_1750];
  eeprom[0x1207d] = ysfBuf[YSF_OFFSETS.AUTOCONNECT_ENABLE];
  eeprom[0x1207e] = ysfBuf[YSF_OFFSETS.AUTOCONNECT_ROLE];

  // DTMF settings in 0x12082..0x120C4
  eeprom[0x12082] = ysfBuf[YSF_OFFSETS.DTMF_SIDE_TONE];
  eeprom[0x12083] = ysfBuf[YSF_OFFSETS.DTMF_RESPONSE];
  eeprom[0x12084] = ysfBuf[YSF_OFFSETS.DTMF_RESET_TIME];
  eepView.setUint16(0x12085, ysfView.getUint16(YSF_OFFSETS.DTMF_FIRST_TIME, true), true);
  eepView.setUint16(0x12087, ysfView.getUint16(YSF_OFFSETS.DTMF_DELAY_TIME, true), true);
  eepView.setUint16(0x12089, ysfView.getUint16(YSF_OFFSETS.DTMF_CONTINUE_TIME, true), true);
  eeprom[0x1208b] = ysfBuf[YSF_OFFSETS.DTMF_GROUP_CODE];
  eeprom[0x1208c] = ysfBuf[YSF_OFFSETS.DTMF_INTERVAL_TIME];
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.DTMF_STUN_CODE, YSF_OFFSETS.DTMF_STUN_CODE + 17), 0x1208f);
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.DTMF_KILL_CODE, YSF_OFFSETS.DTMF_KILL_CODE + 17), 0x120a0);
  eeprom.set(ysfBuf.subarray(YSF_OFFSETS.DTMF_REVIVE_CODE, YSF_OFFSETS.DTMF_REVIVE_CODE + 17), 0x120b1);

  // Handset Hotkeys: Key 1..3 Short & Long -> EEPROM 0x120C5..0x120CA
  eeprom[0x120c5] = ysfBuf[YSF_OFFSETS.KEY1_SHORT];
  eeprom[0x120c6] = ysfBuf[YSF_OFFSETS.KEY1_LONG];
  eeprom[0x120c7] = ysfBuf[YSF_OFFSETS.KEY2_SHORT];
  eeprom[0x120c8] = ysfBuf[YSF_OFFSETS.KEY2_LONG];
  eeprom[0x120c9] = ysfBuf[YSF_OFFSETS.KEY3_SHORT];
  eeprom[0x120ca] = ysfBuf[YSF_OFFSETS.KEY3_LONG];

  eeprom[0x120e4] = ysfBuf[YSF_OFFSETS.STEP_INDEX_B];
  eeprom[0x120e5] = ysfBuf[YSF_OFFSETS.CROSS_BAND_SWITCH];
  eeprom[0x120fb] = 0x37; // Hardware magic byte written at 0x00429A85

  // 5. Copy 30 DTMF Entries (30 * 17 = 510 bytes) to EEPROM 0x15000..0x151FD
  eeprom.set(
    ysfBuf.subarray(YSF_OFFSETS.DTMF_ENTRIES_START, YSF_OFFSETS.DTMF_ENTRIES_START + 30 * 17),
    0x15000
  );

  // 6. Encrypt & Write 16-byte Programming Password to EEPROM 0x16000..0x1600F
  const pwdEnabled = ysfBuf[YSF_OFFSETS.PASSWORD_ENABLE] !== 0;
  const pwdAscii = readFixedAscii(ysfBuf, YSF_OFFSETS.PASSWORD_ASCII, 6);
  const cipher16 = encryptRadioPassword(pwdEnabled ? pwdAscii : '');
  eeprom.set(cipher16, 0x16000);

  return eeprom;
}

/**
 * Unmarshals a Radio EEPROM binary image (`0x00000..0x18306`) into a 47,046-byte `.Ysf` buffer.
 * Implements `TProgramDialog::SetDataToSoftware` (`0x00429B50`).
 *
 * Fields with no known EEPROM location (cross-band preset slots, DTMF local ID, power-on display
 * mode) are taken from `baseTemplate`, or factory defaults when no template is given.
 */
export function eepromImageToYsf(eeprom: Uint8Array, baseTemplate?: Uint8Array): Uint8Array {
  const ysf =
    baseTemplate && baseTemplate.byteLength === YSF_FILE_SIZE
      ? new Uint8Array(baseTemplate)
      : createCleanDefaultYsfBuffer();

  const ysfView = new DataView(ysf.buffer, ysf.byteOffset, ysf.byteLength);
  const eepView = new DataView(eeprom.buffer, eeprom.byteOffset, eeprom.byteLength);

  // 1. Copy 63-byte Channel Used Bitmask from EEPROM 0x000000..0x00003E
  ysf.set(eeprom.subarray(0x000000, 0x00003f), YSF_OFFSETS.CHANNEL_USED_BITMASK);

  // 2. Unmarshal all 500 Channels
  for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
    const ysfOff = YSF_OFFSETS.CHANNELS_START + (ch - 1) * YSF_CHANNEL_SIZE;
    ysf.fill(0x00, ysfOff, ysfOff + YSF_CHANNEL_SIZE);

    if (!isChannelBitSet(ysf, ch)) {
      continue;
    }

    const addr = computeChannelEepromAddress(ch);
    const rxHz = eepView.getUint32(addr + 0x00, true);
    const txHz = eepView.getUint32(addr + 0x04, true);
    if (rxHz === 0xffffffff || rxHz === 0) {
      continue;
    }

    ysfView.setUint32(ysfOff + 0x00, rxHz, true);
    ysfView.setUint32(ysfOff + 0x0e, txHz, true);
    ysfView.setUint16(ysfOff + 0x1c, eepView.getUint16(addr + 0x08, true), true);
    ysfView.setUint16(ysfOff + 0x29, eepView.getUint16(addr + 0x0a, true), true);

    for (let i = 0; i < 6; i++) {
      ysf[ysfOff + 0x39 + i] = eeprom[addr + 0x0c + i];
    }

    const byte60 = ysf[ysfOff + 0x3c];
    ysf[ysfOff + 0x1e] = (byte60 >> 4) & 0x03;
    ysf[ysfOff + 0x2b] = (byte60 >> 6) & 0x03;

    // 16-byte Channel Name
    ysf.set(eeprom.subarray(addr + 0x12, addr + 0x22), ysfOff + 0x3f);
  }

  // 3. Unmarshal VFO A & VFO B
  const vfoAOff = YSF_OFFSETS.VFO_A_RECORD;
  ysfView.setUint32(vfoAOff + 0x00, eepView.getUint32(0x11000, true), true);
  ysfView.setUint32(vfoAOff + 0x0e, eepView.getUint32(0x11004, true), true);
  ysfView.setUint16(vfoAOff + 0x1c, eepView.getUint16(0x11008, true), true);
  ysfView.setUint16(vfoAOff + 0x29, eepView.getUint16(0x1100a, true), true);
  for (let i = 0; i < 6; i++) {
    ysf[vfoAOff + 0x39 + i] = eeprom[0x1100c + i];
  }
  ysf[vfoAOff + 0x1e] = (ysf[vfoAOff + 0x3c] >> 4) & 0x03;
  ysf[vfoAOff + 0x2b] = (ysf[vfoAOff + 0x3c] >> 6) & 0x03;
  ysfView.setUint32(YSF_OFFSETS.VFO_A_STEP_HZ, eepView.getUint32(0x11022, true), true);
  ysf[YSF_OFFSETS.VFO_A_OFFSET_DIR] = eeprom[0x11026];
  ysfView.setUint32(YSF_OFFSETS.VFO_A_OFFSET_HZ, eepView.getUint32(0x11027, true), true);

  const vfoBOff = YSF_OFFSETS.VFO_B_RECORD;
  ysfView.setUint32(vfoBOff + 0x00, eepView.getUint32(0x11030, true), true);
  ysfView.setUint32(vfoBOff + 0x0e, eepView.getUint32(0x11034, true), true);
  ysfView.setUint16(vfoBOff + 0x1c, eepView.getUint16(0x11038, true), true);
  ysfView.setUint16(vfoBOff + 0x29, eepView.getUint16(0x1103a, true), true);
  for (let i = 0; i < 6; i++) {
    ysf[vfoBOff + 0x39 + i] = eeprom[0x1103c + i];
  }
  ysf[vfoBOff + 0x1e] = (ysf[vfoBOff + 0x3c] >> 4) & 0x03;
  ysf[vfoBOff + 0x2b] = (ysf[vfoBOff + 0x3c] >> 6) & 0x03;
  ysfView.setUint32(YSF_OFFSETS.VFO_B_STEP_HZ, eepView.getUint32(0x11052, true), true);
  ysf[YSF_OFFSETS.VFO_B_OFFSET_DIR] = eeprom[0x11056];
  ysfView.setUint32(YSF_OFFSETS.VFO_B_OFFSET_HZ, eepView.getUint32(0x11057, true), true);

  // 4. Unmarshal General Settings & Hotkeys from 0x12000..0x120FB
  ysf.set(eeprom.subarray(0x12000, 0x12006), 0x0000);

  // Band Limits: 10Hz units at 0x12006..0x12015 (vMin, vMax, uMin, uMax) -> 16-byte ASCII MHz.
  // Unprogrammed (0 / 0xFFFFFFFF) or implausible values keep the template's limit.
  const bandLimitFields: ReadonlyArray<[number, number]> = [
    [0x12006, YSF_OFFSETS.BAND_LIMITS_START + 0x20],
    [0x1200a, YSF_OFFSETS.BAND_LIMITS_START + 0x30],
    [0x1200e, YSF_OFFSETS.BAND_LIMITS_START + 0x00],
    [0x12012, YSF_OFFSETS.BAND_LIMITS_START + 0x10],
  ];
  for (const [eepAddr, ysfOff] of bandLimitFields) {
    const mhz = eepView.getUint32(eepAddr, true) / 100000;
    if (mhz >= 18.0 && mhz <= 999.0) {
      writeFixedAscii(ysf, ysfOff, mhz.toFixed(5), 16);
    }
  }

  ysf.set(eeprom.subarray(0x1201e, 0x1202e), YSF_OFFSETS.POWER_ON_MSG_1);
  ysf.set(eeprom.subarray(0x1202e, 0x12042), YSF_OFFSETS.POWER_ON_MSG_2);
  ysf.set(eeprom.subarray(0x12046, 0x12054), YSF_OFFSETS.RADIO_CALLSIGN);

  ysfView.setUint16(YSF_OFFSETS.SQUELCH_LEVEL, eepView.getUint16(0x12056, true), true);
  ysf[YSF_OFFSETS.TOT_INDEX] = eeprom[0x12058];
  ysf[YSF_OFFSETS.SCAN_MODE] = eeprom[0x12059];
  ysfView.setUint16(YSF_OFFSETS.PRIORITY_SCAN_CH, eepView.getUint16(0x1205a, true), true);
  ysf[YSF_OFFSETS.BACKLIGHT_INDEX] = eeprom[0x1205c];
  ysf[YSF_OFFSETS.STEP_INDEX_A] = eeprom[0x1205d];
  ysfView.setUint16(YSF_OFFSETS.APO_INDEX, eepView.getUint16(0x1205e, true), true);
  ysf[YSF_OFFSETS.DISPLAY_MODE_A] = eeprom[0x12060];
  ysf[YSF_OFFSETS.DISPLAY_MODE_B] = eeprom[0x12061];
  ysf[YSF_OFFSETS.LANGUAGE] = eeprom[0x12062];
  ysf[YSF_OFFSETS.DUAL_WATCH] = eeprom[0x12063];
  ysf[YSF_OFFSETS.VOX_LEVEL] = eeprom[0x12064];
  ysfView.setUint16(YSF_OFFSETS.VOX_DELAY, eepView.getUint16(0x12065, true), true);
  ysf[YSF_OFFSETS.SAVING_RATE] = eeprom[0x12067];
  ysf[YSF_OFFSETS.BATTERY_SAVE] = eeprom[0x12068];
  ysf[YSF_OFFSETS.ALARM_MODE] = eeprom[0x1206a];
  ysf[YSF_OFFSETS.VOICE_PROMPT] = eeprom[0x1206b];
  ysf[YSF_OFFSETS.SUBAUDIO_TAIL] = eeprom[0x1206c];
  ysf[YSF_OFFSETS.KEYPAD_BEEP] = eeprom[0x1206d];
  ysf[YSF_OFFSETS.REFUSE_ALARM] = eeprom[0x1206f];
  ysf[YSF_OFFSETS.WAIT_COLOR] = eeprom[0x12070];
  ysf[YSF_OFFSETS.TX_COLOR] = eeprom[0x12071];
  ysf[YSF_OFFSETS.RX_COLOR] = eeprom[0x12072];
  ysf[YSF_OFFSETS.KEY_LOCK] = eeprom[0x12073];
  ysf[YSF_OFFSETS.VOX_CONTROL] = eeprom[0x12074];
  ysf[YSF_OFFSETS.SQUELCH_MODE] = eeprom[0x12075];
  ysfView.setUint16(YSF_OFFSETS.TOA_INDEX, eepView.getUint16(0x12076, true), true);
  ysf[YSF_OFFSETS.CHANNEL_REPORT] = eeprom[0x12078];
  ysf[YSF_OFFSETS.POWER_ON_BEEP] = eeprom[0x12079];
  ysf[YSF_OFFSETS.WHISPER_MODE] = eeprom[0x1207a];
  ysf[YSF_OFFSETS.ROGER_BEEP] = eeprom[0x1207b];
  ysf[YSF_OFFSETS.BURST_TONE_1750] = eeprom[0x1207c];
  ysf[YSF_OFFSETS.AUTOCONNECT_ENABLE] = eeprom[0x1207d];
  ysf[YSF_OFFSETS.AUTOCONNECT_ROLE] = eeprom[0x1207e];

  // DTMF settings
  ysf[YSF_OFFSETS.DTMF_SIDE_TONE] = eeprom[0x12082];
  ysf[YSF_OFFSETS.DTMF_RESPONSE] = eeprom[0x12083];
  ysf[YSF_OFFSETS.DTMF_RESET_TIME] = eeprom[0x12084];
  ysfView.setUint16(YSF_OFFSETS.DTMF_FIRST_TIME, eepView.getUint16(0x12085, true), true);
  ysfView.setUint16(YSF_OFFSETS.DTMF_DELAY_TIME, eepView.getUint16(0x12087, true), true);
  ysfView.setUint16(YSF_OFFSETS.DTMF_CONTINUE_TIME, eepView.getUint16(0x12089, true), true);
  ysf[YSF_OFFSETS.DTMF_GROUP_CODE] = eeprom[0x1208b];
  ysf[YSF_OFFSETS.DTMF_INTERVAL_TIME] = eeprom[0x1208c];
  ysf.set(eeprom.subarray(0x1208f, 0x120a0), YSF_OFFSETS.DTMF_STUN_CODE);
  ysf.set(eeprom.subarray(0x120a0, 0x120b1), YSF_OFFSETS.DTMF_KILL_CODE);
  ysf.set(eeprom.subarray(0x120b1, 0x120c2), YSF_OFFSETS.DTMF_REVIVE_CODE);

  // Handset Hotkeys: EEPROM 0x120C5..0x120CA -> .Ysf 0xA88C..0xA891
  ysf[YSF_OFFSETS.KEY1_SHORT] = eeprom[0x120c5];
  ysf[YSF_OFFSETS.KEY1_LONG] = eeprom[0x120c6];
  ysf[YSF_OFFSETS.KEY2_SHORT] = eeprom[0x120c7];
  ysf[YSF_OFFSETS.KEY2_LONG] = eeprom[0x120c8];
  ysf[YSF_OFFSETS.KEY3_SHORT] = eeprom[0x120c9];
  ysf[YSF_OFFSETS.KEY3_LONG] = eeprom[0x120ca];

  ysf[YSF_OFFSETS.STEP_INDEX_B] = eeprom[0x120e4];
  ysf[YSF_OFFSETS.CROSS_BAND_SWITCH] = eeprom[0x120e5];

  // 5. Copy 30 DTMF Entries from EEPROM 0x15000..0x151FD
  ysf.set(eeprom.subarray(0x15000, 0x15000 + 30 * 17), YSF_OFFSETS.DTMF_ENTRIES_START);

  // 6. Decrypt Password from EEPROM 0x16000..0x1600F
  if (eeprom.byteLength >= 0x16010) {
    const pwd = decryptRadioPassword(eeprom.subarray(0x16000, 0x16010));
    ysf[YSF_OFFSETS.PASSWORD_ENABLE] = pwd.length === 6 ? 1 : 0;
    for (let i = 0; i < 6; i++) {
      ysf[YSF_OFFSETS.PASSWORD_ASCII + i] = i < pwd.length ? pwd.charCodeAt(i) : 0x00;
    }
  }

  return ysf;
}
