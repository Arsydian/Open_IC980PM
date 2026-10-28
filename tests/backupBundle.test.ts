/**
 * @file tests/backupBundle.test.ts
 * @description `.ic980.json` bundle loading (`src/core/backupBundle.ts`) with untrusted input.
 */

import { describe, expect, it } from 'vitest';
import {
  deserializeRichBundle,
  isValidCalibrationBase64,
  serializeRichBundle,
  uint8ArrayToBase64,
} from '../src/core/backupBundle';
import { RF_CALIBRATION_SIZE } from '../src/core/constants';
import { createDefaultCodeplug } from '../src/core/ysfCodec';

function bundleWithChannel1(patch: Record<string, unknown> = {}) {
  const cp = createDefaultCodeplug();
  Object.assign(cp.channels[0], { used: true, rxFreqHz: 146_520_000, txFreqHz: 146_520_000, name: 'CALL' });
  cp.channels[0].metadata = { source: 'repeaterbook', callsign: 'W1AW', notes: 'Test' };
  cp.rfCalibrationBase64 = uint8ArrayToBase64(new Uint8Array(RF_CALIBRATION_SIZE).fill(7));
  return JSON.stringify({ ...JSON.parse(serializeRichBundle(cp)), ...patch });
}

describe('deserializeRichBundle', () => {
  it('round-trips a valid bundle with calibration and metadata', () => {
    const cp = deserializeRichBundle(bundleWithChannel1());
    expect(cp.channels[0].metadata).toMatchObject({ source: 'repeaterbook', callsign: 'W1AW', notes: 'Test' });
    expect(isValidCalibrationBase64(cp.rfCalibrationBase64)).toBe(true);
  });

  it('rejects a calibration block that is not 775 bytes of base64', () => {
    expect(() => deserializeRichBundle(bundleWithChannel1({ rfCalibrationBase64: '!!!not base64!!!' }))).toThrow(
      'Invalid .ic980.json bundle: the RF calibration block must be 775 bytes of base64.'
    );
    expect(() => deserializeRichBundle(bundleWithChannel1({ rfCalibrationBase64: 'AAAA' }))).toThrow(/775 bytes/);
    expect(() => deserializeRichBundle(bundleWithChannel1({ rfCalibrationBase64: 42 }))).toThrow(/775 bytes/);
  });

  it('drops wrongly typed metadata fields instead of passing them to the UI', () => {
    const cp = deserializeRichBundle(
      bundleWithChannel1({
        channelMetadata: { 1: { notes: 5, source: 'evil', distanceMiles: 'far', callsign: 'W1AW' }, 2: 'junk' },
      })
    );
    expect(cp.channels[0].metadata).toEqual({
      source: undefined,
      callsign: 'W1AW',
      city: undefined,
      state: undefined,
      notes: undefined,
      distanceMiles: undefined,
    });
    expect(cp.channels[1].metadata).toBeUndefined();
  });

  it('reports malformed files with a clear error', () => {
    expect(() => deserializeRichBundle('null')).toThrow('Invalid .ic980.json bundle format.');
    expect(() => deserializeRichBundle(bundleWithChannel1({ ysfBase64: '%%%' }))).toThrow(/not valid base64/);
  });
});
