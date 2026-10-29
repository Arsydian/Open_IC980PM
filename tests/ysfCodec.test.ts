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

const contactSlot = (buf: Uint8Array, i: number) => {
  const off = YSF_OFFSETS.DTMF_ENTRIES_START + (15 + i) * 17;
  return { text: new TextDecoder().decode(buf.subarray(off, off + 16)).replace(/\0+$/, ''), len: buf[off + 16] };
};

describe('DTMF address book contacts', () => {
  it('keeps empty contact slots empty instead of writing "Contact:"', () => {
    const cp = createDefaultCodeplug();
    expect(cp.dtmf.contacts.every((c) => c.name === '' && c.code === '')).toBe(true);

    const ysf = encodeYsfBuffer(cp);
    for (let i = 0; i < 15; i++) {
      expect(contactSlot(ysf, i)).toEqual({ text: '', len: 0 });
    }
  });

  it('stores names and codes up to the 16-byte slot without cutting them to 7/8 characters', () => {
    const cp = createDefaultCodeplug();
    cp.dtmf.contacts[0] = { index: 1, name: 'BASE', code: '1234567890' }; // 4 + 1 + 10 = 15 bytes
    cp.dtmf.contacts[1] = { index: 2, name: '', code: '0123456789ABCD*#' }; // unnamed: full 16
    cp.dtmf.contacts[2] = { index: 3, name: 'A:B', code: '42' }; // ':' would split the slot

    const ysf = encodeYsfBuffer(cp);
    expect(contactSlot(ysf, 0)).toEqual({ text: 'BASE:1234567890', len: 15 });
    expect(contactSlot(ysf, 1)).toEqual({ text: '0123456789ABCD*#', len: 16 });

    const back = decodeYsfBuffer(ysf).dtmf.contacts;
    expect(back[0]).toMatchObject({ name: 'BASE', code: '1234567890' });
    expect(back[1]).toMatchObject({ name: '', code: '0123456789ABCD*#' });
    expect(back[2]).toMatchObject({ name: 'AB', code: '42' });
  });

  it('re-encodes an unnamed code from another program byte-for-byte', () => {
    const buf = encodeYsfBuffer(createDefaultCodeplug());
    const off = YSF_OFFSETS.DTMF_ENTRIES_START + 15 * 17;
    buf.set(new TextEncoder().encode('555123'), off);
    buf[off + 16] = 6;

    const again = encodeYsfBuffer(decodeYsfBuffer(buf));
    expect(contactSlot(again, 0)).toEqual({ text: '555123', len: 6 });
  });
});

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

describe('channel used bitmask', () => {
  const withTwoChannels = () => {
    const cp = createDefaultCodeplug();
    for (const i of [0, 1]) {
      Object.assign(cp.channels[i], { used: true, rxFreqHz: 146_520_000 + i * 30_000, txFreqHz: 146_520_000 + i * 30_000, name: `C${i + 1}` });
    }
    return encodeYsfBuffer(cp);
  };

  it('keeps a deleted channel deleted when its old bytes remain in the slot', () => {
    const buf = withTwoChannels();
    // Another program deleted channel 2 by clearing only its used bit.
    buf[YSF_OFFSETS.CHANNEL_USED_BITMASK] &= ~(1 << 2);

    const cp = decodeYsfBuffer(buf);
    expect(cp.channels[0].used).toBe(true);
    expect(cp.channels[1].used).toBe(false);
  });

  it('falls back to valid frequencies when a file has no bitmask at all', () => {
    const buf = withTwoChannels();
    buf.fill(0, YSF_OFFSETS.CHANNEL_USED_BITMASK, YSF_OFFSETS.CHANNEL_USED_BITMASK + 63);

    const cp = decodeYsfBuffer(buf);
    expect(cp.channels.slice(0, 3).map((c) => c.used)).toEqual([true, true, false]);
  });
});
