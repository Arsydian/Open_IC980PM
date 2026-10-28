// @vitest-environment jsdom
/**
 * @file tests/importModal.test.tsx
 * @description Import dialog (`src/components/ImportModal.tsx`).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportModal } from '../src/components/ImportModal';

afterEach(cleanup);

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
    fireEvent.click(screen.getByRole('button', { name: /Import NOAA Weather/ }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][1]).toBe('overwrite_at');
    expect(onImport.mock.calls[0][2]).toBe(120);
  });
});
