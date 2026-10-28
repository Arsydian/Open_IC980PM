// @vitest-environment jsdom
/**
 * @file tests/advancedSettings.test.tsx
 * @description Advanced and General settings editors (`src/components/AdvancedSettings.tsx`,
 * `src/components/GeneralSettings.tsx`).
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
