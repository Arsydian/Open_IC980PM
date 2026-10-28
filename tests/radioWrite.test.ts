/**
 * @file tests/radioWrite.test.ts
 * @description WebHID write path (`src/core/webHidTransport.ts`) and Rollback Vault snapshots
 * (`src/core/backupBundle.ts`) against an in-memory fake radio.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  base64ToUint8Array,
  createSnapshotFromRadioImage,
  saveSnapshotToVault,
} from '../src/core/backupBundle';
import { computeChannelEepromAddress, ysfToEepromImage } from '../src/core/eepromCodec';
import { createDefaultCodeplug, decodeYsfBuffer, encodeYsfBuffer } from '../src/core/ysfCodec';
import { flashBootLogoViaWebHid, readRadioViaWebHid, writeRadioViaWebHid } from '../src/core/webHidTransport';
import type { RollbackSnapshot } from '../src/types/radio';
import { FakeHidRadio, installFakeRadio } from './helpers/fakeHidRadio';

let restoreGlobals: Array<() => void> = [];

afterEach(() => {
  for (const restore of restoreGlobals) restore();
  restoreGlobals = [];
});

/** Programs channel 1 directly into the fake radio's memory. */
function programRadioChannel1(radio: FakeHidRadio, rxHz: number, name: string): void {
  radio.memory.fill(0x00, 0x000000, 0x00003f);
  radio.memory[0] = 0x02; // bitmask bit for channel 1
  const addr = computeChannelEepromAddress(1);
  radio.memory.fill(0x00, addr, addr + 34);
  const view = new DataView(radio.memory.buffer);
  view.setUint32(addr + 0x00, rxHz, true);
  view.setUint32(addr + 0x04, rxHz, true);
  radio.memory[addr + 0x0c] = 0x03; // scan add + used marker
  radio.memory.set(new TextEncoder().encode(name), addr + 0x12);
}

function editorCodeplugWithChannel1(rxHz: number, name: string) {
  const cp = createDefaultCodeplug();
  Object.assign(cp.channels[0], { used: true, rxFreqHz: rxHz, txFreqHz: rxHz, name });
  return cp;
}

describe('writeRadioViaWebHid', () => {
  it('snapshots what is on the radio, not the codeplug being written, before any write', async () => {
    const radio = new FakeHidRadio();
    programRadioChannel1(radio, 145_230_000, 'ON RADIO');
    restoreGlobals.push(installFakeRadio(radio));
    const editor = editorCodeplugWithChannel1(146_520_000, 'IN EDITOR');

    let snapshot: RollbackSnapshot | undefined;
    let writesBeforePrepare = -1;
    await writeRadioViaWebHid((currentRadioImage) => {
      writesBeforePrepare = radio.writtenAddresses().length;
      snapshot = createSnapshotFromRadioImage(currentRadioImage);
      return ysfToEepromImage(encodeYsfBuffer(editor));
    });

    expect(writesBeforePrepare).toBe(0);
    const backedUp = decodeYsfBuffer(base64ToUint8Array(snapshot!.ysfBase64));
    expect(backedUp.channels[0].name).toBe('ON RADIO');
    expect(backedUp.channels[0].rxFreqHz).toBe(145_230_000);

    // The new codeplug did reach the radio afterwards.
    const addr = computeChannelEepromAddress(1);
    expect(new DataView(radio.memory.buffer).getUint32(addr, true)).toBe(146_520_000);
  });

  it('writes nothing and leaves programming mode when the pre-write backup fails', async () => {
    const radio = new FakeHidRadio();
    restoreGlobals.push(installFakeRadio(radio));

    await expect(
      writeRadioViaWebHid(() => {
        throw new Error('vault full');
      })
    ).rejects.toThrow('vault full');

    expect(radio.writtenAddresses()).toEqual([]);
    expect(radio.commands.at(-1)?.op).toBe('end');
  });
});

describe('leaving programming mode after a failure', () => {
  const lastCommand = (radio: FakeHidRadio) => radio.commands.at(-1)?.op;

  it('sends E when a read fails part-way', async () => {
    const radio = new FakeHidRadio({ echoAddressOverride: 0x000100 });
    restoreGlobals.push(installFakeRadio(radio));
    await expect(readRadioViaWebHid({ includeCalibration: false })).rejects.toThrow(/echo mismatch/);
    expect(lastCommand(radio)).toBe('end');
  });

  it('sends E when the radio rejects a write block', async () => {
    const radio = new FakeHidRadio({ nakWriteAt: 0x2000 });
    restoreGlobals.push(installFakeRadio(radio));
    await expect(
      writeRadioViaWebHid((current) => ysfToEepromImage(encodeYsfBuffer(createDefaultCodeplug()), current))
    ).rejects.toThrow(/Write rejected at 0x2000/);
    expect(lastCommand(radio)).toBe('end');
  });

  it('sends E when a boot-logo flash fails', async () => {
    const radio = new FakeHidRadio({ nakWriteAt: 0x1b000 });
    restoreGlobals.push(installFakeRadio(radio));
    await expect(flashBootLogoViaWebHid(new Uint8Array(400))).rejects.toThrow(/Boot logo flash failed/);
    expect(lastCommand(radio)).toBe('end');
  });
});

describe('saveSnapshotToVault', () => {
  it('throws instead of reporting success when browser storage rejects the snapshot', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    restoreGlobals.push(() => {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    const snap = createSnapshotFromRadioImage(ysfToEepromImage(encodeYsfBuffer(createDefaultCodeplug())));
    await expect(saveSnapshotToVault(snap)).rejects.toThrow(/Could not save snapshot/);
  });
});
