/**
 * @file src/components/ChannelRow.tsx
 * @description One editable row of the 500-channel grid. Memoized: a row re-renders only when its
 * own channel, its selection state or the band limits change, so editing one row does not
 * re-render the other 499.
 */

import React from 'react';
import { AlertTriangle, CloudLightning } from 'lucide-react';
import type {
  BandLimitsConfig,
  Bandwidth,
  ModulationMode,
  PttIdMode,
  ToneType,
  TxPower,
  ChannelRecord,
} from '../types/radio';
import { CTCSS_TONES, DCS_CODES } from '../core/constants';
import { isFrequencyInBand } from '../core/codeplugValidator';
import { applyRxFrequencyEdit, applyTxFrequencyEdit } from '../core/channelEdit';
import { FrequencyInput } from './FrequencyInput';

/** Applies `updater` to channel `channelNumber` (1-based). */
export type ChannelUpdater = (channelNumber: number, updater: (prev: ChannelRecord) => ChannelRecord) => void;

interface ChannelRowProps {
  ch: ChannelRecord;
  isSelected: boolean;
  bandLimits: BandLimitsConfig;
  onSelectChannel: (channelNumber: number) => void;
  /** Must keep the same identity across renders, or every row re-renders. */
  updateSingleChannel: ChannelUpdater;
}

// Format offset badge for a channel
function formatOffsetBadge(ch: ChannelRecord): { text: string; colorClass: string } {
  if (!ch.used || ch.rxFreqHz <= 0) return { text: '—', colorClass: 'text-slate-600' };
  const diff = ch.txFreqHz - ch.rxFreqHz;
  if (diff === 0) {
    return { text: 'Simplex', colorClass: 'text-slate-400 bg-slate-800/80 border-slate-700' };
  }
  const diffMhz = diff / 1_000_000;
  const sign = diff > 0 ? '+' : '';
  return {
    text: `${sign}${diffMhz.toFixed(3)} MHz`,
    colorClass:
      diff > 0
        ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
        : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  };
}

export const ChannelRow = React.memo(function ChannelRow({
  ch,
  isSelected,
  bandLimits,
  onSelectChannel,
  updateSingleChannel,
}: ChannelRowProps) {
  const offsetInfo = formatOffsetBadge(ch);
  const rxInBand = !ch.used || isFrequencyInBand(ch.rxFreqHz, bandLimits);
  const txInBand = !ch.used || isFrequencyInBand(ch.txFreqHz, bandLimits);
  const hasOobWarning = !rxInBand || !txInBand;

  return (
    <tr
      onClick={() => onSelectChannel(ch.channelNumber)}
      className={`transition-colors cursor-pointer ${
        isSelected
          ? 'bg-cyan-500/10 hover:bg-cyan-500/15'
          : ch.used
          ? 'bg-slate-900/40 hover:bg-slate-800/50 text-slate-100'
          : 'bg-transparent hover:bg-slate-900/40 text-slate-500'
      }`}
    >
      {/* Channel Number */}
      <td className="py-1.5 px-3 text-center font-semibold">
        <span
          className={`inline-block w-9 py-0.5 rounded text-[11px] ${
            isSelected
              ? 'bg-cyan-500 text-slate-950 font-bold'
              : ch.used
              ? 'bg-slate-800 text-cyan-300'
              : 'text-slate-600'
          }`}
        >
          {String(ch.channelNumber).padStart(3, '0')}
        </span>
      </td>

      {/* Used Toggle */}
      <td className="py-1.5 px-2 text-center">
        <input
          type="checkbox"
          checked={ch.used}
          onChange={(e) => {
            const checked = e.target.checked;
            updateSingleChannel(ch.channelNumber, (prev) => ({
              ...prev,
              used: checked,
              rxFreqHz: checked && prev.rxFreqHz <= 0 ? 146520000 : prev.rxFreqHz,
              txFreqHz: checked && prev.txFreqHz <= 0 ? 146520000 : prev.txFreqHz,
            }));
          }}
          className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
        />
      </td>

      {/* Channel Name (max 16 chars) */}
      <td className="py-1.5 px-3 font-sans">
        <input
          type="text"
          maxLength={16}
          aria-label={`Channel ${ch.channelNumber} name`}
          value={ch.used ? ch.name : ''}
          placeholder={ch.used ? 'CH NAME' : 'Empty'}
          onChange={(e) => {
            const val = e.target.value.slice(0, 16);
            updateSingleChannel(ch.channelNumber, (prev) => ({
              ...prev,
              used: true,
              rxFreqHz: prev.rxFreqHz > 0 ? prev.rxFreqHz : 146520000,
              txFreqHz: prev.txFreqHz > 0 ? prev.txFreqHz : 146520000,
              name: val,
            }));
          }}
          className="w-full bg-slate-950/90 border border-slate-800 focus:border-cyan-500 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none font-mono"
        />
      </td>

      {/* RX Frequency (MHz) */}
      <td className="py-1.5 px-3">
        <div className="flex items-center gap-1">
          <FrequencyInput
            valueHz={ch.used ? ch.rxFreqHz : 0}
            ariaLabel={`Channel ${ch.channelNumber} RX frequency (MHz)`}
            onCommit={(hz) =>
              updateSingleChannel(ch.channelNumber, (prev) => applyRxFrequencyEdit(prev, hz))
            }
            className={`w-full bg-slate-950/90 border rounded px-2 py-1 text-xs focus:outline-none ${
              !rxInBand
                ? 'border-amber-500/70 text-amber-300'
                : 'border-slate-800 focus:border-cyan-500 text-cyan-200'
            }`}
          />
          {hasOobWarning && (
            <span title="Frequency outside current Band Limits (adjust in Advanced -> Band Unlock)">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </span>
          )}
        </div>
      </td>

      {/* TX Frequency (MHz) */}
      <td className="py-1.5 px-3">
        <FrequencyInput
          valueHz={ch.used ? ch.txFreqHz : 0}
          ariaLabel={`Channel ${ch.channelNumber} TX frequency (MHz)`}
          onCommit={(hz) =>
            updateSingleChannel(ch.channelNumber, (prev) => applyTxFrequencyEdit(prev, hz))
          }
          className={`w-full bg-slate-950/90 border rounded px-2 py-1 text-xs focus:outline-none ${
            !txInBand
              ? 'border-amber-500/70 text-amber-300'
              : 'border-slate-800 focus:border-cyan-500 text-slate-200'
          }`}
        />
      </td>

      {/* Calculated Offset Badge */}
      <td className="py-1.5 px-2 text-center">
        <span
          className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${offsetInfo.colorClass}`}
        >
          {offsetInfo.text}
        </span>
      </td>

      {/* TX Tone (Type + Value) */}
      <td className="py-1.5 px-2">
        {ch.used ? (
          <div className="flex items-center gap-1">
            <select
              value={ch.txToneType}
              onChange={(e) => {
                const newType = e.target.value as ToneType;
                updateSingleChannel(ch.channelNumber, (prev) => ({
                  ...prev,
                  txToneType: newType,
                  txToneValue:
                    newType === 'CTCSS'
                      ? CTCSS_TONES[12] // 100.0 Hz
                      : newType.startsWith('DCS')
                      ? DCS_CODES[0]
                      : CTCSS_TONES[0],
                }));
              }}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="None">Off</option>
              <option value="CTCSS">CTCSS</option>
              <option value="DCS_N">DCS-N</option>
              <option value="DCS_I">DCS-I</option>
            </select>

            {ch.txToneType === 'CTCSS' && (
              <select
                value={ch.txToneValue}
                onChange={(e) =>
                  updateSingleChannel(ch.channelNumber, (prev) => ({
                    ...prev,
                    txToneValue: parseFloat(e.target.value),
                  }))
                }
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-cyan-300 focus:border-cyan-500 focus:outline-none"
              >
                {CTCSS_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.toFixed(1)}
                  </option>
                ))}
              </select>
            )}

            {(ch.txToneType === 'DCS_N' || ch.txToneType === 'DCS_I') && (
              <select
                value={ch.txToneValue}
                onChange={(e) =>
                  updateSingleChannel(ch.channelNumber, (prev) => ({
                    ...prev,
                    txToneValue: parseInt(e.target.value, 10),
                  }))
                }
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-emerald-300 focus:border-cyan-500 focus:outline-none"
              >
                {DCS_CODES.map((c) => (
                  <option key={c} value={c}>
                    D{String(c).padStart(3, '0')}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* RX Tone (Type + Value) */}
      <td className="py-1.5 px-2">
        {ch.used ? (
          <div className="flex items-center gap-1">
            <select
              value={ch.rxToneType}
              onChange={(e) => {
                const newType = e.target.value as ToneType;
                updateSingleChannel(ch.channelNumber, (prev) => ({
                  ...prev,
                  rxToneType: newType,
                  rxToneValue:
                    newType === 'CTCSS'
                      ? CTCSS_TONES[12]
                      : newType.startsWith('DCS')
                      ? DCS_CODES[0]
                      : CTCSS_TONES[0],
                }));
              }}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="None">Off</option>
              <option value="CTCSS">CTCSS</option>
              <option value="DCS_N">DCS-N</option>
              <option value="DCS_I">DCS-I</option>
            </select>

            {ch.rxToneType === 'CTCSS' && (
              <select
                value={ch.rxToneValue}
                onChange={(e) =>
                  updateSingleChannel(ch.channelNumber, (prev) => ({
                    ...prev,
                    rxToneValue: parseFloat(e.target.value),
                  }))
                }
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-cyan-300 focus:border-cyan-500 focus:outline-none"
              >
                {CTCSS_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.toFixed(1)}
                  </option>
                ))}
              </select>
            )}

            {(ch.rxToneType === 'DCS_N' || ch.rxToneType === 'DCS_I') && (
              <select
                value={ch.rxToneValue}
                onChange={(e) =>
                  updateSingleChannel(ch.channelNumber, (prev) => ({
                    ...prev,
                    rxToneValue: parseInt(e.target.value, 10),
                  }))
                }
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-emerald-300 focus:border-cyan-500 focus:outline-none"
              >
                {DCS_CODES.map((c) => (
                  <option key={c} value={c}>
                    D{String(c).padStart(3, '0')}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* TX Power */}
      <td className="py-1.5 px-2 font-sans">
        {ch.used ? (
          <select
            value={ch.power}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                power: e.target.value as TxPower,
              }))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="High">High</option>
            <option value="Middle">Mid</option>
            <option value="Low">Low</option>
          </select>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Bandwidth */}
      <td className="py-1.5 px-2 font-sans">
        {ch.used ? (
          <select
            value={ch.bandwidth}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                bandwidth: e.target.value as Bandwidth,
              }))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="Wide">Wide</option>
            <option value="Narrow">Narrow</option>
          </select>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Modulation (FM / AM) */}
      <td className="py-1.5 px-2 font-sans">
        {ch.used ? (
          <select
            value={ch.modulation}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                modulation: e.target.value as ModulationMode,
              }))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="FM">FM</option>
            <option value="AM">AM</option>
          </select>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Scan Add */}
      <td className="py-1.5 px-2 text-center">
        {ch.used ? (
          <input
            type="checkbox"
            checked={ch.scanAdd}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                scanAdd: e.target.checked,
              }))
            }
            className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
          />
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Busy Channel Lockout (BCL) */}
      <td className="py-1.5 px-2 text-center">
        {ch.used ? (
          <input
            type="checkbox"
            checked={ch.bcl}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                bcl: e.target.checked,
              }))
            }
            className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
          />
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Hardware NOAA Flag (Byte 59 Bit 4) */}
      <td className="py-1.5 px-2 text-center">
        {ch.used ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                noaaFlag: !prev.noaaFlag,
              }));
            }}
            title="Toggle Hardware NOAA Weather / Vague Subaudio Flag (Byte 59 Bit 4)"
            className={`p-1 rounded border transition-colors ${
              ch.noaaFlag
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-600 hover:text-slate-400'
            }`}
          >
            <CloudLightning className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* PTT-ID */}
      <td className="py-1.5 px-2 font-sans">
        {ch.used ? (
          <select
            value={ch.pttId}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                pttId: e.target.value as PttIdMode,
              }))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="Off">Off</option>
            <option value="BOT">BOT</option>
            <option value="EOT">EOT</option>
            <option value="BOTH">BOTH</option>
          </select>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>

      {/* Scramble (0..8) */}
      <td className="py-1.5 px-2 font-sans">
        {ch.used ? (
          <select
            value={ch.scramble}
            onChange={(e) =>
              updateSingleChannel(ch.channelNumber, (prev) => ({
                ...prev,
                scramble: parseInt(e.target.value, 10),
              }))
            }
            className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value={0}>Off</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                #{n}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate-700">—</span>
        )}
      </td>
    </tr>
  );
});
