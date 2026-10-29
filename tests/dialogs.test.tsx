// @vitest-environment jsdom
/**
 * @file tests/dialogs.test.tsx
 * @description Dialog semantics, Escape and focus handling (`src/components/useDialogA11y.ts`).
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportModal } from '../src/components/ImportModal';
import { BackupVaultModal } from '../src/components/BackupVaultModal';
import { RadioSyncModal } from '../src/components/RadioSyncModal';
import { createDefaultCodeplug } from '../src/core/ysfCodec';

afterEach(cleanup);

describe('modal dialogs', () => {
  it('are labelled dialogs with a labelled Close button', () => {
    const cp = createDefaultCodeplug();
    const noop = () => undefined;
    render(
      <>
        <ImportModal isOpen selectedChannelNumber={1} onClose={noop} onImportChannels={noop} />
        <BackupVaultModal isOpen codeplug={cp} onClose={noop} onRestoreCodeplug={noop} />
        <RadioSyncModal isOpen mode="read" codeplug={cp} onClose={noop} onCodeplugReadFromRadio={noop} />
      </>
    );
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs.map((d) => d.getAttribute('aria-modal'))).toEqual(['true', 'true', 'true']);
    expect(screen.getByRole('dialog', { name: /Import/ })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /Backup/ })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Read From Radio (USB HID)' })).toBeTruthy();
    for (const dialog of dialogs) {
      // The icon-only X button in each header has an accessible name
      expect(within(dialog).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('take focus when opened, close on Escape, and give focus back', () => {
    const onClose = vi.fn();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open import</button>
          <ImportModal
            isOpen={open}
            selectedChannelNumber={1}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            onImportChannels={() => undefined}
          />
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open import' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keep Tab inside the dialog', () => {
    render(
      <>
        <button>Outside</button>
        <RadioSyncModal isOpen mode="write" codeplug={createDefaultCodeplug()} onClose={() => undefined} onCodeplugReadFromRadio={() => undefined} />
      </>
    );
    const dialog = screen.getByRole('dialog');
    const buttons = [...dialog.querySelectorAll('button:not([disabled])')] as HTMLElement[];
    buttons[buttons.length - 1].focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});
