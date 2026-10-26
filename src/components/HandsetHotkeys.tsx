/**
 * @file src/components/HandsetHotkeys.tsx
 * @description Interactive Handset Hotkey Configurator for the HIROYASU IC-980 Pro Max
 * (`Key 1`, `Key 2`, `Key 3` Short Press & Long Press).
 *
 * Implements User Requirement #4:
 * - Does NOT force a hardcoded default on the user; provides clean dropdown menus to select
 *   from all hardware functions for each hotkey (`.Ysf` `0xA88C..0xA891`, EEPROM `0x0120C5..0x0120CA`).
 * - Highlights quick-access functions: **Reverse Frequency** (`0x04`) and **Monitor** (`0x01` / `0x02`).
 * - Enforces the hardware mutual-exclusion constraint (`0x0041C23C`): if a key's Long Press is
 *   set to `Monitor Momentary` (`0x02`), its Short Press automatically becomes `Unassigned` (`0x00`).
 */

import React, { useState } from 'react';
import {
  Sliders,
  ArrowLeftRight,
  Volume2,
  Info,
  Zap,
  RotateCcw,
  Radio,
} from 'lucide-react';
import type { HandsetHotkeyConfig, HotkeyLongValue, HotkeyShortValue } from '../types/radio';
import { HOTKEY_LONG_OPTIONS, HOTKEY_SHORT_OPTIONS } from '../core/constants';
import { enforceHotkeyMutualExclusion } from '../core/ysfCodec';

interface HandsetHotkeysProps {
  hotkeys: HandsetHotkeyConfig;
  onChange: (updated: HandsetHotkeyConfig) => void;
}

export const HandsetHotkeys: React.FC<HandsetHotkeysProps> = ({ hotkeys, onChange }) => {
  const [activeKeyHighlight, setActiveKeyHighlight] = useState<1 | 2 | 3 | null>(1);

  const handleShortChange = (keyNum: 1 | 2 | 3, val: HotkeyShortValue) => {
    const next = { ...hotkeys };
    if (keyNum === 1) next.key1Short = val;
    if (keyNum === 2) next.key2Short = val;
    if (keyNum === 3) next.key3Short = val;
    onChange(enforceHotkeyMutualExclusion(next));
  };

  const handleLongChange = (keyNum: 1 | 2 | 3, val: HotkeyLongValue) => {
    const next = { ...hotkeys };
    if (keyNum === 1) next.key1Long = val;
    if (keyNum === 2) next.key2Long = val;
    if (keyNum === 3) next.key3Long = val;
    onChange(enforceHotkeyMutualExclusion(next));
  };

  const getShortLabel = (val: HotkeyShortValue) =>
    HOTKEY_SHORT_OPTIONS.find((o) => o.value === val)?.label || 'Unassigned';

  const getLongLabel = (val: HotkeyLongValue) =>
    HOTKEY_LONG_OPTIONS.find((o) => o.value === val)?.label || 'Unassigned';

  const resetAllUnassigned = () => {
    onChange({
      key1Short: 0x00,
      key1Long: 0x00,
      key2Short: 0x00,
      key2Long: 0x00,
      key3Short: 0x00,
      key3Long: 0x00,
    });
  };

  const keyEntries: Array<{
    keyNum: 1 | 2 | 3;
    title: string;
    physicalLocation: string;
    ysfShortHex: string;
    ysfLongHex: string;
    eepromShortHex: string;
    eepromLongHex: string;
    shortVal: HotkeyShortValue;
    longVal: HotkeyLongValue;
  }> = [
    {
      keyNum: 1,
      title: 'Programmable Key 1 (PF1)',
      physicalLocation: 'Side Key 1 (Below PTT)',
      ysfShortHex: '0xA88C',
      ysfLongHex: '0xA88D',
      eepromShortHex: '0x0120C5',
      eepromLongHex: '0x0120C6',
      shortVal: hotkeys.key1Short,
      longVal: hotkeys.key1Long,
    },
    {
      keyNum: 2,
      title: 'Programmable Key 2 (PF2)',
      physicalLocation: 'Side Key 2 (Lower Side)',
      ysfShortHex: '0xA88E',
      ysfLongHex: '0xA88F',
      eepromShortHex: '0x0120C7',
      eepromLongHex: '0x0120C8',
      shortVal: hotkeys.key2Short,
      longVal: hotkeys.key2Long,
    },
    {
      keyNum: 3,
      title: 'Programmable Key 3 (Top / Front Key)',
      physicalLocation: 'Top / Auxiliary Function Key',
      ysfShortHex: '0xA890',
      ysfLongHex: '0xA891',
      eepromShortHex: '0x0120C9',
      eepromLongHex: '0x0120CA',
      shortVal: hotkeys.key3Short,
      longVal: hotkeys.key3Long,
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-slate-100">
              Handset Programmable Hotkeys (PF1 / PF2 / PF3)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Configure the Short Press and Long Press (Hold) hardware actions for each programmable key on the
            HIROYASU IC-980 Pro Max handset. Select any function from the dropdown menus below—popular operational
            actions like <span className="text-cyan-300 font-medium">Reverse Frequency</span> and{' '}
            <span className="text-emerald-300 font-medium">Monitor</span> are highlighted for quick access.
          </p>
        </div>

        <button
          type="button"
          onClick={resetAllUnassigned}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 self-start md:self-auto shrink-0 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset All to Unassigned</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Visual Handset Diagram */}
        <div className="xl:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Interactive Handset Map
            </span>
            <span className="text-[11px] font-mono text-cyan-400">
              EEPROM 0x0120C5–0x0120CA
            </span>
          </div>

          {/* Stylized Handset SVG / Interactive Diagram */}
          <div className="relative w-full max-w-sm bg-slate-950/90 border border-slate-800/90 rounded-3xl p-6 shadow-2xl">
            {/* Top Antenna & Key 3 */}
            <div className="flex items-end justify-between px-6 mb-3">
              <div className="w-8 h-16 bg-gradient-to-t from-slate-800 to-slate-700 rounded-t-xl border border-slate-600 flex items-center justify-center">
                <span className="text-[9px] font-mono text-slate-400 -rotate-90">ANT</span>
              </div>

              {/* Key 3 Pill */}
              <button
                type="button"
                onClick={() => setActiveKeyHighlight(3)}
                className={`px-3 py-1.5 rounded-t-xl border text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeKeyHighlight === 3
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-lg shadow-amber-500/10'
                    : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Key 3 (PF3)</span>
              </button>

              <div className="w-7 h-9 bg-slate-800 rounded-t-lg border border-slate-700 flex items-center justify-center">
                <span className="text-[9px] font-mono text-slate-400">VOL</span>
              </div>
            </div>

            {/* Main Radio Body */}
            <div className="relative bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 border-2 border-slate-700 rounded-3xl p-4 shadow-inner">
              {/* Left Side: PTT + Key 1 + Key 2 */}
              <div className=" -left-4 top-6 flex flex-col gap-2.5 mb-4">
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-2">
                  <span className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                    PTT (Push-To-Talk)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Hardware TX</span>
                </div>

                {/* Key 1 Interactive Button */}
                <button
                  type="button"
                  onClick={() => setActiveKeyHighlight(1)}
                  className={`w-full text-left rounded-xl p-3 border transition-all ${
                    activeKeyHighlight === 1
                      ? 'bg-cyan-500/15 border-cyan-400 shadow-lg shadow-cyan-500/10'
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-300">Side Key 1 (PF1)</span>
                    <span className="text-[10px] font-mono text-slate-400">0xA88C / 0xA88D</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Short: </span>
                      <span className="text-slate-100 font-medium">{getShortLabel(hotkeys.key1Short)}</span>
                    </div>
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Long: </span>
                      <span className="text-slate-100 font-medium">{getLongLabel(hotkeys.key1Long)}</span>
                    </div>
                  </div>
                </button>

                {/* Key 2 Interactive Button */}
                <button
                  type="button"
                  onClick={() => setActiveKeyHighlight(2)}
                  className={`w-full text-left rounded-xl p-3 border transition-all ${
                    activeKeyHighlight === 2
                      ? 'bg-emerald-500/15 border-emerald-400 shadow-lg shadow-emerald-500/10'
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300">Side Key 2 (PF2)</span>
                    <span className="text-[10px] font-mono text-slate-400">0xA88E / 0xA88F</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Short: </span>
                      <span className="text-slate-100 font-medium">{getShortLabel(hotkeys.key2Short)}</span>
                    </div>
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Long: </span>
                      <span className="text-slate-100 font-medium">{getLongLabel(hotkeys.key2Long)}</span>
                    </div>
                  </div>
                </button>

                {/* Key 3 Summary Card */}
                <button
                  type="button"
                  onClick={() => setActiveKeyHighlight(3)}
                  className={`w-full text-left rounded-xl p-3 border transition-all ${
                    activeKeyHighlight === 3
                      ? 'bg-amber-500/15 border-amber-400 shadow-lg shadow-amber-500/10'
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300">Top / Aux Key 3 (PF3)</span>
                    <span className="text-[10px] font-mono text-slate-400">0xA890 / 0xA891</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Short: </span>
                      <span className="text-slate-100 font-medium">{getShortLabel(hotkeys.key3Short)}</span>
                    </div>
                    <div className="bg-slate-950/80 rounded px-2 py-1 border border-slate-800 truncate">
                      <span className="text-slate-400">Long: </span>
                      <span className="text-slate-100 font-medium">{getLongLabel(hotkeys.key3Long)}</span>
                    </div>
                  </div>
                </button>
              </div>

              {/* Simulated Dual-VFO LCD Screen */}
              <div className="bg-[#081526] border-2 border-cyan-500/30 rounded-xl p-3 font-mono text-xs space-y-1.5 shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-cyan-400 border-b border-cyan-900/50 pb-1">
                  <span>HIROYASU IC-980 PRO MAX</span>
                  <span>H • W • FM</span>
                </div>
                <div className="flex items-center justify-between text-cyan-200 font-bold">
                  <span>A▶ 146.52000</span>
                  <span className="text-[10px] text-emerald-400">2M CALL</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>B  446.00000</span>
                  <span className="text-[10px]">70CM CALL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Hardware Mutual-Exclusion Note */}
          <div className="mt-4 w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-slate-200">Hardware Constraint Verified (`0x0041C23C`):</strong> When a
              key&apos;s Long Press is set to <span className="text-cyan-300 font-mono">Monitor Momentary</span>,
              the radio firmware requires that key&apos;s Short Press to be{' '}
              <span className="text-slate-200 font-mono">Unassigned</span> so the squelch opens immediately on key-down.
            </p>
          </div>
        </div>

        {/* Right Column: Dropdown Selectors for Key 1, Key 2, Key 3 */}
        <div className="xl:col-span-7 space-y-4">
          {keyEntries.map((item) => {
            const isMonitorMomentary = item.longVal === 0x02;
            const isHighlighted = activeKeyHighlight === item.keyNum;

            return (
              <div
                key={item.keyNum}
                onClick={() => setActiveKeyHighlight(item.keyNum)}
                className={`bg-slate-900/90 border rounded-2xl p-5 transition-all ${
                  isHighlighted
                    ? 'border-cyan-500/60 shadow-lg shadow-cyan-500/5'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{item.title}</h3>
                    <p className="text-xs text-slate-400">{item.physicalLocation}</p>
                  </div>

                  {/* Quick-Action Shortcut Pills for Reverse Frequency & Monitor */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShortChange(item.keyNum, 0x04);
                      }}
                      title="Assign Repeater Reverse Frequency (0x04) to Short Press"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                      <span>Short → Reverse Freq</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShortChange(item.keyNum, 0x02);
                      }}
                      title="Assign Monitor (0x02) to Short Press"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Short → Monitor</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLongChange(item.keyNum, 0x01);
                      }}
                      title="Assign Monitor Latching (0x01) to Long Press"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors"
                    >
                      <Radio className="w-3 h-3" />
                      <span>Long → Monitor</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Short Press Dropdown */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor={`key-${item.keyNum}-short`}
                        className="text-xs font-semibold text-slate-300"
                      >
                        Short Press Function
                      </label>
                      <span className="text-[10px] font-mono text-slate-400">
                        .Ysf {item.ysfShortHex} • EEPROM {item.eepromShortHex}
                      </span>
                    </div>
                    <select
                      id={`key-${item.keyNum}-short`}
                      value={item.shortVal}
                      disabled={isMonitorMomentary}
                      onChange={(e) =>
                        handleShortChange(item.keyNum, Number(e.target.value) as HotkeyShortValue)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                    >
                      {HOTKEY_SHORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.highlighted ? `★ ${opt.label}` : opt.label} (0x
                          {opt.value.toString(16).toUpperCase().padStart(2, '0')})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {isMonitorMomentary
                        ? 'Locked to Unassigned because Long Press is set to Monitor Momentary.'
                        : HOTKEY_SHORT_OPTIONS.find((o) => o.value === item.shortVal)?.description}
                    </p>
                  </div>

                  {/* Long Press Dropdown */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor={`key-${item.keyNum}-long`}
                        className="text-xs font-semibold text-slate-300"
                      >
                        Long Press (Hold) Function
                      </label>
                      <span className="text-[10px] font-mono text-slate-400">
                        .Ysf {item.ysfLongHex} • EEPROM {item.eepromLongHex}
                      </span>
                    </div>
                    <select
                      id={`key-${item.keyNum}-long`}
                      value={item.longVal}
                      onChange={(e) =>
                        handleLongChange(item.keyNum, Number(e.target.value) as HotkeyLongValue)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {HOTKEY_LONG_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.highlighted ? `★ ${opt.label}` : opt.label} (0x
                          {opt.value.toString(16).toUpperCase().padStart(2, '0')})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {HOTKEY_LONG_OPTIONS.find((o) => o.value === item.longVal)?.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
