// @vitest-environment jsdom
/**
 * @file tests/advancedSettings.test.tsx
 * @description Advanced and General settings editors (`src/components/AdvancedSettings.tsx`,
 * `src/components/GeneralSettings.tsx`).
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AdvancedSettings } from '../src/components/AdvancedSettings';
import { GeneralSettings } from '../src/components/GeneralSettings';
import { createDefaultCodeplug } from '../src/core/ysfCodec';
import type { RadioCodeplug } from '../src/types/radio';

afterEach(cleanup);

/** Renders AdvancedSettings with real state so edits flow back into the props. */
function renderAdvanced(initial: RadioCodeplug = createDefaultCodeplug()) {
  const latest: { current: RadioCodeplug } = { current: initial };
  const Harness = () => {
    const [cp, setCp] = useState(initial);
    latest.current = cp;
    const update = (patch: Partial<RadioCodeplug>) => setCp((prev) => ({ ...prev, ...patch }));
    return (
      <AdvancedSettings
        general={cp.general}
        crossBandSlots={cp.crossBandSlots}
        dtmf={cp.dtmf}
        bandLimits={cp.bandLimits}
        channels={cp.channels}
        rfCalibrationBase64={cp.rfCalibrationBase64}
        onChangeGeneral={(general) => update({ general })}
        onChangeCrossBandSlots={(crossBandSlots) => update({ crossBandSlots })}
        onChangeDtmf={(dtmf) => update({ dtmf })}
        onChangeBandLimits={(bandLimits) => update({ bandLimits })}
        onChangeCalibration={(rfCalibrationBase64) => update({ rfCalibrationBase64 })}
      />
    );
  };
  render(<Harness />);
  return latest;
}

describe('settings that are not written to the radio', () => {
  it('marks the cross-band preset slots and the DTMF local ID as file-only', () => {
    renderAdvanced();
    expect(screen.getByRole('note').textContent).toMatch(/7 preset slots below are saved in the \.Ysf file only/);

    fireEvent.click(screen.getAllByRole('button', { name: /DTMF/ })[0]);
    expect(screen.getByRole('note').textContent).toMatch(/does not change its local ID/);
  });

  it('marks the power-on display mode as file-only', () => {
    const cp = createDefaultCodeplug();
    render(
      <GeneralSettings
        general={cp.general}
        vfoA={cp.vfoA}
        vfoB={cp.vfoB}
        onChangeGeneral={() => undefined}
        onChangeVfoA={() => undefined}
        onChangeVfoB={() => undefined}
      />
    );
    const notes = screen.getAllByRole('note').map((n) => n.textContent);
    expect(notes).toEqual([expect.stringMatching(/Writing to the radio does not change this setting/)]);
  });
});

describe('cross-band preset tones', () => {
  it('replaces a CTCSS value with a valid DCS code when the type switches to DCS', () => {
    const state = renderAdvanced();
    const toneType = screen.getByLabelText('Slot 1 band A tone type');

    fireEvent.change(toneType, { target: { value: 'CTCSS' } });
    expect(state.current.crossBandSlots[0]).toMatchObject({ toneAType: 'CTCSS', toneAValue: 67.0 }); // still valid

    fireEvent.change(toneType, { target: { value: 'DCS_N' } });
    expect(state.current.crossBandSlots[0]).toMatchObject({ toneAType: 'DCS_N', toneAValue: 23 });

    fireEvent.change(screen.getByLabelText('Slot 1 band B tone type'), { target: { value: 'DCS_I' } });
    expect(state.current.crossBandSlots[0]).toMatchObject({ toneBType: 'DCS_I', toneBValue: 23 });
  });
});

describe('band limit fields', () => {
  const edit = (label: string, text: string) => {
    const input = screen.getByLabelText(label);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  };

  it('refuses negative values and a minimum above the maximum, keeping the old limit', () => {
    const state = renderAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /Band Unlock/ }));

    edit('VHF minimum (MHz)', '-136');
    expect(state.current.bandLimits.vhfMinMhz).toBe(136);
    expect(screen.getByRole('alert').textContent).toContain('"-136" is not a frequency in MHz.');

    edit('VHF minimum (MHz)', '180');
    expect(state.current.bandLimits.vhfMinMhz).toBe(136);
    expect(screen.getByRole('alert').textContent).toContain('VHF minimum (180 MHz) must be below VHF maximum');

    edit('UHF maximum (MHz)', '520');
    expect(state.current.bandLimits.uhfMaxMhz).toBe(520);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not commit a half-typed value', () => {
    const state = renderAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /Band Unlock/ }));
    const input = screen.getByLabelText('VHF maximum (MHz)');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1' } });
    expect(state.current.bandLimits.vhfMaxMhz).toBe(174);
  });
});

describe('DTMF address book contacts', () => {
  it('limits name and code to what fits in the 16-byte slot', () => {
    const state = renderAdvanced();
    fireEvent.click(screen.getAllByRole('button', { name: /DTMF/ })[0]);

    fireEvent.change(screen.getByLabelText('Contact 1 name'), { target: { value: 'BASE:CAMP1' } });
    fireEvent.change(screen.getByLabelText('Contact 1 DTMF code'), { target: { value: '1234567890123' } });

    // ':' is removed and the name capped at 7; the code gets the remaining 16 - 7 - 1 = 8 bytes.
    expect(state.current.dtmf.contacts[0]).toMatchObject({ name: 'BASECAM', code: '12345678' });
    expect(screen.getByLabelText('Contact 1 DTMF code')).toHaveProperty('maxLength', 8);
  });
});

describe('RF calibration import', () => {
  it('refuses a file that is not exactly 775 bytes instead of truncating it', async () => {
    const state = renderAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /RF Calibration/ }));
    const input = screen.getByLabelText('RF calibration file');

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(1024)], 'other.bin')] } });
    expect(screen.getByRole('alert').textContent).toContain('an RF calibration (.cal) file is exactly 775 bytes');
    expect(state.current.rfCalibrationBase64).toBeUndefined();

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(775).fill(7)], 'radio.cal')] } });
    await waitFor(() => expect(state.current.rfCalibrationBase64).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
