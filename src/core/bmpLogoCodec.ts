/**
 * @file src/core/bmpLogoCodec.ts
 * @description Custom Boot Logo encoder and decoder for the HIROYASU IC-980 Pro Max LCD (`160x128`).
 * Verified from `0x0041C8E0` (`btnUpdateOpenPictureClick`):
 * - Header (4 bytes): `[Height_hi, Height_lo, Width_hi, Width_lo]` (`[0x00, 0x80, 0x00, 0xA0]` for `128x160`)
 * - Payload (`2 * Width * Height` = `40,960` bytes): Big-Endian RGB565 pixels:
 *     `pix16 = ((R & 0xF8) << 8) | ((G & 0xFC) << 3) | (B >> 3)`
 *     `byte[0] = (pix16 >> 8) & 0xFF`, `byte[1] = pix16 & 0xFF`
 * - Flashed to Radio EEPROM address `0x1B000` (`40,964` bytes total).
 */

/** Standard HIROYASU IC-980 Pro Max LCD Width in pixels. */
export const BOOT_LOGO_WIDTH = 160;

/** Standard HIROYASU IC-980 Pro Max LCD Height in pixels. */
export const BOOT_LOGO_HEIGHT = 128;

/** Total byte size of the EEPROM `0x1B000` boot logo payload (`4 + 160 * 128 * 2 = 40,964` bytes). */
export const BOOT_LOGO_PAYLOAD_SIZE = 4 + BOOT_LOGO_WIDTH * BOOT_LOGO_HEIGHT * 2;

/**
 * Converts 8-bit RGB (`0..255`) components to a 16-bit RGB565 integer.
 * Matches the Delphi `R5G6B5` formula at `0x0041CA00`:
 *   `((R & 0xF8) << 8) | ((G & 0xFC) << 3) | ((B & 0xF8) >> 3)`
 */
export function rgb888ToRgb565(r: number, g: number, b: number): number {
  const r5 = (r & 0xf8) << 8;
  const g6 = (g & 0xfc) << 3;
  const b5 = (b & 0xf8) >> 3;
  return (r5 | g6 | b5) & 0xffff;
}

/**
 * Converts a 16-bit RGB565 integer back into 8-bit `[R, G, B]` (`0..255`) for LCD preview rendering.
 */
export function rgb565ToRgb888(pix16: number): [number, number, number] {
  const r5 = (pix16 >> 11) & 0x1f;
  const g6 = (pix16 >> 5) & 0x3f;
  const b5 = pix16 & 0x1f;
  const r = (r5 << 3) | (r5 >> 2);
  const g = (g6 << 2) | (g6 >> 4);
  const b = (b5 << 3) | (b5 >> 2);
  return [r, g, b];
}

/**
 * Encodes an RGBA pixel array (`width * height * 4` bytes, e.g. from `ImageData.data`)
 * into the exact `40,964`-byte Big-Endian RGB565 payload expected by EEPROM `0x1B000`.
 *
 * @param rgbaData - `Uint8ClampedArray` or `Uint8Array` of length `width * height * 4`
 * @param width - Image width (defaults to `160`)
 * @param height - Image height (defaults to `128`)
 * @returns `Uint8Array` of length `4 + width * height * 2`
 */
export function encodeRgbaToBootLogoPayload(
  rgbaData: Uint8ClampedArray | Uint8Array,
  width: number = BOOT_LOGO_WIDTH,
  height: number = BOOT_LOGO_HEIGHT
): Uint8Array {
  const expectedRgbaLen = width * height * 4;
  if (rgbaData.length < expectedRgbaLen) {
    throw new Error(`RGBA buffer too short: expected ${expectedRgbaLen} bytes, got ${rgbaData.length}`);
  }

  const out = new Uint8Array(4 + width * height * 2);
  // 4-byte Big-Endian dimensions header: [H_hi, H_lo, W_hi, W_lo]
  out[0] = (height >> 8) & 0xff;
  out[1] = height & 0xff;
  out[2] = (width >> 8) & 0xff;
  out[3] = width & 0xff;

  let dst = 4;
  for (let i = 0; i < expectedRgbaLen; i += 4) {
    const r = rgbaData[i];
    const g = rgbaData[i + 1];
    const b = rgbaData[i + 2];
    const pix16 = rgb888ToRgb565(r, g, b);
    // Big-Endian RGB565
    out[dst++] = (pix16 >> 8) & 0xff;
    out[dst++] = pix16 & 0xff;
  }

  return out;
}

/**
 * Decodes a Big-Endian RGB565 boot logo payload (`4 + 2*W*H` bytes) back into RGBA pixel data
 * suitable for rendering on an HTML5 `<canvas>`.
 */
export function decodeBootLogoPayloadToRgba(payload: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
} {
  if (payload.byteLength < 4) {
    throw new Error('Boot logo payload must be at least 4 bytes');
  }
  const height = (payload[0] << 8) | payload[1];
  const width = (payload[2] << 8) | payload[3];
  const rgba = new Uint8ClampedArray(width * height * 4);

  let src = 4;
  for (let i = 0; i < width * height; i++) {
    const hi = payload[src] ?? 0;
    const lo = payload[src + 1] ?? 0;
    src += 2;
    const pix16 = (hi << 8) | lo;
    const [r, g, b] = rgb565ToRgb888(pix16);
    const dst = i * 4;
    rgba[dst] = r;
    rgba[dst + 1] = g;
    rgba[dst + 2] = b;
    rgba[dst + 3] = 255;
  }

  return { width, height, rgba };
}
