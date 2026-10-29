/**
 * @file tests/hidTransport.test.ts
 * @description USB HID input-report decoding (`src/core/hidProtocol.ts`) and the WebHID read
 * path (`src/core/webHidTransport.ts`) against an in-memory fake radio.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EEPROM_READ_SEGMENTS, buildHidOutputReports, decodeHidInputReport } from '../src/core/hidProtocol';
import {
  flashBootLogoViaWebHid,
  getActiveRadioOperation,
  readRadioViaWebHid,
  writeRadioViaWebHid,
} from '../src/core/webHidTransport';
import { EEPROM_IMAGE_SIZE } from '../src/core/constants';
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

  it('refuses a second radio operation while one is still running', async () => {
    const radio = new FakeHidRadio();
    restoreNavigator = installFakeRadio(radio);

    const reading = readRadioViaWebHid({ includeCalibration: false });
    expect(getActiveRadioOperation()).toBe('Read Radio');
    await expect(writeRadioViaWebHid(() => new Uint8Array(EEPROM_IMAGE_SIZE))).rejects.toThrow(
      /Another radio operation \(Read Radio\) is still running/
    );
    await expect(flashBootLogoViaWebHid(new Uint8Array(4))).rejects.toThrow(/Another radio operation/);

    await reading;
    expect(radio.writtenAddresses()).toEqual([]);
    expect(radio.commands.filter((c) => c.op === 'handshake')).toHaveLength(1);
    expect(getActiveRadioOperation()).toBeNull();
  });

  it('releases the radio after a failed operation', async () => {
    restoreNavigator = installFakeRadio(new FakeHidRadio({ echoAddressOverride: 0x000100 }));
    await expect(readRadioViaWebHid({ includeCalibration: false })).rejects.toThrow();
    restoreNavigator();

    restoreNavigator = installFakeRadio(new FakeHidRadio());
    await expect(readRadioViaWebHid({ includeCalibration: false })).resolves.toBeDefined();
  });

  it('reuses a radio the page was already granted instead of opening the picker', async () => {
    const radio = new FakeHidRadio();
    restoreNavigator = installFakeRadio(radio, { granted: true });
    await readRadioViaWebHid({ includeCalibration: false });
    await readRadioViaWebHid({ includeCalibration: false });
    expect(radio.pickerOpened).toBe(0);
  });

  it('opens the picker only when no radio has been granted yet', async () => {
    const radio = new FakeHidRadio();
    restoreNavigator = installFakeRadio(radio);
    await readRadioViaWebHid({ includeCalibration: false });
    expect(radio.pickerOpened).toBe(1);
  });

  it('refuses a picked device that is not the radio, before sending anything', async () => {
    const keyboard = new FakeHidRadio({ productName: 'USB Keyboard' });
    restoreNavigator = installFakeRadio(keyboard);
    await expect(readRadioViaWebHid({ includeCalibration: false })).rejects.toThrow(
      '"USB Keyboard" is not the IC-980 Pro Max programming cable. Choose the device named "ASER-471".'
    );
    expect(keyboard.commands).toEqual([]);
  });

  it('rejects a read reply that echoes a different address', async () => {
    const radio = new FakeHidRadio({ echoAddressOverride: 0x000100 });
    restoreNavigator = installFakeRadio(radio);

    await expect(readRadioViaWebHid({ includeCalibration: false })).rejects.toThrow(/echo mismatch/);
  });
});
