/**
 * @file tests/hidTransport.test.ts
 * @description USB HID input-report decoding (`src/core/hidProtocol.ts`) and the WebHID read
 * path (`src/core/webHidTransport.ts`) against an in-memory fake radio.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EEPROM_READ_SEGMENTS, buildHidOutputReports, decodeHidInputReport } from '../src/core/hidProtocol';
import { readRadioViaWebHid } from '../src/core/webHidTransport';
import { FakeHidRadio, installFakeRadio } from './helpers/fakeHidRadio';

let restoreNavigator: (() => void) | null = null;

afterEach(() => {
  restoreNavigator?.();
  restoreNavigator = null;
});

const fillPattern = (radio: FakeHidRadio) => {
  for (let a = 0; a < radio.memory.length; a++) {
    radio.memory[a] = (a * 7 + 3) & 0xff;
  }
};

describe('USB HID input report decoding', () => {
  it('is the exact inverse of buildHidOutputReports for single and multi-report payloads', () => {
    for (const len of [1, 8, 61, 62, 63, 133, 141, 200]) {
      const payload = Uint8Array.from({ length: len }, (_, i) => (i * 13 + len) & 0xff);
      const decoded = buildHidOutputReports(payload).flatMap((rpt) => [...decodeHidInputReport(rpt)]);
      expect(decoded).toEqual([...payload]);
    }
  });

  it('rejects reports whose checksum does not match', () => {
    const [single] = buildHidOutputReports(Uint8Array.of(0x06));
    single[2] ^= 0xff;
    expect(() => decodeHidInputReport(single)).toThrow(/checksum/);

    const [continuation] = buildHidOutputReports(new Uint8Array(100).fill(0x42));
    continuation[10] ^= 0x01;
    expect(() => decodeHidInputReport(continuation)).toThrow(/checksum/);
  });
});

describe('readRadioViaWebHid', () => {
  it('reads multi-report blocks byte-for-byte', async () => {
    const radio = new FakeHidRadio();
    fillPattern(radio);
    restoreNavigator = installFakeRadio(radio);

    const { eeprom } = await readRadioViaWebHid({ includeCalibration: false });

    for (const seg of EEPROM_READ_SEGMENTS) {
      expect(eeprom.subarray(seg.startAddress, seg.endAddressInclusive + 1)).toEqual(
        radio.memory.subarray(seg.startAddress, seg.endAddressInclusive + 1)
      );
    }
    // Channel 1's record lives in the first sector at 0x1000 + 34.
    expect(eeprom.subarray(0x1022, 0x1044)).toEqual(radio.memory.subarray(0x1022, 0x1044));
    expect(radio.commands.at(-1)?.op).toBe('end');
  });

  it('rejects a read reply that echoes a different address', async () => {
    const radio = new FakeHidRadio({ echoAddressOverride: 0x000100 });
    restoreNavigator = installFakeRadio(radio);

    await expect(readRadioViaWebHid({ includeCalibration: false })).rejects.toThrow(/echo mismatch/);
  });
});
