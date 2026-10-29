// @vitest-environment jsdom
/**
 * @file tests/channelGrid.test.tsx
 * @description Channel grid actions (`src/components/ChannelGrid.tsx`).
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelGrid } from '../src/components/ChannelGrid';
import { createDefaultCodeplug } from '../src/core/ysfCodec';
import type { RadioCodeplug } from '../src/types/radio';

// Each row renders two FrequencyInputs (RX and TX); counting their renders counts row renders.
const frequencyInputRenders = new Map<string, number>();
vi.mock('../src/components/FrequencyInput', () => ({
  FrequencyInput: ({ ariaLabel }: { ariaLabel?: string }) => {
    const key = ariaLabel ?? '?';
    frequencyInputRenders.set(key, (frequencyInputRenders.get(key) ?? 0) + 1);
    return <input aria-label={ariaLabel} readOnly />;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A codeplug with `count` programmed channels named C1..Cn at descending frequencies. */
function codeplugWithChannels(count: number): RadioCodeplug {
  const cp = createDefaultCodeplug();
  for (let i = 0; i < count; i++) {
    const hz = 147_000_000 - i * 15_000;
    Object.assign(cp.channels[i], { used: true, rxFreqHz: hz, txFreqHz: hz, name: `C${i + 1}` });
  }
  return cp;
}

/** Renders ChannelGrid with real state; `state.current` is the latest codeplug. */
function renderGrid(initial: RadioCodeplug, selected = 1) {
  const state: { current: RadioCodeplug; selected: number } = { current: initial, selected };
  const Harness = () => {
    const [cp, setCp] = useState(initial);
    const [sel, setSel] = useState(selected);
    state.current = cp;
    state.selected = sel;
    return (
      <ChannelGrid
        codeplug={cp}
        selectedChannelNumber={sel}
        onSelectChannel={setSel}
        onUpdateChannels={(channels) => setCp((prev) => ({ ...prev, channels }))}
        onOpenImportModal={() => undefined}
      />
    );
  };
  render(<Harness />);
  return state;
}

const names = (cp: RadioCodeplug, n: number) => cp.channels.slice(0, n).map((c) => (c.used ? c.name : '-'));

describe('destructive grid actions ask first', () => {
  it('Clear All does nothing when cancelled and clears when confirmed', () => {
    const state = renderGrid(codeplugWithChannels(3));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: /Clear All/ }));
    expect(confirm).toHaveBeenCalledWith('Clear all 3 programmed channels? This cannot be undone.');
    expect(names(state.current, 3)).toEqual(['C1', 'C2', 'C3']);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Clear All/ }));
    expect(names(state.current, 3)).toEqual(['-', '-', '-']);
  });

  it('Clear Row asks for a programmed channel', () => {
    const state = renderGrid(codeplugWithChannels(3), 2);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Clear Row/ }));
    expect(names(state.current, 3)).toEqual(['C1', 'C2', 'C3']);
  });

  it('Sort asks before renumbering channels', () => {
    const state = renderGrid(codeplugWithChannels(3));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /Sort Freq/ }));
    expect(confirm.mock.calls[0][0]).toMatch(/^Sort all 3 programmed channels by frequency\?/);
    expect(names(state.current, 3)).toEqual(['C1', 'C2', 'C3']);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Sort Freq/ }));
    expect(names(state.current, 3)).toEqual(['C3', 'C2', 'C1']);
  });
});

describe('grid rendering', () => {
  it('re-renders only the edited row when a channel name changes', () => {
    renderGrid(codeplugWithChannels(40));
    frequencyInputRenders.clear();
    const name5 = () => document.querySelector('input[aria-label="Channel 5 name"]') as HTMLInputElement;

    fireEvent.change(name5(), { target: { value: 'NEW NAME' } });

    expect(name5().value).toBe('NEW NAME');
    expect([...frequencyInputRenders.keys()].sort()).toEqual([
      'Channel 5 RX frequency (MHz)',
      'Channel 5 TX frequency (MHz)',
    ]);
  });
});
