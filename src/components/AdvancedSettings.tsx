/**
 * @file src/components/AdvancedSettings.tsx
 * @description Advanced Settings submenu under Settings (User Requirement #7 & Features):
 * 1. Cross-Band Repeater Presets (`7` slots at `.Ysf` `0xB573` + Repeater Switch `0xB571`)
 * 2. DTMF Signaling, Remote Stun/Kill/Revive, 15 Memory Groups & 15 Address Book Contacts
 * 3. Band Unlock / Frequency Limits (`VHF Min/Max` & `UHF Min/Max` + Out-of-Band Channel Validator)
 * 4. RF Calibration Inspector & Backup (`775`-byte hardware block `0x18000..0x18306`)
 */

import React, { useState } from 'react';
import {
  Repeat,
  Hash,
  Unlock,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Download,
  Upload,
} from 'lucide-react';
import type {
  BandLimitsConfig,
  ChannelRecord,
  CrossBandRepeaterSlot,
  DtmfConfig,
  GeneralSettingsConfig,
  ToneType,
  TxPower,
} from '../types/radio';
import { CTCSS_TONES, DCS_CODES, RF_CALIBRATION_SIZE } from '../core/constants';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../core/backupBundle';
import { applyBandLimitEdit, isFrequencyInBand } from '../core/codeplugValidator';
import { toneValueForType } from '../core/channelEdit';
import { FrequencyInput } from './FrequencyInput';
import { FileOnlyNote } from './FileOnlyNote';
import {
  DTMF_CONTACT_NAME_MAX,
  maxDtmfContactCodeLength,
  sanitizeDtmfContactName,
} from '../core/ysfCodec';

interface AdvancedSettingsProps {
  general: GeneralSettingsConfig;
  crossBandSlots: CrossBandRepeaterSlot[];
  dtmf: DtmfConfig;
  bandLimits: BandLimitsConfig;
  channels: ChannelRecord[];
  rfCalibrationBase64?: string;
  onChangeGeneral: (updated: GeneralSettingsConfig) => void;
  onChangeCrossBandSlots: (slots: CrossBandRepeaterSlot[]) => void;
  onChangeDtmf: (dtmf: DtmfConfig) => void;
  onChangeBandLimits: (limits: BandLimitsConfig) => void;
  onChangeCalibration: (base64?: string) => void;
}

export type AdvancedSubTab = 'crossband' | 'dtmf' | 'bandunlock' | 'calibration';

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  general,
  crossBandSlots,
  dtmf,
  bandLimits,
  channels,
  rfCalibrationBase64,
  onChangeGeneral,
  onChangeCrossBandSlots,
  onChangeDtmf,
  onChangeBandLimits,
  onChangeCalibration,
}) => {
  const [subTab, setSubTab] = useState<AdvancedSubTab>('crossband');
  const [bandLimitError, setBandLimitError] = useState<string | null>(null);

  const updateBandLimits = (limits: BandLimitsConfig) => {
    setBandLimitError(null);
    onChangeBandLimits(limits);
  };

  /** Commits one band-limit field, refusing values that are out of range or not below their maximum. */
  const commitBandLimit = (field: keyof BandLimitsConfig, hz: number) => {
    const result = applyBandLimitEdit(bandLimits, field, hz / 1_000_000);
    if ('error' in result) {
      setBandLimitError(result.error);
    } else {
      updateBandLimits(result.limits);
    }
  };

  const updateCrossBandSlot = (idx: number, updater: (prev: CrossBandRepeaterSlot) => CrossBandRepeaterSlot) => {
    const next = crossBandSlots.map((s, i) => (i === idx ? updater({ ...s }) : s));
    onChangeCrossBandSlots(next);
  };

  // Out-of-band channel validator for Band Unlock tab
  const outOfBandChannels = channels.filter((ch) => {
    if (!ch.used || ch.rxFreqHz <= 0) return false;
    return !isFrequencyInBand(ch.rxFreqHz, bandLimits) || !isFrequencyInBand(ch.txFreqHz, bandLimits);
  });

  const handleExportCalibration = () => {
    if (!rfCalibrationBase64) return;
    const bytes = base64ToUint8Array(rfCalibrationBase64);
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_RF_Calibration_${new Date().toISOString().slice(0, 10)}.cal`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCalibration = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(reader.result);
        onChangeCalibration(uint8ArrayToBase64(bytes.slice(0, RF_CALIBRATION_SIZE)));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Advanced Settings Sub-Menu Bar */}
      <div className="px-6 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h2 className="text-sm font-bold text-slate-100">
            Advanced Settings Submenu
          </h2>
          <p className="text-[11px] text-slate-400">
            Cross-Band Repeater Presets, DTMF Signaling & Address Book, Band Unlock / Frequency Limits, and RF Calibration
          </p>
        </div>

        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs flex-wrap">
          <button
            type="button"
            onClick={() => setSubTab('crossband')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              subTab === 'crossband'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Cross-Band Repeater</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('dtmf')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              subTab === 'dtmf'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span>DTMF & Address Book</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('bandunlock')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              subTab === 'bandunlock'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Band Unlock / Limits</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('calibration')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              subTab === 'calibration'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>RF Calibration</span>
          </button>
        </div>
      </div>

      {/* Sub-Menu Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* SUB-TAB 1: CROSS-BAND REPEATER PRESETS */}
        {subTab === 'crossband' && (
          <div className="space-y-5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-cyan-400" />
                  <span>Cross-Band Repeater Switch & 7 Preset Slots (`.Ysf 0xB573`)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Configure the active cross-band repeater mode (`EEPROM 0x120E5`) and up to 7 VHF↔UHF cross-band repeater frequency pairs.
                </p>
                <FileOnlyNote>
                  The switch is written to the radio, but the 7 preset slots below are saved in the .Ysf file only:
                  their location in radio memory is not known yet, so the radio keeps using its own stored presets.
                </FileOnlyNote>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="font-semibold text-slate-300">
                  Cross-Band Repeater Switch:
                </label>
                <select
                  value={general.crossBandRepeaterSwitch}
                  onChange={(e) =>
                    onChangeGeneral({
                      ...general,
                      crossBandRepeaterSwitch: parseInt(e.target.value, 10),
                    })
                  }
                  className="bg-slate-950 border border-cyan-500/40 rounded-xl px-3 py-2 text-cyan-300 font-semibold"
                >
                  <option value={0}>OFF (Normal Transceiver Mode)</option>
                  {crossBandSlots.map((slot) => (
                    <option key={slot.slotNumber} value={slot.slotNumber}>
                      Active Slot #{slot.slotNumber} ({slot.name})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                  <tr>
                    <th className="py-3 px-4 w-16">Slot #</th>
                    <th className="py-3 px-4 w-44">Preset Name</th>
                    <th className="py-3 px-4 w-40">Band A Freq (MHz)</th>
                    <th className="py-3 px-4 w-44">Band A Tone</th>
                    <th className="py-3 px-4 w-40">Band B Freq (MHz)</th>
                    <th className="py-3 px-4 w-44">Band B Tone</th>
                    <th className="py-3 px-4 w-32">Power</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {crossBandSlots.map((slot, idx) => (
                    <tr key={slot.slotNumber} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-bold text-cyan-400">
                        #{slot.slotNumber}
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        <input
                          type="text"
                          maxLength={10}
                          value={slot.name}
                          onChange={(e) =>
                            updateCrossBandSlot(idx, (prev) => ({
                              ...prev,
                              name: e.target.value.slice(0, 10),
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="0.005"
                          value={Number((slot.freqAHz / 1_000_000).toFixed(5))}
                          onChange={(e) => {
                            const m = parseFloat(e.target.value);
                            if (Number.isFinite(m) && m > 0) {
                              updateCrossBandSlot(idx, (prev) => ({
                                ...prev,
                                freqAHz: Math.round(m * 1_000_000),
                              }));
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-cyan-200"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1">
                          <select
                            value={slot.toneAType}
                            aria-label={`Slot ${slot.slotNumber} band A tone type`}
                            onChange={(e) => {
                              const toneAType = e.target.value as ToneType;
                              updateCrossBandSlot(idx, (prev) => ({
                                ...prev,
                                toneAType,
                                toneAValue: toneValueForType(toneAType, prev.toneAValue),
                              }));
                            }}
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
                          >
                            <option value="None">Off</option>
                            <option value="CTCSS">CTCSS</option>
                            <option value="DCS_N">DCS-N</option>
                            <option value="DCS_I">DCS-I</option>
                          </select>
                          {slot.toneAType === 'CTCSS' && (
                            <select
                              value={slot.toneAValue}
                              onChange={(e) =>
                                updateCrossBandSlot(idx, (prev) => ({
                                  ...prev,
                                  toneAValue: parseFloat(e.target.value),
                                }))
                              }
                              className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-cyan-300"
                            >
                              {CTCSS_TONES.map((t) => (
                                <option key={t} value={t}>
                                  {t.toFixed(1)}
                                </option>
                              ))}
                            </select>
                          )}
                          {slot.toneAType.startsWith('DCS') && (
                            <select
                              value={slot.toneAValue}
                              onChange={(e) =>
                                updateCrossBandSlot(idx, (prev) => ({
                                  ...prev,
                                  toneAValue: parseInt(e.target.value, 10),
                                }))
                              }
                              className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-emerald-300"
                            >
                              {DCS_CODES.map((c) => (
                                <option key={c} value={c}>
                                  D{String(c).padStart(3, '0')}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="0.005"
                          value={Number((slot.freqBHz / 1_000_000).toFixed(5))}
                          onChange={(e) => {
                            const m = parseFloat(e.target.value);
                            if (Number.isFinite(m) && m > 0) {
                              updateCrossBandSlot(idx, (prev) => ({
                                ...prev,
                                freqBHz: Math.round(m * 1_000_000),
                              }));
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-emerald-200"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1">
                          <select
                            value={slot.toneBType}
                            aria-label={`Slot ${slot.slotNumber} band B tone type`}
                            onChange={(e) => {
                              const toneBType = e.target.value as ToneType;
                              updateCrossBandSlot(idx, (prev) => ({
                                ...prev,
                                toneBType,
                                toneBValue: toneValueForType(toneBType, prev.toneBValue),
                              }));
                            }}
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
                          >
                            <option value="None">Off</option>
                            <option value="CTCSS">CTCSS</option>
                            <option value="DCS_N">DCS-N</option>
                            <option value="DCS_I">DCS-I</option>
                          </select>
                          {slot.toneBType === 'CTCSS' && (
                            <select
                              value={slot.toneBValue}
                              onChange={(e) =>
                                updateCrossBandSlot(idx, (prev) => ({
                                  ...prev,
                                  toneBValue: parseFloat(e.target.value),
                                }))
                              }
                              className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-cyan-300"
                            >
                              {CTCSS_TONES.map((t) => (
                                <option key={t} value={t}>
                                  {t.toFixed(1)}
                                </option>
                              ))}
                            </select>
                          )}
                          {slot.toneBType.startsWith('DCS') && (
                            <select
                              value={slot.toneBValue}
                              onChange={(e) =>
                                updateCrossBandSlot(idx, (prev) => ({
                                  ...prev,
                                  toneBValue: parseInt(e.target.value, 10),
                                }))
                              }
                              className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-emerald-300"
                            >
                              {DCS_CODES.map((c) => (
                                <option key={c} value={c}>
                                  D{String(c).padStart(3, '0')}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        <select
                          value={slot.power}
                          onChange={(e) =>
                            updateCrossBandSlot(idx, (prev) => ({
                              ...prev,
                              power: e.target.value as TxPower,
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100"
                        >
                          <option value="High">High</option>
                          <option value="Middle">Middle</option>
                          <option value="Low">Low</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: DTMF SIGNALING & ADDRESS BOOK */}
        {subTab === 'dtmf' && (
          <div className="space-y-6">
            {/* DTMF Global Timing & Stun/Kill/Revive Codes */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Hash className="w-4 h-4 text-cyan-400" />
                <span>DTMF Global Timing, Local ID & Remote Stun / Kill / Revive (`EEPROM 0x12082..0x120C4`)</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">DTMF Side Tone</label>
                  <select
                    value={dtmf.sideTone}
                    onChange={(e) => onChangeDtmf({ ...dtmf, sideTone: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value={0}>OFF</option>
                    <option value={1}>DT-ST (Key Side Tone)</option>
                    <option value={2}>ANI-ST (Auto ID Side Tone)</option>
                    <option value={3}>DT-ST + ANI-ST</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Group Call Wildcard</label>
                  <select
                    value={dtmf.groupCode}
                    onChange={(e) => onChangeDtmf({ ...dtmf, groupCode: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value={0}>Off</option>
                    <option value={1}>A</option>
                    <option value={2}>B</option>
                    <option value={3}>C</option>
                    <option value={4}>D</option>
                    <option value={5}>*</option>
                    <option value={6}>#</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Tone Duration (ms)</label>
                  <select
                    value={dtmf.continueTime}
                    onChange={(e) => onChangeDtmf({ ...dtmf, continueTime: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value={0}>50 ms</option>
                    <option value={1}>100 ms</option>
                    <option value={2}>150 ms</option>
                    <option value={3}>200 ms</option>
                    <option value={4}>250 ms</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Inter-Digit Interval (ms)</label>
                  <select
                    value={dtmf.intervalTime}
                    onChange={(e) => onChangeDtmf({ ...dtmf, intervalTime: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value={0}>50 ms</option>
                    <option value={1}>100 ms</option>
                    <option value={2}>150 ms</option>
                    <option value={3}>200 ms</option>
                    <option value={4}>250 ms</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Local DTMF ID (Max 16)</label>
                  <input
                    type="text"
                    maxLength={16}
                    value={dtmf.localId}
                    onChange={(e) =>
                      onChangeDtmf({
                        ...dtmf,
                        localId: e.target.value.toUpperCase().replace(/[^0-9A-D*#]/g, '').slice(0, 16),
                      })
                    }
                    placeholder="e.g. 101"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-cyan-200"
                  />
                  <FileOnlyNote>
                    Saved in the .Ysf file only. Writing to the radio does not change its local ID, because its
                    location in radio memory is not known yet.
                  </FileOnlyNote>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Remote Stun Code (`0x1208F`)</label>
                  <input
                    type="text"
                    maxLength={16}
                    value={dtmf.stunCode}
                    onChange={(e) =>
                      onChangeDtmf({
                        ...dtmf,
                        stunCode: e.target.value.toUpperCase().replace(/[^0-9A-D*#]/g, '').slice(0, 16),
                      })
                    }
                    placeholder="Empty = Disabled"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-amber-200"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Remote Kill Code (`0x120A0`)</label>
                  <input
                    type="text"
                    maxLength={16}
                    value={dtmf.killCode}
                    onChange={(e) =>
                      onChangeDtmf({
                        ...dtmf,
                        killCode: e.target.value.toUpperCase().replace(/[^0-9A-D*#]/g, '').slice(0, 16),
                      })
                    }
                    placeholder="Empty = Disabled"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-rose-200"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Remote Revive Code (`0x120B1`)</label>
                  <input
                    type="text"
                    maxLength={16}
                    value={dtmf.reviveCode}
                    onChange={(e) =>
                      onChangeDtmf({
                        ...dtmf,
                        reviveCode: e.target.value.toUpperCase().replace(/[^0-9A-D*#]/g, '').slice(0, 16),
                      })
                    }
                    placeholder="Empty = Disabled"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-emerald-200"
                  />
                </div>
              </div>
            </div>

            {/* 15 DTMF Memory Groups & 15 Address Book Contacts (`EEPROM 0x15000..0x151FD`) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                <h4 className="text-sm font-bold text-slate-100">
                  15 DTMF PTT-ID Memory Groups (`.Ysf 0xB32D`)
                </h4>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {dtmf.groups.map((grp, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs">
                      <span className="w-20 font-mono text-slate-400">Group #{idx + 1}</span>
                      <input
                        type="text"
                        maxLength={16}
                        value={grp}
                        onChange={(e) => {
                          const nextGroups = [...dtmf.groups];
                          nextGroups[idx] = e.target.value
                            .toUpperCase()
                            .replace(/[^0-9A-D*#]/g, '')
                            .slice(0, 16);
                          onChangeDtmf({ ...dtmf, groups: nextGroups });
                        }}
                        placeholder="DTMF sequence (0-9, A-D, *, #)"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 font-mono text-cyan-200"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                <h4 className="text-sm font-bold text-slate-100">
                  15 DTMF Address Book Contacts (`EEPROM 0x15100`)
                </h4>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {dtmf.contacts.map((ct, idx) => (
                    <div key={ct.index} className="grid grid-cols-12 gap-2 items-center text-xs">
                      <span className="col-span-2 font-mono text-slate-400">#{ct.index}</span>
                      <input
                        type="text"
                        maxLength={DTMF_CONTACT_NAME_MAX}
                        value={ct.name}
                        aria-label={`Contact ${ct.index} name`}
                        onChange={(e) => {
                          const nextContacts = [...dtmf.contacts];
                          const name = sanitizeDtmfContactName(e.target.value);
                          // A longer name leaves less room for the code in the shared 16-byte slot
                          const code = ct.code.slice(0, maxDtmfContactCodeLength(name));
                          nextContacts[idx] = { ...ct, name, code };
                          onChangeDtmf({ ...dtmf, contacts: nextContacts });
                        }}
                        placeholder="Contact Name"
                        className="col-span-5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100"
                      />
                      <input
                        type="text"
                        maxLength={maxDtmfContactCodeLength(ct.name)}
                        value={ct.code}
                        aria-label={`Contact ${ct.index} DTMF code`}
                        onChange={(e) => {
                          const nextContacts = [...dtmf.contacts];
                          nextContacts[idx] = {
                            ...ct,
                            code: e.target.value
                              .toUpperCase()
                              .replace(/[^0-9A-D*#]/g, '')
                              .slice(0, maxDtmfContactCodeLength(ct.name)),
                          };
                          onChangeDtmf({ ...dtmf, contacts: nextContacts });
                        }}
                        placeholder="DTMF ID"
                        className="col-span-5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-emerald-300"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: BAND UNLOCK / FREQUENCY LIMITS */}
        {subTab === 'bandunlock' && (
          <div className="space-y-6">
            <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Unlock className="w-4 h-4 text-amber-400" />
                    <span>Hardware Frequency Band Limits & Band Unlock (`.Ysf 0xB786` / `EEPROM 0x12006`)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Controls the VHF (`V_min..V_max`) and UHF (`U_min..U_max`) frequency limits written to `.Ysf` `0xB786..0xB7C5` and Radio EEPROM `0x12006..0x12015`.
                  </p>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      updateBandLimits({
                        vhfMinMhz: 144.0,
                        vhfMaxMhz: 148.0,
                        uhfMinMhz: 420.0,
                        uhfMaxMhz: 450.0,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    US Amateur (144–148 / 420–450)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBandLimits({
                        vhfMinMhz: 136.0,
                        vhfMaxMhz: 174.0,
                        uhfMinMhz: 400.0,
                        uhfMaxMhz: 480.0,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30"
                  >
                    Factory Default (136–174 / 400–480)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBandLimits({
                        vhfMinMhz: 136.0,
                        vhfMaxMhz: 174.0,
                        uhfMinMhz: 400.0,
                        uhfMaxMhz: 520.0,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30"
                  >
                    Expanded UHF (136–174 / 400–520)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs pt-2">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <label className="block text-slate-400 mb-1">
                    VHF Minimum (`V_min`, MHz)
                  </label>
                  <FrequencyInput
                    valueHz={bandLimits.vhfMinMhz * 1_000_000}
                    ariaLabel="VHF minimum (MHz)"
                    onCommit={(hz) => commitBandLimit('vhfMinMhz', hz)}
                    onInvalid={(text) => setBandLimitError(`"${text}" is not a frequency in MHz.`)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-cyan-300"
                  />
                  <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                    EEPROM 0x12006 (u32 10Hz)
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <label className="block text-slate-400 mb-1">
                    VHF Maximum (`V_max`, MHz)
                  </label>
                  <FrequencyInput
                    valueHz={bandLimits.vhfMaxMhz * 1_000_000}
                    ariaLabel="VHF maximum (MHz)"
                    onCommit={(hz) => commitBandLimit('vhfMaxMhz', hz)}
                    onInvalid={(text) => setBandLimitError(`"${text}" is not a frequency in MHz.`)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-cyan-300"
                  />
                  <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                    EEPROM 0x1200A (u32 10Hz)
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <label className="block text-slate-400 mb-1">
                    UHF Minimum (`U_min`, MHz)
                  </label>
                  <FrequencyInput
                    valueHz={bandLimits.uhfMinMhz * 1_000_000}
                    ariaLabel="UHF minimum (MHz)"
                    onCommit={(hz) => commitBandLimit('uhfMinMhz', hz)}
                    onInvalid={(text) => setBandLimitError(`"${text}" is not a frequency in MHz.`)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-emerald-300"
                  />
                  <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                    EEPROM 0x1200E (u32 10Hz)
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <label className="block text-slate-400 mb-1">
                    UHF Maximum (`U_max`, MHz)
                  </label>
                  <FrequencyInput
                    valueHz={bandLimits.uhfMaxMhz * 1_000_000}
                    ariaLabel="UHF maximum (MHz)"
                    onCommit={(hz) => commitBandLimit('uhfMaxMhz', hz)}
                    onInvalid={(text) => setBandLimitError(`"${text}" is not a frequency in MHz.`)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-emerald-300"
                  />
                  <span className="text-[10px] font-mono text-slate-500 mt-1 block">
                    EEPROM 0x12012 (u32 10Hz)
                  </span>
                </div>
              </div>

              {bandLimitError && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{bandLimitError} The previous value was kept.</span>
                </p>
              )}
            </div>

            {/* Live Out-of-Band Channel Validator */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                {outOfBandChannels.length === 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-sm font-bold text-emerald-300">
                      All Programmed Channels Are Within Configured Band Limits
                    </h4>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <h4 className="text-sm font-bold text-amber-300">
                      {outOfBandChannels.length} Channel(s) Outside Current Band Limits
                    </h4>
                  </>
                )}
              </div>

              {outOfBandChannels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {outOfBandChannels.map((ch) => (
                    <span
                      key={ch.channelNumber}
                      className="px-2.5 py-1 rounded-lg text-xs font-mono bg-amber-500/10 border border-amber-500/30 text-amber-200"
                    >
                      CH #{ch.channelNumber} ({ch.name || 'Unnamed'}):{' '}
                      {(ch.rxFreqHz / 1_000_000).toFixed(5)} MHz
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-TAB 4: RF CALIBRATION INSPECTOR & BACKUP */}
        {subTab === 'calibration' && (
          <div className="space-y-5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span>RF Calibration Block (`EEPROM 0x18000..0x18306`, 775 Bytes)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Hardware-specific squelch thresholds, TX APC power curves, and VCO tuning parameters read from `0x18000..0x18306`.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Import .CAL</span>
                  <input
                    type="file"
                    accept=".cal,.bin"
                    onChange={handleImportCalibration}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  disabled={!rfCalibrationBase64}
                  onClick={handleExportCalibration}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export 775B .CAL</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 font-mono text-xs">
              {rfCalibrationBase64 ? (
                <div className="space-y-2">
                  <div className="text-emerald-400 font-semibold">
                    775-Byte RF Calibration Snapshot Present (`0x18000..0x18306`):
                  </div>
                  <div className="text-slate-300 break-all leading-relaxed max-h-80 overflow-y-auto p-3 bg-slate-900 rounded-xl border border-slate-800">
                    {Array.from(base64ToUint8Array(rfCalibrationBase64))
                      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                      .join(' ')}
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 py-8 text-center">
                  No RF Calibration block (`0x18000..0x18306`) loaded yet. Check &ldquo;Include RF Calibration&rdquo; when reading from the radio, or import a saved `.cal` file.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
