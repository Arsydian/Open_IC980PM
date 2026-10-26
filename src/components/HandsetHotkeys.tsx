/**
 * @file src/components/HandsetHotkeys.tsx
 * @description Interactive Handset & Keypad Configurator for the HIROYASU IC-980 Pro Max.
 *
 * Provides:
 * 1. Physical Handset Hardware Reference:
 *    - Accurately depicts the HIROYASU HM-18 hand mic (orange left PTT paddle, top A/B
 *      Main/Sub band selector buttons, front DTMF keypad, and dual status LEDs).
 *    - Built-in `FUN + [0-9]` shortcut reference table.
 * 2. Firmware Codeplug Key Registers (`Key 1`, `Key 2`, `Key 3` Short/Long Press):
 *    - Full dropdown configurators mapping to `.Ysf` `0xA88C..0xA891` (EEPROM `0x0120C5..0x0120CA`).
 *    - Hardware constraint enforcement (`0x0041C23C`): Monitor Momentary automatically sets Short Press to Unassigned.
 *    - Clear hardware architectural notice explaining that these 3 registers are inherited from
 *      the shared OEM 8118 platform and retained for codeplug fidelity.
 */

import React, { useState } from 'react';
import {
  Sliders,
  ArrowLeftRight,
  Volume2,
  Info,
  RotateCcw,
  Radio,
  HelpCircle,
  Hash,
  BookmarkCheck,
  Zap,
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
  const [activeTab, setActiveTab] = useState<'hotkeys' | 'shortcuts'>('hotkeys');

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
    description: string;
    ysfShortHex: string;
    ysfLongHex: string;
    eepromShortHex: string;
    eepromLongHex: string;
    shortVal: HotkeyShortValue;
    longVal: HotkeyLongValue;
  }> = [
    {
      keyNum: 1,
      title: 'Firmware Key 1 (PF1 Register)',
      description: 'Firmware function register 1 (.Ysf 0xA88C / 0xA88D)',
      ysfShortHex: '0xA88C',
      ysfLongHex: '0xA88D',
      eepromShortHex: '0x0120C5',
      eepromLongHex: '0x0120C6',
      shortVal: hotkeys.key1Short,
      longVal: hotkeys.key1Long,
    },
    {
      keyNum: 2,
      title: 'Firmware Key 2 (PF2 Register)',
      description: 'Firmware function register 2 (.Ysf 0xA88E / 0xA88F)',
      ysfShortHex: '0xA88E',
      ysfLongHex: '0xA88F',
      eepromShortHex: '0x0120C7',
      eepromLongHex: '0x0120C8',
      shortVal: hotkeys.key2Short,
      longVal: hotkeys.key2Long,
    },
    {
      keyNum: 3,
      title: 'Firmware Key 3 (Top / PF3 Register)',
      description: 'Firmware function register 3 (.Ysf 0xA890 / 0xA891)',
      ysfShortHex: '0xA890',
      ysfLongHex: '0xA891',
      eepromShortHex: '0x0120C9',
      eepromLongHex: '0x0120CA',
      shortVal: hotkeys.key3Short,
      longVal: hotkeys.key3Long,
    },
  ];

  // Physical mic FUN + [Key] shortcut reference table
  const funShortcuts = [
    { combo: 'FUN + 0', action: 'Save Memory Channel', desc: 'Saves current VFO frequency/tones to a target channel slot' },
    { combo: 'FUN + 1', action: 'Squelch Level (SQL)', desc: 'Adjusts receiver squelch threshold (0–9)' },
    { combo: 'FUN + 2', action: 'TX Output Power', desc: 'Toggles transmit power (High / Low / Mid)' },
    { combo: 'FUN + 3', action: 'Dual Watch', desc: 'Toggles dual standby monitoring between Band A and Band B' },
    { combo: 'FUN + 4', action: 'Crossband Repeater', desc: 'Enters crossband relay configuration / mode' },
    { combo: 'FUN + 5', action: 'RX Subaudio Tone', desc: 'Configures CTCSS / DCS / Inverted DCS receive decoding' },
    { combo: 'FUN + 6', action: 'TX Subaudio Tone', desc: 'Configures CTCSS / DCS encode tone for repeaters' },
    { combo: 'FUN + 7', action: 'FM Broadcast Radio', desc: 'Toggles commercial 65–108 MHz FM broadcast receiver on/off' },
    { combo: 'FUN + 8', action: 'Offset Frequency', desc: 'Sets repeater frequency offset split direction (+ / - / Off)' },
    { combo: 'FUN + 9', action: 'Channel / VFO Scan', desc: 'Initiates or halts frequency / memory scanning' },
    { combo: 'Top Key A', action: 'Main Band (A)', desc: 'Switches transmission and primary control to VFO / Channel A' },
    { combo: 'Top Key B', action: 'Sub Band (B)', desc: 'Switches transmission and primary control to VFO / Channel B' },
  ];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-slate-100">
              Handset Controls & Firmware Hotkeys
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Configure the codeplug function registers (`Key 1`, `Key 2`, `Key 3`) and explore the physical
            HIROYASU HM-18 speaker-mic layout and on-radio keypad shortcuts.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('hotkeys')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              activeTab === 'hotkeys'
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Codeplug Registers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              activeTab === 'shortcuts'
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Mic FUN Shortcuts
          </button>
          <button
            type="button"
            onClick={resetAllUnassigned}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Reset codeplug hotkey registers to Unassigned (0x00)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Hardware Architecture Notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-amber-200">
            Hardware Note: Physical Hand Mic (HM-18) vs. Firmware Registers
          </p>
          <p className="text-slate-300 leading-relaxed">
            The physical HIROYASU speaker-microphone features an <strong>orange PTT paddle on the left</strong>, two{' '}
            <strong>A / B band select buttons on top</strong>, and a standard DTMF keypad on the front. It does not have
            auxiliary side buttons. The <code className="text-amber-300 font-mono">Key 1 / Key 2 / Key 3</code> registers
            below are inherited from the factory <strong>8118 / PROG81LS</strong> firmware platform and are preserved here
            for 100% bit-exact <code className="text-amber-300 font-mono">.Ysf</code> codeplug and EEPROM compatibility.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Realistic HM-18 Speaker-Mic Physical Diagram */}
        <div className="xl:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              HM-18 Handset Layout
            </span>
            <span className="text-[11px] font-mono text-cyan-400">
              Dual-Band Speaker-Mic
            </span>
          </div>

          {/* Realistic Speaker-Mic Housing */}
          <div className="relative w-full max-w-xs bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border-2 border-slate-700 rounded-[36px] p-5 shadow-2xl">
            {/* Top Metal Loop & A/B Buttons */}
            <div className="flex flex-col items-center -mt-8 mb-4">
              {/* Metal Hang-up Loop */}
              <div className="w-10 h-7 border-4 border-slate-400 rounded-t-full bg-transparent mb-1" />

              {/* Top A and B Buttons Bar */}
              <div className="w-full flex items-center justify-center gap-3 bg-slate-800 border border-slate-600 rounded-2xl py-1.5 px-4 shadow-md">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-cyan-500/50 rounded-lg text-cyan-300 text-xs font-bold shadow-inner">
                  <span>Top A</span>
                  <span className="text-[9px] font-normal text-slate-400">(Main VFO)</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 text-xs font-bold shadow-inner">
                  <span>Top B</span>
                  <span className="text-[9px] font-normal text-slate-400">(Sub VFO)</span>
                </div>
              </div>
            </div>

            {/* Left Orange PTT Paddle */}
            <div className="relative">
              <div className="absolute -left-7 top-4 w-4 h-24 bg-gradient-to-r from-orange-600 to-amber-500 rounded-l-xl border-y border-l border-amber-400 shadow-lg flex items-center justify-center">
                <span className="text-[8px] font-extrabold text-slate-950 -rotate-90 tracking-widest uppercase">
                  PTT
                </span>
              </div>

              {/* Front Face Branding & Status LEDs */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black tracking-wider text-slate-100">HIROYASU</span>
                    <span className="text-[9px] font-mono text-slate-400">MIC</span>
                  </div>
                  {/* Dual Status LEDs */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" title="RX Signal LED" />
                    <div className="w-2.5 h-1.5 rounded-full bg-rose-500/40" title="TX Status LED" />
                  </div>
                </div>

                {/* Keypad Grid (4 x 4) */}
                <div className="grid grid-cols-4 gap-1.5 text-center text-xs font-mono select-none">
                  <button
                    type="button"
                    onClick={() => setActiveTab('shortcuts')}
                    className="p-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 font-bold transition-colors"
                  >
                    FUN
                  </button>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">▲</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">▼</div>
                  <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30">EXIT</div>

                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">1</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">2</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">3</div>
                  <div className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-bold">*</div>

                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">4</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">5</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">6</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">0</div>

                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">7</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">8</div>
                  <div className="p-2 rounded-lg bg-slate-900 text-slate-200 border border-slate-800">9</div>
                  <div className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-bold">#</div>
                </div>

                {/* Speaker Holes Texture */}
                <div className="flex flex-col items-center gap-1 pt-1 opacity-40">
                  <div className="flex gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                  </div>
                  <div className="flex gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Cable Strain Relief at Bottom */}
            <div className="w-6 h-4 bg-slate-800 mx-auto rounded-b border border-slate-700 mt-2" />
          </div>

          {/* Quick Info Summary */}
          <div className="mt-4 w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>Self-Definition Combine Keys</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              On the physical radio, you can create custom shortcut macros: press <span className="text-cyan-300 font-mono font-bold">FUN</span>,
              navigate to any menu option, then press and hold any numeric key (<span className="text-slate-200 font-mono">0–9</span>) for 2 seconds
              to bind that menu function to <span className="text-cyan-300 font-mono">FUN + [Number]</span>.
            </p>
          </div>
        </div>

        {/* Right Column: Codeplug Dropdown Selectors OR FUN Shortcut Reference */}
        <div className="xl:col-span-7 space-y-4">
          {activeTab === 'hotkeys' ? (
            <>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Codeplug Registers (OEM 8118 Platform)
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  Total Registers: 6 bytes
                </span>
              </div>

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
                        <p className="text-xs text-slate-400">{item.description}</p>
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
                          <span>Short → Reverse</span>
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
                            {item.ysfShortHex}
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
                            {item.ysfLongHex}
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

              {/* Hardware Mutual-Exclusion Note */}
              <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-200">Firmware Constraint (`0x0041C23C`):</strong> When a
                  key&apos;s Long Press is set to <span className="text-cyan-300 font-mono">Monitor Momentary</span>,
                  the radio firmware requires that key&apos;s Short Press to be{' '}
                  <span className="text-slate-200 font-mono">Unassigned</span> so squelch opens immediately upon button depression.
                </p>
              </div>
            </>
          ) : (
            /* FUN Shortcut Reference Tab */
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-slate-100">
                    Handset Keypad Shortcuts (FUN + Key)
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  HM-18 Hardware Operation
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Key Combination</th>
                      <th className="py-2.5 px-3 font-semibold">Action</th>
                      <th className="py-2.5 px-3 font-semibold">Function Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {funShortcuts.map((sc) => (
                      <tr key={sc.combo} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3 text-cyan-300 font-bold whitespace-nowrap">
                          {sc.combo}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 font-sans font-medium">
                          {sc.action}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-sans text-[11px]">
                          {sc.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 text-slate-200 font-semibold">
                  <BookmarkCheck className="w-4 h-4 text-emerald-400" />
                  <span>Quick Channel Programming Flow</span>
                </div>
                <ol className="list-decimal list-inside text-slate-400 space-y-1 pl-1 leading-relaxed text-[11px]">
                  <li>Press <strong className="text-slate-200">V/M</strong> on the radio front panel to enter VFO mode.</li>
                  <li>Type your target frequency using the numeric keys (<strong className="text-slate-200">0–9</strong>).</li>
                  <li>Press <strong className="text-cyan-300">FUN</strong> then <strong className="text-cyan-300">0</strong> on the microphone.</li>
                  <li>Use <strong className="text-slate-200">▲ / ▼</strong> to select an open channel slot (<code className="text-slate-300">SAVE-&gt;XXX</code>).</li>
                  <li>Press <strong className="text-cyan-300">FUN</strong> again to commit to memory.</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
