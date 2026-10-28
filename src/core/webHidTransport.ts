/**
 * @file src/core/webHidTransport.ts
 * @description Browser WebHID (`navigator.hid`) driver for the HIROYASU IC-980 Pro Max
 * ("ASER _HID" / "ASER-471"). Enables direct USB OTG / USB HID programming from Chromium
 * browsers on Windows, macOS, Linux, and Android without requiring native drivers.
 */

import type { HidProgressEvent } from '../types/global';
import { EEPROM_IMAGE_SIZE, RF_CALIBRATION_SIZE } from './constants';
import {
  EEPROM_READ_SEGMENTS,
  HID_CMD_ACK,
  HID_CMD_END,
  HID_CMD_STX,
  PROG81LS_HANDSHAKE,
  buildHidOutputReports,
  buildReadMemoryCommand,
  buildWriteMemoryCommand,
  decodeHidInputReport,
  getChannelSectorAddresses,
} from './hidProtocol';
import { decryptRadioPassword } from './passwordCipher';

interface WebHidDeviceLike {
  opened: boolean;
  productName?: string;
  vendorId: number;
  productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(
    type: 'inputreport',
    listener: (ev: { reportId: number; data: DataView }) => void
  ): void;
  removeEventListener(
    type: 'inputreport',
    listener: (ev: { reportId: number; data: DataView }) => void
  ): void;
}

/**
 * Checks whether the current browser environment supports the WebHID API (`navigator.hid`).
 */
export function isWebHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

/**
 * Requests a HIROYASU IC-980 Pro Max ("ASER-471") USB HID device via the browser WebHID picker.
 */
export async function requestWebHidDevice(): Promise<WebHidDeviceLike> {
  if (!isWebHidSupported()) {
    throw new Error('WebHID is not supported in this browser. Use Desktop App or Chrome/Edge.');
  }
  const navHid = (navigator as unknown as { hid: { requestDevice(opts: { filters: unknown[] }): Promise<WebHidDeviceLike[]> } }).hid;
  const devices = await navHid.requestDevice({ filters: [] });
  if (!devices || devices.length === 0) {
    throw new Error('No USB HID radio device was selected.');
  }
  return devices[0];
}

/**
 * Sends a command payload over WebHID and collects `expectedResponseBytes` from input reports.
 */
async function sendWebHidCmdGetResp(
  device: WebHidDeviceLike,
  cmdPayload: Uint8Array,
  expectedResponseBytes: number,
  timeoutMs: number = 3500
): Promise<Uint8Array> {
  const reports = buildHidOutputReports(cmdPayload);
  const collected: number[] = [];

  return new Promise<Uint8Array>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      device.removeEventListener('inputreport', onReport);
    };

    const onReport = (ev: { reportId: number; data: DataView }) => {
      const bytes = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
      if (bytes.length === 0) return;

      let payload: Uint8Array;
      try {
        payload = decodeHidInputReport(bytes);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      for (const b of payload) {
        collected.push(b);
      }

      if (collected.length >= expectedResponseBytes) {
        cleanup();
        resolve(new Uint8Array(collected.slice(0, expectedResponseBytes)));
      }
    };

    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `USB HID timeout waiting for ${expectedResponseBytes} bytes (received ${collected.length} bytes). Ensure the radio is powered on and programming cable is firmly seated.`
        )
      );
    }, timeoutMs);

    device.addEventListener('inputreport', onReport);

    (async () => {
      try {
        for (const rpt of reports) {
          await device.sendReport(0x00, rpt as unknown as BufferSource);
        }
        if (expectedResponseBytes === 0) {
          cleanup();
          resolve(new Uint8Array(0));
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    })();
  });
}

/**
 * Performs the `PROG81LS` handshake sequence (`0x0042A73C`).
 */
async function performHandshake(
  device: WebHidDeviceLike,
  onProgress?: (ev: HidProgressEvent) => void
): Promise<void> {
  onProgress?.({
    phase: 'handshake',
    currentAddress: 0,
    totalBytes: 100,
    bytesTransferred: 5,
    percent: 5,
    message: 'Sending PROG81LS handshake to ASER-471...',
  });

  const ack1 = await sendWebHidCmdGetResp(device, PROG81LS_HANDSHAKE, 1);
  if (ack1[0] !== 0x06) {
    throw new Error(`Unexpected PROG81LS handshake response: 0x${ack1[0]?.toString(16)}`);
  }

  await sendWebHidCmdGetResp(device, HID_CMD_STX, 8);
  const ack2 = await sendWebHidCmdGetResp(device, HID_CMD_ACK, 1);
  if (ack2[0] !== 0x06) {
    throw new Error(`Unexpected programming mode ACK: 0x${ack2[0]?.toString(16)}`);
  }
}

/**
 * Reads a contiguous memory range in chunks using `'R'` (`0x52`).
 */
async function readMemoryRange(
  device: WebHidDeviceLike,
  targetBuffer: Uint8Array,
  startAddr: number,
  byteLength: number,
  maxChunkSize: number = 200
): Promise<void> {
  let offset = 0;
  while (offset < byteLength) {
    const chunkLen = Math.min(maxChunkSize, byteLength - offset);
    const addr = startAddr + offset;
    const cmd = buildReadMemoryCommand(addr, chunkLen);
    const resp = await sendWebHidCmdGetResp(device, cmd, 5 + chunkLen);
    if (resp[0] !== 0x57) {
      throw new Error(`Invalid Read block response header at 0x${addr.toString(16)}: 0x${resp[0]?.toString(16)}`);
    }
    // The radio echoes 'W' + address + length; reject a block meant for a different address.
    const echoAddr = (resp[1] << 16) | (resp[2] << 8) | resp[3];
    if (echoAddr !== addr || resp[4] !== chunkLen) {
      throw new Error(
        `Read block echo mismatch: requested 0x${addr.toString(16)} (${chunkLen} bytes), radio answered 0x${echoAddr.toString(16)} (${resp[4]} bytes)`
      );
    }
    targetBuffer.set(resp.subarray(5, 5 + chunkLen), addr);
    await sendWebHidCmdGetResp(device, HID_CMD_ACK, 1);
    offset += chunkLen;
  }
}

/**
 * Reads the complete EEPROM image (`0x00000..0x18306`) from the radio via WebHID.
 */
export async function readRadioViaWebHid(
  options: { includeCalibration?: boolean; password?: string },
  onProgress?: (ev: HidProgressEvent) => void
): Promise<{ eeprom: Uint8Array; calibration?: Uint8Array }> {
  const device = await requestWebHidDevice();
  if (!device.opened) {
    await device.open();
  }

  try {
    await performHandshake(device, onProgress);

    const eeprom = new Uint8Array(EEPROM_IMAGE_SIZE);
    eeprom.fill(0xff);

    // 1. Check password at 0x16000 (16 bytes)
    onProgress?.({
      phase: 'password',
      currentAddress: 0x16000,
      totalBytes: 100,
      bytesTransferred: 10,
      percent: 10,
      message: 'Verifying radio programming password at 0x16000...',
    });
    await readMemoryRange(device, eeprom, 0x16000, 16, 16);
    const radioPassword = decryptRadioPassword(eeprom.subarray(0x16000, 0x16010));
    if (radioPassword && radioPassword !== (options.password || '').trim()) {
      throw new Error('Radio is password-protected. Please enter the 6-digit programming password.');
    }

    // 2. Read fixed segments (Bitmask, VFO, General, DTMF)
    let stepIdx = 0;
    const sectors = getChannelSectorAddresses();
    const totalSteps = EEPROM_READ_SEGMENTS.length + sectors.length + (options.includeCalibration ? 1 : 0);

    for (const seg of EEPROM_READ_SEGMENTS) {
      const len = seg.endAddressInclusive - seg.startAddress + 1;
      stepIdx++;
      onProgress?.({
        phase: 'reading',
        currentAddress: seg.startAddress,
        totalBytes: totalSteps,
        bytesTransferred: stepIdx,
        percent: Math.round((stepIdx / totalSteps) * 90),
        message: `Reading ${seg.label} (0x${seg.startAddress.toString(16).toUpperCase()})...`,
      });
      await readMemoryRange(device, eeprom, seg.startAddress, len, 128);
    }

    // 3. Read 16 Channel Sectors (0x01000..0x1043F)
    for (const sec of sectors) {
      stepIdx++;
      onProgress?.({
        phase: 'reading',
        currentAddress: sec.baseAddress,
        totalBytes: totalSteps,
        bytesTransferred: stepIdx,
        percent: Math.round((stepIdx / totalSteps) * 95),
        message: `Reading Channel Sector ${sec.sectorIndex + 1}/16 (0x${sec.baseAddress.toString(16).toUpperCase()})...`,
      });
      await readMemoryRange(device, eeprom, sec.baseAddress, sec.byteLength, 136);
    }

    // 4. Optional RF Calibration read (0x18000..0x18306)
    let calibration: Uint8Array | undefined;
    if (options.includeCalibration) {
      onProgress?.({
        phase: 'calibration',
        currentAddress: 0x18000,
        totalBytes: totalSteps,
        bytesTransferred: totalSteps,
        percent: 98,
        message: 'Reading RF Calibration block (0x18000..0x18306)...',
      });
      await readMemoryRange(device, eeprom, 0x18000, RF_CALIBRATION_SIZE, 128);
      calibration = eeprom.subarray(0x18000, 0x18000 + RF_CALIBRATION_SIZE).slice();
    }

    // 5. Exit programming mode
    await sendWebHidCmdGetResp(device, HID_CMD_END, 0);
    onProgress?.({
      phase: 'complete',
      currentAddress: 0x18306,
      totalBytes: 100,
      bytesTransferred: 100,
      percent: 100,
      message: 'Radio EEPROM read complete.',
    });

    return { eeprom, calibration };
  } finally {
    await device.close();
  }
}

/**
 * Writes an EEPROM image (`0x00000..0x1600F`) to the radio via WebHID.
 */
export async function writeRadioViaWebHid(
  eeprom: Uint8Array,
  onProgress?: (ev: HidProgressEvent) => void
): Promise<void> {
  const device = await requestWebHidDevice();
  if (!device.opened) {
    await device.open();
  }

  const writeRange = async (startAddr: number, length: number, maxChunk: number = 128) => {
    let offset = 0;
    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const addr = startAddr + offset;
      const slice = eeprom.subarray(addr, addr + chunkLen);
      const cmd = buildWriteMemoryCommand(addr, slice);
      const ack = await sendWebHidCmdGetResp(device, cmd, 1);
      if (ack[0] !== 0x06) {
        throw new Error(`Write rejected at 0x${addr.toString(16)}: 0x${ack[0]?.toString(16)}`);
      }
      offset += chunkLen;
    }
  };

  try {
    await performHandshake(device, onProgress);

    const sectors = getChannelSectorAddresses();
    const totalSteps = EEPROM_READ_SEGMENTS.length + sectors.length + 1;
    let stepIdx = 0;

    for (const seg of EEPROM_READ_SEGMENTS) {
      const len = seg.endAddressInclusive - seg.startAddress + 1;
      stepIdx++;
      onProgress?.({
        phase: 'writing',
        currentAddress: seg.startAddress,
        totalBytes: totalSteps,
        bytesTransferred: stepIdx,
        percent: Math.round((stepIdx / totalSteps) * 90),
        message: `Writing ${seg.label} (0x${seg.startAddress.toString(16).toUpperCase()})...`,
      });
      await writeRange(seg.startAddress, len, 128);
    }

    for (const sec of sectors) {
      stepIdx++;
      onProgress?.({
        phase: 'writing',
        currentAddress: sec.baseAddress,
        totalBytes: totalSteps,
        bytesTransferred: stepIdx,
        percent: Math.round((stepIdx / totalSteps) * 95),
        message: `Writing Channel Sector ${sec.sectorIndex + 1}/16 (0x${sec.baseAddress.toString(16).toUpperCase()})...`,
      });
      await writeRange(sec.baseAddress, sec.byteLength, 136);
    }

    // Write password block at 0x16000..0x1600F
    await writeRange(0x16000, 16, 16);

    await sendWebHidCmdGetResp(device, HID_CMD_END, 0);
    onProgress?.({
      phase: 'complete',
      currentAddress: 0x1600f,
      totalBytes: 100,
      bytesTransferred: 100,
      percent: 100,
      message: 'Radio EEPROM write complete! Radio is rebooting.',
    });
  } finally {
    await device.close();
  }
}

/**
 * Flashes a 40,964-byte Big-Endian RGB565 Boot Logo payload to EEPROM `0x1B000` via WebHID.
 */
export async function flashBootLogoViaWebHid(
  logoPayload: Uint8Array,
  onProgress?: (ev: HidProgressEvent) => void
): Promise<void> {
  const device = await requestWebHidDevice();
  if (!device.opened) {
    await device.open();
  }

  try {
    await performHandshake(device, onProgress);

    const startAddr = 0x1b000;
    const total = logoPayload.byteLength;
    let offset = 0;
    const chunkSize = 160;

    while (offset < total) {
      const len = Math.min(chunkSize, total - offset);
      const addr = startAddr + offset;
      const cmd = buildWriteMemoryCommand(addr, logoPayload.subarray(offset, offset + len));
      const ack = await sendWebHidCmdGetResp(device, cmd, 1);
      if (ack[0] !== 0x06) {
        throw new Error(`Boot logo flash failed at 0x${addr.toString(16)}`);
      }
      offset += len;
      onProgress?.({
        phase: 'logo',
        currentAddress: addr,
        totalBytes: total,
        bytesTransferred: offset,
        percent: Math.round((offset / total) * 100),
        message: `Flashing Boot Logo to 0x1B000 (${Math.round((offset / total) * 100)}%)...`,
      });
    }

    await sendWebHidCmdGetResp(device, HID_CMD_END, 0);
    onProgress?.({
      phase: 'complete',
      currentAddress: startAddr + total,
      totalBytes: total,
      bytesTransferred: total,
      percent: 100,
      message: 'Custom Boot Logo flashed to 0x1B000!',
    });
  } finally {
    await device.close();
  }
}
