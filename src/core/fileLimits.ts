/**
 * @file src/core/fileLimits.ts
 * @description Size checks applied to a user-chosen file before it is read into memory, so a wrong
 * or huge file is refused with a clear message instead of being loaded (or silently truncated).
 */

import { RF_CALIBRATION_SIZE, YSF_FILE_SIZE } from './constants';

export type UserFileKind = 'ysf' | 'bundle' | 'csv' | 'image' | 'calibration';

/** Largest `.ic980.json` bundle or CSV file accepted. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

/** Largest boot-logo source image accepted (it is scaled down to 160×128). */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;

const bytes = (n: number) => `${n.toLocaleString('en-US')} bytes`;
const megabytes = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Returns why `file` cannot be used as `kind`, or `null` when its size is acceptable. */
export function fileSizeProblem(file: { name: string; size: number }, kind: UserFileKind): string | null {
  switch (kind) {
    case 'ysf':
      return file.size === YSF_FILE_SIZE
        ? null
        : `"${file.name}" is ${bytes(file.size)}; a .Ysf codeplug is exactly ${bytes(YSF_FILE_SIZE)}.`;
    case 'calibration':
      return file.size === RF_CALIBRATION_SIZE
        ? null
        : `"${file.name}" is ${bytes(file.size)}; an RF calibration (.cal) file is exactly ${bytes(RF_CALIBRATION_SIZE)}.`;
    case 'bundle':
    case 'csv':
      return file.size <= MAX_TEXT_FILE_BYTES
        ? null
        : `"${file.name}" is larger than ${megabytes(MAX_TEXT_FILE_BYTES)}, too large for a ${kind === 'csv' ? 'CSV channel list' : '.ic980.json bundle'}.`;
    case 'image':
      return file.size <= MAX_IMAGE_FILE_BYTES
        ? null
        : `"${file.name}" is larger than ${megabytes(MAX_IMAGE_FILE_BYTES)}; choose a smaller image.`;
  }
}
