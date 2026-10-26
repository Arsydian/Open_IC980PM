/**
 * @file tests/ysfCodec.test.ts
 * @description Unit tests for the 47,046-byte `.Ysf` binary encoder and decoder (`src/core/ysfCodec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { YSF_FILE_SIZE, YSF_OFFSETS } from '../src/core/constants';
import {
  createDefaultCodeplug,
  createEmptyChannel,
  decodeYsfBuffer,
  encodeYsfBuffer,
  isChannelBitSet,
} from '../src/core/ysfCodec';

describe('ysfCodec (47,046-byte .Ysf binary format)', () => {
  it('initializes a clean factory-default codeplug with 0 placeholder channels and Unassigned hotkeys', () => {
    const cp = createDefaultCodeplug();
    expect(cp.rawYsfBuffer.byteLength).toBe(YSF_FILE_SIZE);

    const activeChannels = cp.channels.filter((c) => c.used);
    expect(activeChannels.length).toBe(0);

    // Verify all 6 handset hotkeys start Unassigned (0x00) per User Requirement #4
    expect(cp.hotkeys).toEqual({
      key1Short: 0x00,
      key1Long: 0x00,
      key2Short: 0x00,
      key2Long: 0x00,
      key3Short: 0x00,
      key3Long: 0x00,
    });

    // Verify VFO A & VFO B clean defaults
    expect(cp.vfoA.rxFreqHz).toBe(146520000);
    expect(cp.vfoB.rxFreqHz).toBe(446000000);
  });

  it('losslessly encodes and decodes channels with CTCSS, DCS, 8-digit Custom Subaudio, NOAA flag, and AM/FM', () => {
    const cp = createDefaultCodeplug();

    // Channel 1: 2m Repeater with CTCSS 114.8 Hz TX / 100.0 Hz RX
    const ch1 = createEmptyChannel(1);
    ch1.used = true;
    ch1.name = 'SF - W6PW';
    ch1.rxFreqHz = 145150000;
    ch1.txFreqHz = 144550000;
    ch1.txToneType = 'CTCSS';
    ch1.txToneValue = 114.8;
    ch1.rxToneType = 'CTCSS';
    ch1.rxToneValue = 100.0;
    ch1.power = 'High';
    ch1.bandwidth = 'Wide';
    ch1.modulation = 'FM';
    ch1.bcl = true;
    ch1.scanAdd = true;
    ch1.pttId = 'BOT';
    ch1.scramble = 3;
    cp.channels[0] = ch1;

    // Channel 25: 70cm Repeater with DCS-I 023 TX / DCS-N 155 RX
    const ch25 = createEmptyChannel(25);
    ch25.used = true;
    ch25.name = 'OAK - K6OAK';
    ch25.rxFreqHz = 444200000;
    ch25.txFreqHz = 449200000;
    ch25.txToneType = 'DCS_I';
    ch25.txToneValue = 23;
    ch25.rxToneType = 'DCS_N';
    ch25.rxToneValue = 155;
    ch25.power = 'Middle';
    ch25.bandwidth = 'Narrow';
    ch25.modulation = 'AM';
    ch25.noaaFlag = true;
    cp.channels[24] = ch25;

    // Channel 500: 8-Digit Custom Subaudio
    const ch500 = createEmptyChannel(500);
    ch500.used = true;
    ch500.name = 'CUSTOM SUB 500';
    ch500.rxFreqHz = 146520000;
    ch500.txFreqHz = 146520000;
    ch500.customSubaudioEnabled = true;
    ch500.customRxSubaudioHex = '1234ABCD';
    ch500.customTxSubaudioHex = 'CAFEBEEF';
    cp.channels[499] = ch500;

    const encoded = encodeYsfBuffer(cp);
    expect(encoded.byteLength).toBe(YSF_FILE_SIZE);
    expect(isChannelBitSet(encoded, 1)).toBe(true);
    expect(isChannelBitSet(encoded, 2)).toBe(false);
    expect(isChannelBitSet(encoded, 25)).toBe(true);
    expect(isChannelBitSet(encoded, 500)).toBe(true);

    const decoded = decodeYsfBuffer(encoded);
    expect(decoded.channels[0]).toMatchObject({
      used: true,
      name: 'SF - W6PW',
      rxFreqHz: 145150000,
      txFreqHz: 144550000,
      txToneType: 'CTCSS',
      txToneValue: 114.8,
      rxToneType: 'CTCSS',
      rxToneValue: 100.0,
      power: 'High',
      bandwidth: 'Wide',
      modulation: 'FM',
      bcl: true,
      scanAdd: true,
      pttId: 'BOT',
      scramble: 3,
    });

    expect(decoded.channels[24]).toMatchObject({
      used: true,
      name: 'OAK - K6OAK',
      rxFreqHz: 444200000,
      txFreqHz: 449200000,
      txToneType: 'DCS_I',
      txToneValue: 23,
      rxToneType: 'DCS_N',
      rxToneValue: 155,
      power: 'Middle',
      bandwidth: 'Narrow',
      modulation: 'AM',
      noaaFlag: true,
    });

    expect(decoded.channels[499]).toMatchObject({
      used: true,
      name: 'CUSTOM SUB 500',
      customSubaudioEnabled: true,
      customRxSubaudioHex: '1234ABCD',
      customTxSubaudioHex: 'CAFEBEEF',
    });
  });

  it('encodes Handset Hotkeys at 0xA88C..0xA891 and enforces Monitor Momentary mutual exclusion', () => {
    const cp = createDefaultCodeplug();

    // Assign Reverse Frequency (0x04) to Key 1 Short, Monitor (0x01) to Key 1 Long,
    // and Monitor Momentary (0x02) to Key 2 Long (which must force Key 2 Short to 0x00)
    cp.hotkeys = {
      key1Short: 0x04, // Reverse Frequency
      key1Long: 0x01,  // Monitor (Latching)
      key2Short: 0x03, // Scan (should be overridden to 0x00 because key2Long is 0x02)
      key2Long: 0x02,  // Monitor Momentary
      key3Short: 0x02, // Monitor
      key3Long: 0x0b,  // Warning light
    };

    const encoded = encodeYsfBuffer(cp);
    expect(encoded[YSF_OFFSETS.KEY1_SHORT]).toBe(0x04);
    expect(encoded[YSF_OFFSETS.KEY1_LONG]).toBe(0x01);
    expect(encoded[YSF_OFFSETS.KEY2_SHORT]).toBe(0x00); // Enforced Unassigned
    expect(encoded[YSF_OFFSETS.KEY2_LONG]).toBe(0x02);
    expect(encoded[YSF_OFFSETS.KEY3_SHORT]).toBe(0x02);
    expect(encoded[YSF_OFFSETS.KEY3_LONG]).toBe(0x0b);

    const decoded = decodeYsfBuffer(encoded);
    expect(decoded.hotkeys.key1Short).toBe(0x04);
    expect(decoded.hotkeys.key1Long).toBe(0x01);
    expect(decoded.hotkeys.key2Short).toBe(0x00);
    expect(decoded.hotkeys.key2Long).toBe(0x02);
    expect(decoded.hotkeys.key3Short).toBe(0x02);
    expect(decoded.hotkeys.key3Long).toBe(0x0b);
  });
});
