/**
 * @file src/core/hidProtocol.ts
 * @description Clean-room implementation of the HIROYASU IC-980 Pro Max ("ASER _HID" / "ASER-471")
 * USB HID 64-byte report framing, `'M'` (`0x4D`) multi-report fragmentation, one's complement
 * checksum, and `PROG81LS` read/write state machine (`SendCmd_GetResp` @ `0x00428154`,
 * `SendCommData` @ `0x0042A73C`).
 */

/** Expected USB HID Manufacturer string (`0x0041C218`). */
export const IC980_HID_VENDOR_NAME = 'ASER _HID';

/** Expected USB HID Product string (`0x0041C218`). */
export const IC980_HID_PRODUCT_NAME = 'ASER-471';

/** ASCII `PROG81LS` handshake magic (`[0x50, 0x52, 0x4F, 0x47, 0x38, 0x31, 0x4C, 0x53]`). */
export const PROG81LS_HANDSHAKE = new Uint8Array([0x50, 0x52, 0x4f, 0x47, 0x38, 0x31, 0x4c, 0x53]);

/** Single-byte commands used by `SendCommData` (`0x0042A73C`). */
export const HID_CMD_STX = new Uint8Array([0x02]);
export const HID_CMD_ACK = new Uint8Array([0x06]);
export const HID_CMD_END = new Uint8Array([0x45]); // 'E'

/**
 * Computes the one's complement 8-bit checksum used by `SendCmd_GetResp` (`0x00428154`):
 *   `checksum = (~sum(bytes)) & 0xFF`
 */
export function computeHidOnesComplementChecksum(payload: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum = (sum + payload[i]) & 0xff;
  }
  return (~sum) & 0xff;
}

/**
 * Packs an arbitrary command payload into one or more 64-byte HID Output Report bodies
 * (excluding the OS-level Report ID byte `0x00` which is prepended by the transport).
 *
 * - Single-report (`payload.length <= 62`):
 *   `[payload.length, ...payload, (~sum(payload)) & 0xFF, 0x00...]` (64 bytes)
 * - Multi-report fragmentation (`payload.length > 62`, e.g. 200-byte Write blocks):
 *   Splits into 61-byte (`0x3D`) chunks prefixed with `[0x3F, 0x4D ('M'), ...chunk61, checksum]`,
 *   followed by the final remainder chunk `[rem.length, ...rem, checksum]`.
 */
export function buildHidOutputReports(payload: Uint8Array): Uint8Array[] {
  const reports: Uint8Array[] = [];

  if (payload.length <= 62) {
    const report = new Uint8Array(64);
    report[0] = payload.length & 0xff;
    report.set(payload, 1);
    report[1 + payload.length] = computeHidOnesComplementChecksum(payload);
    reports.push(report);
    return reports;
  }

  let offset = 0;
  while (payload.length - offset > 61) {
    const chunk = payload.subarray(offset, offset + 61);
    const bodyWithM = new Uint8Array(62);
    bodyWithM[0] = 0x4d; // 'M' multi-report continuation marker
    bodyWithM.set(chunk, 1);

    const report = new Uint8Array(64);
    report[0] = 0x3f; // 63 bytes follow (1B 'M' + 61B chunk + 1B checksum)
    report.set(bodyWithM, 1);
    report[63] = computeHidOnesComplementChecksum(bodyWithM);
    reports.push(report);
    offset += 61;
  }

  const rem = payload.subarray(offset);
  const finalReport = new Uint8Array(64);
  finalReport[0] = rem.length & 0xff;
  finalReport.set(rem, 1);
  finalReport[1 + rem.length] = computeHidOnesComplementChecksum(rem);
  reports.push(finalReport);

  return reports;
}

/**
 * Builds a 5-byte Read Memory command (`'R'` + 24-bit Big-Endian address + 1-byte length).
 */
export function buildReadMemoryCommand(address24: number, length: number): Uint8Array {
  const cmd = new Uint8Array(5);
  cmd[0] = 0x52; // 'R'
  cmd[1] = (address24 >> 16) & 0xff;
  cmd[2] = (address24 >> 8) & 0xff;
  cmd[3] = address24 & 0xff;
  cmd[4] = length & 0xff;
  return cmd;
}

/**
 * Builds a Write Memory command (`'W'` + 24-bit Big-Endian address + 1-byte length + data bytes).
 */
export function buildWriteMemoryCommand(address24: number, data: Uint8Array): Uint8Array {
  const cmd = new Uint8Array(5 + data.length);
  cmd[0] = 0x57; // 'W'
  cmd[1] = (address24 >> 16) & 0xff;
  cmd[2] = (address24 >> 8) & 0xff;
  cmd[3] = address24 & 0xff;
  cmd[4] = data.length & 0xff;
  cmd.set(data, 5);
  return cmd;
}

/**
 * Memory region descriptor for reading or writing the HIROYASU IC-980 Pro Max EEPROM.
 */
export interface EepromTransferSegment {
  label: string;
  startAddress: number;
  endAddressInclusive: number;
  chunkSize: number;
}

/**
 * Exact EEPROM Read segments executed by `SendCommData` (`0x0042AAA7..0x0042AC95`).
 */
export const EEPROM_READ_SEGMENTS: readonly EepromTransferSegment[] = [
  { label: 'Channel Used Bitmask', startAddress: 0x000000, endAddressInclusive: 0x00003e, chunkSize: 63 },
  { label: 'VFO A & VFO B Configuration', startAddress: 0x011000, endAddressInclusive: 0x01105f, chunkSize: 96 },
  { label: 'General & Hotkey Settings', startAddress: 0x012000, endAddressInclusive: 0x0120fb, chunkSize: 252 },
  { label: 'DTMF Address Book & Groups', startAddress: 0x015000, endAddressInclusive: 0x0151fd, chunkSize: 255 },
];

/**
 * Generates the list of active 32-channel sector read/write blocks (`1,088` bytes per sector)
 * for all sectors that contain at least one active channel, or all 16 sectors (`0x01000..0x1043F`).
 */
export function getChannelSectorAddresses(): Array<{ sectorIndex: number; baseAddress: number; byteLength: number }> {
  const sectors: Array<{ sectorIndex: number; baseAddress: number; byteLength: number }> = [];
  for (let s = 0; s <= 15; s++) {
    const maxSlotsInSector = s === 15 ? 21 : 32; // Channel 500 is in sector 15 slot 20 (500 = 15*32 + 20)
    sectors.push({
      sectorIndex: s,
      baseAddress: 0x01000 + (s << 12),
      byteLength: maxSlotsInSector * 34,
    });
  }
  return sectors;
}
