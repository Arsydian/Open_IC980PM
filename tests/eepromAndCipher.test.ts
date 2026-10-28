/**
 * @file tests/eepromAndCipher.test.ts
 * @description Unit tests for the EEPROM marshaler (`src/core/eepromCodec.ts`),
 * 16-byte password cipher (`src/core/passwordCipher.ts`), USB HID report framing
 * (`src/core/hidProtocol.ts`), and 160x128 RGB565 Boot Logo codec (`src/core/bmpLogoCodec.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  computeChannelEepromAddress,
  eepromImageToYsf,
  ysfToEepromImage,
} from '../src/core/eepromCodec';
import { decryptRadioPassword, encryptRadioPassword } from '../src/core/passwordCipher';
import {
  buildHidOutputReports,
  computeHidOnesComplementChecksum,
  PROG81LS_HANDSHAKE,
} from '../src/core/hidProtocol';
import {
  BOOT_LOGO_HEIGHT,
  BOOT_LOGO_PAYLOAD_SIZE,
  BOOT_LOGO_WIDTH,
  decodeBootLogoPayloadToRgba,
  encodeRgbaToBootLogoPayload,
} from '../src/core/bmpLogoCodec';
import { createDefaultCodeplug, createEmptyChannel, decodeYsfBuffer, encodeYsfBuffer } from '../src/core/ysfCodec';
import { EEPROM_IMAGE_SIZE } from '../src/core/constants';

describe('EEPROM Address Formula, Marshaling & Password Cipher', () => {
  it('computes exact banked EEPROM addresses for channels 1..500 (sub_4280E0)', () => {
    // Channel 1: sector 0, slot 1 -> 0x1000 + 34 = 0x1022
    expect(computeChannelEepromAddress(1)).toBe(0x1022);
    // Channel 31: sector 0, slot 31 -> 0x1000 + 31*34 = 0x1000 + 1054 = 0x141E
    expect(computeChannelEepromAddress(31)).toBe(0x141e);
    // Channel 32: sector 1, slot 0 -> 0x2000
    expect(computeChannelEepromAddress(32)).toBe(0x2000);
    // Channel 500: 500 = 15 * 32 + 20 -> sector 15 (0x10000), slot 20 (20*34 = 680 = 0x2A8) -> 0x102A8
    expect(computeChannelEepromAddress(500)).toBe(0x102a8);
  });

  it('encrypts and decrypts 6-digit programming passwords across all 10 permutation rows', () => {
    const testPasswords = [
      '000000', // sum % 10 = 0
      '100000', // sum % 10 = 1
      '110000', // sum % 10 = 2
      '123458', // sum = 23 -> 3
      '123459', // sum = 24 -> 4
      '500000', // sum % 10 = 5
      '123000', // sum % 10 = 6
      '700000', // sum % 10 = 7
      '800000', // sum % 10 = 8
      '900000', // sum % 10 = 9
    ];

    for (const pwd of testPasswords) {
      const cipher16 = encryptRadioPassword(pwd);
      expect(cipher16.byteLength).toBe(16);
      expect(decryptRadioPassword(cipher16)).toBe(pwd);
    }

    // Empty / unlocked password produces 16 bytes of 0xFF and decrypts to ""
    const unlocked = encryptRadioPassword('');
    expect(Array.from(unlocked).every((b) => b === 0xff)).toBe(true);
    expect(decryptRadioPassword(unlocked)).toBe('');
  });

  it('round-trips .Ysf -> EEPROM Image -> .Ysf including Channels, VFOs, Hotkeys, and Password', () => {
    const cp = createDefaultCodeplug();
    const ch10 = createEmptyChannel(10);
    ch10.used = true;
    ch10.name = 'DENVER - W0CRA';
    ch10.rxFreqHz = 147225000;
    ch10.txFreqHz = 147825000;
    ch10.txToneType = 'CTCSS';
    ch10.txToneValue = 107.2;
    cp.channels[9] = ch10;

    cp.hotkeys.key1Short = 0x04; // Reverse Frequency
    cp.hotkeys.key2Short = 0x02; // Monitor
    cp.general.passwordEnabled = true;
    cp.general.password = '654321';

    const ysfBytes = encodeYsfBuffer(cp);
    const eeprom = ysfToEepromImage(ysfBytes);

    // Verify EEPROM hotkey bytes at 0x120C5..0x120CA
    expect(eeprom[0x120c5]).toBe(0x04);
    expect(eeprom[0x120c7]).toBe(0x02);

    const recoveredYsf = eepromImageToYsf(eeprom, ysfBytes);
    const recoveredCp = decodeYsfBuffer(recoveredYsf);

    expect(recoveredCp.channels[9].used).toBe(true);
    expect(recoveredCp.channels[9].name).toBe('DENVER - W0CRA');
    expect(recoveredCp.channels[9].rxFreqHz).toBe(147225000);
    expect(recoveredCp.channels[9].txToneValue).toBe(107.2);
    expect(recoveredCp.hotkeys.key1Short).toBe(0x04);
    expect(recoveredCp.hotkeys.key2Short).toBe(0x02);
    expect(recoveredCp.general.passwordEnabled).toBe(true);
    expect(recoveredCp.general.password).toBe('654321');
  });

  it('reads band limits back from EEPROM 0x12006 so a read -> write keeps the radio limits', () => {
    // Radio unlocked to UHF 400-520 MHz; the editor still holds the 400-480 default.
    const eeprom = new Uint8Array(EEPROM_IMAGE_SIZE).fill(0xff);
    const view = new DataView(eeprom.buffer);
    view.setUint32(0x12006, 13600000, true); // VHF min 136.00000 MHz (10 Hz units)
    view.setUint32(0x1200a, 17400000, true); // VHF max 174.00000 MHz
    view.setUint32(0x1200e, 40000000, true); // UHF min 400.00000 MHz
    view.setUint32(0x12012, 52000000, true); // UHF max 520.00000 MHz

    const readCp = decodeYsfBuffer(eepromImageToYsf(eeprom, encodeYsfBuffer(createDefaultCodeplug())));
    expect(readCp.bandLimits).toEqual({ uhfMinMhz: 400, uhfMaxMhz: 520, vhfMinMhz: 136, vhfMaxMhz: 174 });

    const writtenBack = new DataView(ysfToEepromImage(encodeYsfBuffer(readCp)).buffer);
    expect(writtenBack.getUint32(0x12012, true)).toBe(52000000);

    // Unprogrammed limits (0xFFFFFFFF) fall back to the template instead of a bogus value.
    const blank = decodeYsfBuffer(eepromImageToYsf(new Uint8Array(EEPROM_IMAGE_SIZE).fill(0xff)));
    expect(blank.bandLimits.uhfMaxMhz).toBe(480);
  });

  it('frames single and multi-report (' + "'M'" + ') USB HID packets with ones-complement checksum', () => {
    const handshakeReports = buildHidOutputReports(PROG81LS_HANDSHAKE);
    expect(handshakeReports.length).toBe(1);
    expect(handshakeReports[0].byteLength).toBe(64);
    expect(handshakeReports[0][0]).toBe(8);
    expect(handshakeReports[0][9]).toBe(computeHidOnesComplementChecksum(PROG81LS_HANDSHAKE));

    // 140-byte write command should fragment into two 61-byte 'M' reports + 1 final report
    const largePayload = new Uint8Array(140).fill(0x55);
    const multiReports = buildHidOutputReports(largePayload);
    expect(multiReports.length).toBe(3);
    expect(multiReports[0][0]).toBe(0x3f);
    expect(multiReports[0][1]).toBe(0x4d); // 'M'
    expect(multiReports[1][0]).toBe(0x3f);
    expect(multiReports[1][1]).toBe(0x4d); // 'M'
    expect(multiReports[2][0]).toBe(18); // 140 - 122 = 18 remainder bytes
  });

  it('encodes and decodes 160x128 Big-Endian RGB565 Boot Logo payloads (40,964 bytes)', () => {
    const rgba = new Uint8ClampedArray(BOOT_LOGO_WIDTH * BOOT_LOGO_HEIGHT * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 248; // Red
      rgba[i + 1] = 252; // Green
      rgba[i + 2] = 248; // Blue
      rgba[i + 3] = 255;
    }

    const payload = encodeRgbaToBootLogoPayload(rgba);
    expect(payload.byteLength).toBe(BOOT_LOGO_PAYLOAD_SIZE);
    // Header: Height=128 (0x00, 0x80), Width=160 (0x00, 0xA0)
    expect(Array.from(payload.subarray(0, 4))).toEqual([0x00, 0x80, 0x00, 0xa0]);

    const decoded = decodeBootLogoPayloadToRgba(payload);
    expect(decoded.width).toBe(160);
    expect(decoded.height).toBe(128);
    expect(decoded.rgba[0]).toBeGreaterThanOrEqual(248);
  });
});
