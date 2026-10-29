// @vitest-environment jsdom
/**
 * @file tests/app.test.tsx
 * @description App-level behaviour (`src/App.tsx`): opening files and the toast banner.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { encodeYsfBuffer, createDefaultCodeplug } from '../src/core/ysfCodec';

afterEach(cleanup);

// Rendering the full 500-row app is slow in jsdom, especially with other test files running.
const WAIT_MS = 15_000;

/** Picks `file` in the header's hidden "Open File" input. */
function openFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"][accept=".ysf,.Ysf,.json"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('unsaved changes', () => {
  it('warns before unload and asks before opening a file over edits', { timeout: 30_000 }, async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    // No edits yet: unload is not blocked and opening a file does not ask.
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: /Open File/ }, { timeout: WAIT_MS }));
    expect(confirm).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Open File/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1); // cancelled: the file picker did not open
    vi.restoreAllMocks();
  });
});

describe('toast banner', () => {
  it('shows a failed file load as an error alert, not a green success', { timeout: 30_000 }, async () => {
    const { container } = render(<App />);
    openFile(container, new File([new Uint8Array(10)], 'broken.Ysf'));

    const alert = await screen.findByRole('alert', {}, { timeout: WAIT_MS });
    expect(alert.textContent).toMatch(/Invalid \.Ysf file size/);
    expect(alert.getAttribute('data-kind')).toBe('error');
    expect(alert.className).toContain('border-rose-500/60');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still shows a successful load as a status message', { timeout: 30_000 }, async () => {
    const { container } = render(<App />);
    const ysf = encodeYsfBuffer(createDefaultCodeplug());
    openFile(container, new File([ysf as unknown as BlobPart], 'good.Ysf'));

    const status = await screen.findByRole('status', {}, { timeout: WAIT_MS });
    expect(status.textContent).toBe('Loaded .Ysf codeplug: good.Ysf');
    expect(status.getAttribute('data-kind')).toBe('success');
  });
});
