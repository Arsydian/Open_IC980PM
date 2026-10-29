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
import { serializeRichBundle, uint8ArrayToBase64 } from '../src/core/backupBundle';

// Spy on the .Ysf encoder while keeping its real behaviour.
vi.mock('../src/core/ysfCodec', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/core/ysfCodec')>();
  return { ...mod, encodeYsfBuffer: vi.fn(mod.encodeYsfBuffer) };
});

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
    expect(alert.textContent).toBe('"broken.Ysf" is 10 bytes; a .Ysf codeplug is exactly 47,046 bytes.');
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

describe('editing performance', () => {
  it('does not re-encode the 47 KB .Ysf buffer on every edit', { timeout: 30_000 }, async () => {
    render(<App />);
    const addChannel = await screen.findByRole('button', { name: /Add Channel/ }, { timeout: WAIT_MS });
    vi.mocked(encodeYsfBuffer).mockClear();

    fireEvent.click(addChannel);
    expect(await screen.findByText('Modified', {}, { timeout: WAIT_MS })).toBeTruthy();
    expect(encodeYsfBuffer).not.toHaveBeenCalled();
  });
});

describe('saving a .Ysf file', () => {
  const stubDownloads = () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  };

  it('clears "Modified" when nothing is left out', { timeout: 30_000 }, async () => {
    stubDownloads();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Add Channel/ }, { timeout: WAIT_MS }));
    expect(screen.getByText('Modified')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save \.Ysf/ }));
    expect(screen.queryByText('Modified')).toBeNull();
    expect((await screen.findByRole('status', {}, { timeout: WAIT_MS })).textContent).toBe('Saved 47,046-byte .Ysf codeplug file.');
    vi.restoreAllMocks();
  });

  it('keeps "Modified" and warns when notes or calibration would be left out', { timeout: 30_000 }, async () => {
    stubDownloads();
    const cp = createDefaultCodeplug();
    cp.rfCalibrationBase64 = uint8ArrayToBase64(new Uint8Array(775));
    const { container } = render(<App />);
    openFile(container, new File([serializeRichBundle(cp)], 'backup.ic980.json'));
    await screen.findByRole('status', {}, { timeout: WAIT_MS });

    fireEvent.click(screen.getByRole('button', { name: /Add Channel/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save \.Ysf/ }));

    expect(screen.getByText('Modified')).toBeTruthy();
    expect((await screen.findByRole('alert', {}, { timeout: WAIT_MS })).textContent).toMatch(
      /cannot hold channel notes .* or the RF calibration backup/
    );
    vi.restoreAllMocks();
  });
});
