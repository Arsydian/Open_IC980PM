/**
 * @file tests/helpers/fakeHidRadio.ts
 * @description In-memory stand-in for the IC-980 Pro Max on the WebHID transport. It speaks the
 * same 64-byte report framing as `src/core/hidProtocol.ts` in both directions and answers the
 * `PROG81LS` handshake, `'R'` reads, `'W'` writes and `'E'` exit, logging every command.
 */

import { buildHidOutputReports, decodeHidInputReport } from '../../src/core/hidProtocol';

type InputReportListener = (ev: { reportId: number; data: DataView }) => void;

export interface FakeRadioCommand {
  op: 'handshake' | 'stx' | 'ack' | 'read' | 'write' | 'end';
  address?: number;
  length?: number;
}

export interface FakeRadioOptions {
  /** Answer reads with this address instead of the requested one (simulates a misframed reply). */
  echoAddressOverride?: number;
  /** Reject (NAK, `0x15`) a `'W'` block that starts at this address. */
  nakWriteAt?: number;
  /** Acknowledge a `'W'` block at this address but store its first byte inverted. */
  corruptWriteAt?: number;
}

export class FakeHidRadio {
  /** Radio memory, large enough for the boot logo region at `0x1B000`. */
  readonly memory = new Uint8Array(0x30000).fill(0xff);
  readonly commands: FakeRadioCommand[] = [];
  opened = false;
  readonly vendorId = 0x1234;
  readonly productId = 0x5678;
  readonly productName = 'ASER-471';

  private readonly listeners = new Set<InputReportListener>();
  private pending: number[] = [];

  constructor(private readonly options: FakeRadioOptions = {}) {}

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  addEventListener(_type: 'inputreport', listener: InputReportListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'inputreport', listener: InputReportListener): void {
    this.listeners.delete(listener);
  }

  async sendReport(_reportId: number, data: BufferSource): Promise<void> {
    const report = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const isContinuation = report[0] === 0x3f && report[1] === 0x4d;
    this.pending.push(...decodeHidInputReport(report));
    if (isContinuation) return;

    const cmd = Uint8Array.from(this.pending);
    this.pending = [];
    queueMicrotask(() => this.handleCommand(cmd));
  }

  /** Addresses written with `'W'`, in order. */
  writtenAddresses(): number[] {
    return this.commands.filter((c) => c.op === 'write').map((c) => c.address as number);
  }

  private reply(payload: Uint8Array): void {
    for (const rpt of buildHidOutputReports(payload)) {
      for (const listener of [...this.listeners]) {
        listener({ reportId: 0, data: new DataView(rpt.buffer) });
      }
    }
  }

  private handleCommand(cmd: Uint8Array): void {
    const op = cmd[0];
    if (cmd.length === 8 && op === 0x50) {
      this.commands.push({ op: 'handshake' });
      this.reply(Uint8Array.of(0x06));
    } else if (cmd.length === 1 && op === 0x02) {
      this.commands.push({ op: 'stx' });
      this.reply(new TextEncoder().encode('P3207\0\0\0'));
    } else if (cmd.length === 1 && op === 0x06) {
      this.commands.push({ op: 'ack' });
      this.reply(Uint8Array.of(0x06));
    } else if (cmd.length === 1 && op === 0x45) {
      this.commands.push({ op: 'end' });
    } else if (op === 0x52) {
      const address = (cmd[1] << 16) | (cmd[2] << 8) | cmd[3];
      const length = cmd[4];
      this.commands.push({ op: 'read', address, length });
      const echo = this.options.echoAddressOverride ?? address;
      const out = new Uint8Array(5 + length);
      out.set([0x57, (echo >> 16) & 0xff, (echo >> 8) & 0xff, echo & 0xff, length]);
      out.set(this.memory.subarray(address, address + length), 5);
      this.reply(out);
    } else if (op === 0x57) {
      const address = (cmd[1] << 16) | (cmd[2] << 8) | cmd[3];
      const length = cmd[4];
      this.commands.push({ op: 'write', address, length });
      if (this.options.nakWriteAt === address) {
        this.reply(Uint8Array.of(0x15));
        return;
      }
      this.memory.set(cmd.subarray(5, 5 + length), address);
      if (this.options.corruptWriteAt === address) {
        this.memory[address] ^= 0xff;
      }
      this.reply(Uint8Array.of(0x06));
    }
  }
}

/**
 * Makes `navigator.hid.requestDevice()` return `radio`. Returns a function that restores the
 * previous `navigator`.
 */
export function installFakeRadio(radio: FakeHidRadio): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { hid: { requestDevice: async () => [radio] } },
    configurable: true,
    writable: true,
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'navigator', previous);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  };
}
