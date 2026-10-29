/**
 * @file tests/fileLimits.test.ts
 * @description File size checks before reading user files (`src/core/fileLimits.ts`) and the boot
 * logo header check (`src/core/bmpLogoCodec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_FILE_BYTES, MAX_TEXT_FILE_BYTES, fileSizeProblem } from '../src/core/fileLimits';
import { decodeBootLogoPayloadToRgba } from '../src/core/bmpLogoCodec';

describe('fileSizeProblem', () => {
  it('requires exact sizes for .Ysf and .cal files', () => {
    expect(fileSizeProblem({ name: 'a.Ysf', size: 47046 }, 'ysf')).toBeNull();
    expect(fileSizeProblem({ name: 'a.Ysf', size: 2_000_000_000 }, 'ysf')).toBe(
      '"a.Ysf" is 2,000,000,000 bytes; a .Ysf codeplug is exactly 47,046 bytes.'
    );
    expect(fileSizeProblem({ name: 'r.cal', size: 775 }, 'calibration')).toBeNull();
    expect(fileSizeProblem({ name: 'r.cal', size: 1024 }, 'calibration')).toMatch(/exactly 775 bytes/);
  });

  it('caps bundles, CSV files and images', () => {
    expect(fileSizeProblem({ name: 'b.json', size: MAX_TEXT_FILE_BYTES }, 'bundle')).toBeNull();
    expect(fileSizeProblem({ name: 'b.json', size: MAX_TEXT_FILE_BYTES + 1 }, 'bundle')).toMatch(/larger than 5 MB/);
    expect(fileSizeProblem({ name: 'c.csv', size: MAX_TEXT_FILE_BYTES + 1 }, 'csv')).toMatch(/CSV channel list/);
    expect(fileSizeProblem({ name: 'p.png', size: MAX_IMAGE_FILE_BYTES + 1 }, 'image')).toMatch(/larger than 20 MB/);
  });
});

describe('decodeBootLogoPayloadToRgba', () => {
  it('refuses a header claiming more pixels than the payload holds', () => {
    const payload = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0]);
    expect(() => decodeBootLogoPayloadToRgba(payload)).toThrow(/says 65535x65535/);
  });
});
