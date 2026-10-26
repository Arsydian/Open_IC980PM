/**
 * @file src/components/GeneralSettings.tsx
 * @description General Radio Settings view with an integrated VFO A / VFO B Configuration
 * subsection (User Requirement #7).
 */

import React from 'react';
import {
  Radio,
  Settings,
  Volume2,
  Sun,
  Shield,
  MessageSquare,
} from 'lucide-react';
import type {
  Bandwidth,
  GeneralSettingsConfig,
  ModulationMode,
  OffsetDirection,
  ToneType,
  TxPower,
  VfoConfig,
} from '../types/radio';
import {
  APO_LABELS,
  BACKLIGHT_LABELS,
  CTCSS_TONES,
  DCS_CODES,
  LED_COLOR_LABELS,
  STEP_FREQUENCY_LABELS,
  TOT_LABELS,
  VOX_DELAY_LABELS,
} from '../core/constants';

interface GeneralSettingsProps {
  general: GeneralSettingsConfig;
  vfoA: VfoConfig;
  vfoB: VfoConfig;
  onChangeGeneral: (updated: GeneralSettingsConfig) => void;
  onChangeVfoA: (updated: VfoConfig) => void;
  onChangeVfoB: (updated: VfoConfig) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  general,
  vfoA,
  vfoB,
  onChangeGeneral,
  onChangeVfoA,
  onChangeVfoB,
}) => {
  const renderVfoCard = (
    label: 'VFO A (Upper Band)' | 'VFO B (Lower Band)',
    badgeText: string,
    vfo: VfoConfig,
    onUpdate: (next: VfoConfig) => void
  ) => (
    <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-cyan-400" />
          <h4 className="text-sm font-bold text-slate-100">{label}</h4>
        </div>
        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
          {badgeText}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-slate-400 mb-1">RX Frequency (MHz)</label>
          <input
            type="number"
            step="0.00125"
            value={Number((vfo.rxFreqHz / 1_000_000).toFixed(5))}
            onChange={(e) => {
              const mhz = parseFloat(e.target.value);
              if (Number.isFinite(mhz) && mhz > 0) {
                onUpdate({ ...vfo, rxFreqHz: Math.round(mhz * 1_000_000) });
              }
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-cyan-200 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1">TX Frequency (MHz)</label>
          <input
            type="number"
            step="0.00125"
            value={Number((vfo.txFreqHz / 1_000_000).toFixed(5))}
            onChange={(e) => {
              const mhz = parseFloat(e.target.value);
              if (Number.isFinite(mhz) && mhz > 0) {
                onUpdate({ ...vfo, txFreqHz: Math.round(mhz * 1_000_000) });
              }
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Offset Direction</label>
          <select
            value={vfo.offsetDirection}
            onChange={(e) => onUpdate({ ...vfo, offsetDirection: e.target.value as OffsetDirection })}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="OFF">OFF (Simplex)</option>
            <option value="+">+ (Positive Shift)</option>
            <option value="-">- (Negative Shift)</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Offset Frequency (MHz)</label>
          <input
            type="number"
            step="0.05"
            value={Number((vfo.offsetFreqHz / 1_000_000).toFixed(4))}
            onChange={(e) => {
              const mhz = parseFloat(e.target.value);
              if (Number.isFinite(mhz) && mhz >= 0) {
                onUpdate({ ...vfo, offsetFreqHz: Math.round(mhz * 1_000_000) });
              }
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
          />
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Frequency Step</label>
          <select
            value={vfo.stepIndex}
            onChange={(e) => onUpdate({ ...vfo, stepIndex: parseInt(e.target.value, 10) })}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            {STEP_FREQUENCY_LABELS.map((lbl, idx) => (
              <option key={lbl} value={idx}>
                {lbl}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Display Mode</label>
          <select
            value={vfo.displayMode}
            onChange={(e) => onUpdate({ ...vfo, displayMode: parseInt(e.target.value, 10) })}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value={0}>Frequency Mode</option>
            <option value={1}>Channel Number Mode</option>
            <option value={2}>Channel Name Mode</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">TX Subaudio Tone</label>
          <div className="flex items-center gap-1.5">
            <select
              value={vfo.txToneType}
              onChange={(e) => {
                const t = e.target.value as ToneType;
                onUpdate({
                  ...vfo,
                  txToneType: t,
                  txToneValue: t === 'CTCSS' ? 100.0 : t.startsWith('DCS') ? 23 : 67.0,
                });
              }}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
            >
              <option value="None">Off</option>
              <option value="CTCSS">CTCSS</option>
              <option value="DCS_N">DCS-N</option>
              <option value="DCS_I">DCS-I</option>
            </select>
            {vfo.txToneType === 'CTCSS' && (
              <select
                value={vfo.txToneValue}
                onChange={(e) => onUpdate({ ...vfo, txToneValue: parseFloat(e.target.value) })}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 font-mono text-cyan-300"
              >
                {CTCSS_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.toFixed(1)} Hz
                  </option>
                ))}
              </select>
            )}
            {(vfo.txToneType === 'DCS_N' || vfo.txToneType === 'DCS_I') && (
              <select
                value={vfo.txToneValue}
                onChange={(e) => onUpdate({ ...vfo, txToneValue: parseInt(e.target.value, 10) })}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 font-mono text-emerald-300"
              >
                {DCS_CODES.map((c) => (
                  <option key={c} value={c}>
                    D{String(c).padStart(3, '0')}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">RX Subaudio Tone</label>
          <div className="flex items-center gap-1.5">
            <select
              value={vfo.rxToneType}
              onChange={(e) => {
                const t = e.target.value as ToneType;
                onUpdate({
                  ...vfo,
                  rxToneType: t,
                  rxToneValue: t === 'CTCSS' ? 100.0 : t.startsWith('DCS') ? 23 : 67.0,
                });
              }}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
            >
              <option value="None">Off</option>
              <option value="CTCSS">CTCSS</option>
              <option value="DCS_N">DCS-N</option>
              <option value="DCS_I">DCS-I</option>
            </select>
            {vfo.rxToneType === 'CTCSS' && (
              <select
                value={vfo.rxToneValue}
                onChange={(e) => onUpdate({ ...vfo, rxToneValue: parseFloat(e.target.value) })}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 font-mono text-cyan-300"
              >
                {CTCSS_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.toFixed(1)} Hz
                  </option>
                ))}
              </select>
            )}
            {(vfo.rxToneType === 'DCS_N' || vfo.rxToneType === 'DCS_I') && (
              <select
                value={vfo.rxToneValue}
                onChange={(e) => onUpdate({ ...vfo, rxToneValue: parseInt(e.target.value, 10) })}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 font-mono text-emerald-300"
              >
                {DCS_CODES.map((c) => (
                  <option key={c} value={c}>
                    D{String(c).padStart(3, '0')}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">TX Power</label>
          <select
            value={vfo.power}
            onChange={(e) => onUpdate({ ...vfo, power: e.target.value as TxPower })}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="High">High</option>
            <option value="Middle">Mid</option>
            <option value="Low">Low</option>
          </select>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">Bandwidth & Modulation</label>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={vfo.bandwidth}
              onChange={(e) => onUpdate({ ...vfo, bandwidth: e.target.value as Bandwidth })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
            >
              <option value="Wide">Wide (25K)</option>
              <option value="Narrow">Narrow (12.5K)</option>
            </select>
            <select
              value={vfo.modulation}
              onChange={(e) => onUpdate({ ...vfo, modulation: e.target.value as ModulationMode })}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
            >
              <option value="FM">FM</option>
              <option value="AM">AM</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* SUBSECTION 1: VFO A & VFO B CONFIGURATION (User Requirement #7) */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400" />
            <span>VFO A / VFO B Configuration Subsection</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure the dual VFO transceivers stored in `.Ysf` Header (`0x00AD` & `0x0102`) and Radio EEPROM (`0x11000..0x1105A`).
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {renderVfoCard('VFO A (Upper Band)', '.Ysf 0x00AD • EEPROM 0x11000', vfoA, onChangeVfoA)}
          {renderVfoCard('VFO B (Lower Band)', '.Ysf 0x0102 • EEPROM 0x11030', vfoB, onChangeVfoB)}
        </div>
      </section>

      {/* SUBSECTION 2: SQUELCH, TRANSMIT, VOX & TONE SIGNALING */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Squelch, Transmit Timers & VOX
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Squelch Level (0–9)</label>
              <select
                value={general.squelchLevel}
                onChange={(e) =>
                  onChangeGeneral({ ...general, squelchLevel: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lvl) => (
                  <option key={lvl} value={lvl}>
                    Level {lvl} {lvl === 0 ? '(Open)' : lvl === 3 ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Squelch Mode</label>
              <select
                value={general.squelchMode}
                onChange={(e) =>
                  onChangeGeneral({ ...general, squelchMode: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>Carrier</option>
                <option value={1}>CTCSS / DCS</option>
                <option value={2}>Carrier + CTCSS/DCS</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Time-Out Timer (TOT)</label>
              <select
                value={general.totIndex}
                onChange={(e) =>
                  onChangeGeneral({ ...general, totIndex: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {TOT_LABELS.map((lbl, idx) => (
                  <option key={lbl} value={idx}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">TOT Pre-Alert (TOA)</label>
              <select
                value={general.toaIndex}
                onChange={(e) =>
                  onChangeGeneral({ ...general, toaIndex: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>OFF</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                  <option key={s} value={s}>
                    {s} sec
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">VOX Sensitivity (0–9)</label>
              <select
                value={general.voxLevel}
                onChange={(e) =>
                  onChangeGeneral({ ...general, voxLevel: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>OFF</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lvl) => (
                  <option key={lvl} value={lvl}>
                    Level {lvl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">VOX Delay Time</label>
              <select
                value={general.voxDelayIndex}
                onChange={(e) =>
                  onChangeGeneral({ ...general, voxDelayIndex: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {VOX_DELAY_LABELS.map((lbl, idx) => (
                  <option key={lbl} value={idx}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Subaudio Tail Elimination</label>
              <select
                value={general.subaudioTail}
                onChange={(e) =>
                  onChangeGeneral({ ...general, subaudioTail: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>OFF</option>
                <option value={1}>120 Degrees</option>
                <option value={2}>180 Degrees</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Repeater Burst Tone</label>
              <select
                value={general.burstToneFreq}
                onChange={(e) =>
                  onChangeGeneral({ ...general, burstToneFreq: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>1000 Hz</option>
                <option value={1}>1450 Hz</option>
                <option value={2}>1750 Hz (Standard)</option>
                <option value={3}>2100 Hz</option>
              </select>
            </div>
          </div>
        </section>

        {/* SUBSECTION 3: DISPLAY, SCAN, LED COLORS & POWER SAVING */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Sun className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Display, Scan & Power Management
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Scan Resume Mode</label>
              <select
                value={general.scanMode}
                onChange={(e) =>
                  onChangeGeneral({ ...general, scanMode: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>TO (Time Operated)</option>
                <option value={1}>CO (Carrier Operated)</option>
                <option value={2}>SE (Search Stop)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Priority Scan Channel (0=OFF)</label>
              <input
                type="number"
                min={0}
                max={500}
                value={general.priorityScanChannel}
                onChange={(e) =>
                  onChangeGeneral({
                    ...general,
                    priorityScanChannel: Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0)),
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Backlight Timeout</label>
              <select
                value={general.backlightIndex}
                onChange={(e) =>
                  onChangeGeneral({ ...general, backlightIndex: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {BACKLIGHT_LABELS.map((lbl, idx) => (
                  <option key={lbl} value={idx}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Auto Power Off (APO)</label>
              <select
                value={general.apoIndex}
                onChange={(e) =>
                  onChangeGeneral({ ...general, apoIndex: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {APO_LABELS.map((lbl, idx) => (
                  <option key={lbl} value={idx}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Battery Save Ratio</label>
              <select
                value={general.savingRate}
                onChange={(e) =>
                  onChangeGeneral({ ...general, savingRate: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>1 : 1 (Standard)</option>
                <option value={1}>1 : 2 (Balanced)</option>
                <option value={2}>1 : 4 (Deep Save)</option>
                <option value={3}>1 : 8 (Max Save)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Menu UI Language</label>
              <select
                value={general.language}
                onChange={(e) =>
                  onChangeGeneral({ ...general, language: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={1}>English</option>
                <option value={0}>Chinese</option>
              </select>
            </div>

            {/* LED Colors */}
            <div className="sm:col-span-2 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Standby LED</label>
                <select
                  value={general.waitColor}
                  onChange={(e) =>
                    onChangeGeneral({ ...general, waitColor: parseInt(e.target.value, 10) })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
                >
                  {LED_COLOR_LABELS.map((c, i) => (
                    <option key={c} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">TX LED</label>
                <select
                  value={general.txColor}
                  onChange={(e) =>
                    onChangeGeneral({ ...general, txColor: parseInt(e.target.value, 10) })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
                >
                  {LED_COLOR_LABELS.map((c, i) => (
                    <option key={c} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">RX LED</label>
                <select
                  value={general.rxColor}
                  onChange={(e) =>
                    onChangeGeneral({ ...general, rxColor: parseInt(e.target.value, 10) })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-slate-100"
                >
                  {LED_COLOR_LABELS.map((c, i) => (
                    <option key={c} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* SUBSECTION 4: AUDIO PROMPTS, POWER-ON MESSAGES & IDENTITY */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Volume2 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Audio Tones, Voice Prompts & Toggles
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Voice Prompt Language</label>
              <select
                value={general.voicePrompt}
                onChange={(e) =>
                  onChangeGeneral({ ...general, voicePrompt: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>OFF</option>
                <option value={1}>Chinese Voice</option>
                <option value={2}>English Voice</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Roger Beep</label>
              <select
                value={general.rogerBeep}
                onChange={(e) =>
                  onChangeGeneral({ ...general, rogerBeep: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>OFF</option>
                <option value={1}>Standard Beep</option>
                <option value={2}>1200 Hz Tone</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Emergency Alarm Mode</label>
              <select
                value={general.alarmMode}
                onChange={(e) =>
                  onChangeGeneral({ ...general, alarmMode: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>On-Site Alarm</option>
                <option value={1}>Send Alarm Sound</option>
                <option value={2}>Send Alarm Code</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Keypad Lock Mode</label>
              <select
                value={general.keyLockMode}
                onChange={(e) =>
                  onChangeGeneral({ ...general, keyLockMode: parseInt(e.target.value, 10) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>Manual Lock</option>
                <option value={1}>Auto Lock</option>
              </select>
            </div>

            {/* Boolean Checkboxes */}
            <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
              {[
                { key: 'dualWatch', label: 'Dual Watch (A+B)' },
                { key: 'batterySave', label: 'Battery Save' },
                { key: 'keypadBeep', label: 'Keypad Beep' },
                { key: 'powerOnBeep', label: 'Power-On Beep' },
                { key: 'channelReport', label: 'Channel Report' },
                { key: 'whisperMode', label: 'Whisper Mic Gain' },
                { key: 'voxControl', label: 'VOX Control' },
                { key: 'refuseAlarm', label: 'Refuse Alarm' },
                { key: 'autoConnectEnabled', label: 'Auto-Connect Check' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 cursor-pointer hover:border-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(general[item.key as keyof GeneralSettingsConfig])}
                    onChange={(e) =>
                      onChangeGeneral({
                        ...general,
                        [item.key]: e.target.checked,
                      })
                    }
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500"
                  />
                  <span className="text-slate-200">{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Power-On Messages, Callsign & Security */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">
              Power-On Display, Callsign & Programming Password
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Power-On Display Mode</label>
              <select
                value={general.powerOnDisplayMode}
                onChange={(e) =>
                  onChangeGeneral({
                    ...general,
                    powerOnDisplayMode: parseInt(e.target.value, 10),
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value={0}>Welcome Picture (Boot Logo)</option>
                <option value={1}>Welcome Message Strings</option>
                <option value={2}>Battery Voltage</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                Radio Callsign / Owner (`eHuHao`, 14 chars)
              </label>
              <input
                type="text"
                maxLength={14}
                value={general.radioCallsign}
                onChange={(e) =>
                  onChangeGeneral({ ...general, radioCallsign: e.target.value.slice(0, 14) })
                }
                placeholder="e.g. W1AW"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-cyan-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                Welcome Message Line 1 (`.Ysf 0xB52B`, 16 chars)
              </label>
              <input
                type="text"
                maxLength={16}
                value={general.powerOnMsgLine1}
                onChange={(e) =>
                  onChangeGeneral({ ...general, powerOnMsgLine1: e.target.value.slice(0, 16) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                Welcome Message Line 2 (`.Ysf 0xB53C`, 20 chars)
              </label>
              <input
                type="text"
                maxLength={20}
                value={general.powerOnMsgLine2}
                onChange={(e) =>
                  onChangeGeneral({ ...general, powerOnMsgLine2: e.target.value.slice(0, 20) })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
              />
            </div>

            {/* 6-Digit Programming Password */}
            <div className="sm:col-span-2 bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <label className="inline-flex items-center gap-2 font-semibold text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={general.passwordEnabled}
                      onChange={(e) =>
                        onChangeGeneral({ ...general, passwordEnabled: e.target.checked })
                      }
                      className="rounded border-slate-700 bg-slate-900 text-amber-500"
                    />
                    <span>Enable 6-Digit Programming Password (`EEPROM 0x16000`)</span>
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Encrypted via `sub_4271E0` 10×6 permutation matrix when written to the radio.
                  </p>
                </div>
              </div>

              {general.passwordEnabled && (
                <input
                  type="text"
                  maxLength={6}
                  value={general.password}
                  onChange={(e) =>
                    onChangeGeneral({
                      ...general,
                      password: e.target.value.replace(/\D/g, '').slice(0, 6),
                    })
                  }
                  placeholder="6 digits (0-9)"
                  className="w-36 bg-slate-900 border border-amber-500/50 rounded-lg px-3 py-1.5 font-mono text-center tracking-widest text-amber-300"
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
