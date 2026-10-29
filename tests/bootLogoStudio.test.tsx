// @vitest-environment jsdom
/**
 * @file tests/bootLogoStudio.test.tsx
 * @description Boot Logo Studio drawing (`src/components/BootLogoStudio.tsx`) with a fake canvas.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootLogoStudio, fitFontPx } from '../src/components/BootLogoStudio';

/** Text drawn on the canvas, as "font|text". */
let drawn: string[] = [];

beforeEach(() => {
  drawn = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '',
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: () => undefined,
    putImageData: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(160 * 128 * 4) }),
    fillText(text: string) {
      drawn.push(`${this.font}|${text}`);
    },
    // Monospace-like: each character is 0.6 em wide
    measureText(text: string) {
      const px = parseInt(/(\d+)px/.exec(this.font)?.[1] ?? '10', 10);
      return { width: text.length * px * 0.6 };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    }
  );
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitFontPx', () => {
  it('returns the largest size that fits, or the minimum', () => {
    const measure = (text: string) => (px: number) => text.length * px * 0.6;
    expect(fitFontPx(measure('W1AW'), 140, 20, 10)).toBe(20);
    expect(fitFontPx(measure('IC-980 PRO MAX'), 140, 20, 10)).toBe(16);
    expect(fitFontPx(measure('X'.repeat(60)), 140, 20, 10)).toBe(10);
  });
});

describe('BootLogoStudio', () => {
  it('draws the whole default title, shrinking it to fit instead of cutting it to 12 characters', () => {
    render(<BootLogoStudio defaultCallsign="" />);
    expect(drawn).toContain('bold 16px monospace|IC-980 PRO MAX');
  });

  it('keeps an uploaded image when the title changes, until the user switches back', async () => {
    render(<BootLogoStudio defaultCallsign="W1AW" />);
    fireEvent.change(screen.getByLabelText('Boot logo image file'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })] },
    });
    await screen.findByText(/The preview shows your uploaded image/);

    drawn = [];
    fireEvent.change(screen.getByLabelText('Boot screen title'), { target: { value: 'K9XYZ' } });
    expect(drawn).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Use callsign design' }));
    expect(drawn.some((d) => d.endsWith('|K9XYZ'))).toBe(true);
  });
});
