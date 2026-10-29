// @vitest-environment jsdom
/**
 * @file tests/importModal.test.tsx
 * @description Import dialog (`src/components/ImportModal.tsx`).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportModal, RB_TOKEN_STORAGE_KEY } from '../src/components/ImportModal';
import { REPEATERBOOK_DESKTOP_ONLY_MESSAGE } from '../src/core/repeaterBookClient';

afterEach(cleanup);

describe('ImportModal RepeaterBook token', () => {
  it('saves the token once when the field is left, trimmed, and removes it when cleared', () => {
    localStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ImportModal isOpen selectedChannelNumber={1} onClose={() => undefined} onImportChannels={() => undefined} />);
    const input = screen.getByLabelText('RepeaterBook app token');

    for (const partial of ['r', 'rb', 'rbuapp_abc ']) {
      fireEvent.change(input, { target: { value: partial } });
    }
    expect(setItem).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(localStorage.getItem(RB_TOKEN_STORAGE_KEY)).toBe('rbuapp_abc');
    expect(setItem).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(RB_TOKEN_STORAGE_KEY)).toBeNull();
    setItem.mockRestore();
  });

  it('links to the page where RepeaterBook users generate app tokens', () => {
    render(<ImportModal isOpen selectedChannelNumber={1} onClose={() => undefined} onImportChannels={() => undefined} />);
    expect(screen.getByRole('link', { name: /Get Token/ }).getAttribute('href')).toBe(
      'https://www.repeaterbook.com/user/api_apps.php'
    );
  });
});

describe('ImportModal start channel', () => {
  it('uses the channel selected when the dialog opens, not the one at startup', () => {
    const onImport = vi.fn();
    const props = { onClose: () => undefined, onImportChannels: onImport };

    // The app mounts the dialog closed at startup with channel 1 selected...
    const { rerender } = render(<ImportModal {...props} isOpen={false} selectedChannelNumber={1} />);
    // ...then the user selects channel 120 and opens it.
    rerender(<ImportModal {...props} isOpen selectedChannelNumber={120} />);

    fireEvent.change(screen.getByLabelText(/Channel Insertion Mode/), { target: { value: 'overwrite_at' } });
    expect(screen.getByLabelText('Start channel number')).toHaveProperty('value', '120');

    fireEvent.click(screen.getByRole('button', { name: /Quick-Packs/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import 2m \/ 70cm Ham Simplex Calling/ }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][1]).toBe('overwrite_at');
    expect(onImport.mock.calls[0][2]).toBe(120);
  });
});

describe('ImportModal receive-only Quick-Packs', () => {
  const open = (onImport: () => void) => {
    render(<ImportModal isOpen selectedChannelNumber={1} onClose={() => undefined} onImportChannels={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: /Quick-Packs/ }));
  };

  it('shows the regulatory note on the card and asks before importing', () => {
    const onImport = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open(onImport);

    expect(screen.getAllByRole('note').some((n) => /NOAA Weather Radio is a broadcast service/.test(n.textContent ?? ''))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Import NOAA Weather/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Import NOAA Weather/ }));
    expect(onImport).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('imports amateur packs without asking', () => {
    const onImport = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    open(onImport);
    fireEvent.click(screen.getByRole('button', { name: /Import 2m \/ 70cm Ham Simplex Calling/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onImport).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe('ImportModal RepeaterBook availability', () => {
  afterEach(() => {
    delete (window as { api?: unknown }).api;
  });

  it('explains and disables search outside the desktop app', () => {
    render(<ImportModal isOpen selectedChannelNumber={1} onClose={() => undefined} onImportChannels={() => undefined} />);
    expect(screen.getByRole('button', { name: /Search Repeaters/ })).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('note').some((n) => n.textContent === REPEATERBOOK_DESKTOP_ONLY_MESSAGE)).toBe(true);
  });

  it('enables search in the desktop app', () => {
    (window as { api?: unknown }).api = { fetchRepeaterBookJson: async () => ({ results: [] }) };
    render(<ImportModal isOpen selectedChannelNumber={1} onClose={() => undefined} onImportChannels={() => undefined} />);
    expect(screen.getByRole('button', { name: /Search Repeaters/ })).toHaveProperty('disabled', false);
    expect(screen.queryAllByRole('note').some((n) => n.textContent === REPEATERBOOK_DESKTOP_ONLY_MESSAGE)).toBe(false);
  });
});
