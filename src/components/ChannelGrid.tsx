/**
 * @file src/components/ChannelGrid.tsx
 * @description 500-Channel Memory Editor with inline editing, search/band filtering,
 * row reordering, sorting, copy/paste, out-of-band warnings, and a live 85-byte `.Ysf` /
 * 34-byte EEPROM hex inspector.
 */

import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  ClipboardPaste,
  ArrowUpDown,
  FileDown,
  Binary,
  AlertTriangle,
  Sparkles,
  CloudLightning,
} from 'lucide-react';
import type {
  Bandwidth,
  ChannelRecord,
  ModulationMode,
  PttIdMode,
  RadioCodeplug,
  ToneType,
  TxPower,
} from '../types/radio';
import { CTCSS_TONES, DCS_CODES, MAX_CHANNELS, YSF_OFFSETS } from '../core/constants';
import { createEmptyChannel, getChannelRawYsfBytes } from '../core/ysfCodec';
import { computeChannelEepromAddress, extractChannelEeprom34Bytes } from '../core/eepromCodec';
import { exportChirpCsv } from '../core/chirpCsvCodec';
import { isFrequencyInBand } from '../core/codeplugValidator';
import { applyRxFrequencyEdit, applyTxFrequencyEdit } from '../core/channelEdit';
import { FrequencyInput } from './FrequencyInput';

interface ChannelGridProps {
  codeplug: RadioCodeplug;
  selectedChannelNumber: number;
  onSelectChannel: (chNum: number) => void;
  onUpdateChannels: (channels: ChannelRecord[]) => void;
  onOpenImportModal: () => void;
}

type FilterMode = 'all' | 'active' | 'vhf' | 'uhf' | 'oob';

export const ChannelGrid: React.FC<ChannelGridProps> = ({
  codeplug,
  selectedChannelNumber,
  onSelectChannel,
  onUpdateChannels,
  onOpenImportModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [clipboardChannel, setClipboardChannel] = useState<ChannelRecord | null>(null);
  const [showHexInspector, setShowHexInspector] = useState(false);

  const { channels, bandLimits } = codeplug;

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return channels.filter((ch) => {
      if (filterMode === 'active' && !ch.used) return false;
      if (filterMode === 'vhf') {
        if (!ch.used) return false;
        const mhz = ch.rxFreqHz / 1_000_000;
        if (mhz < 100 || mhz > 250) return false;
      }
      if (filterMode === 'uhf') {
        if (!ch.used) return false;
        const mhz = ch.rxFreqHz / 1_000_000;
        if (mhz < 300 || mhz > 600) return false;
      }
      if (filterMode === 'oob') {
        if (!ch.used) return false;
        const rxOk = isFrequencyInBand(ch.rxFreqHz, bandLimits);
        const txOk = isFrequencyInBand(ch.txFreqHz, bandLimits);
        if (rxOk && txOk) return false;
      }

      if (!q) return true;
      const rxStr = ch.used ? (ch.rxFreqHz / 1_000_000).toFixed(5) : '';
      const txStr = ch.used ? (ch.txFreqHz / 1_000_000).toFixed(5) : '';
      const numStr = String(ch.channelNumber);
      const notesStr = (ch.metadata?.notes || ch.metadata?.city || ch.metadata?.callsign || '').toLowerCase();
      return (
        ch.name.toLowerCase().includes(q) ||
        rxStr.includes(q) ||
        txStr.includes(q) ||
        numStr === q ||
        notesStr.includes(q)
      );
    });
  }, [channels, searchQuery, filterMode, bandLimits]);

  const updateSingleChannel = (channelNumber: number, updater: (prev: ChannelRecord) => ChannelRecord) => {
    const next = channels.map((ch) =>
      ch.channelNumber === channelNumber ? updater({ ...ch }) : ch
    );
    onUpdateChannels(next);
  };

  const handleMoveRow = (direction: 'up' | 'down') => {
    const idx = selectedChannelNumber - 1;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= MAX_CHANNELS) return;

    const next = channels.map((c) => ({ ...c }));
    const temp = { ...next[idx], channelNumber: targetIdx + 1 };
    next[idx] = { ...next[targetIdx], channelNumber: idx + 1 };
    next[targetIdx] = temp;
    onUpdateChannels(next);
    onSelectChannel(targetIdx + 1);
  };

  const handleSortActive = (by: 'freq' | 'name') => {
    const programmed = channels.filter((c) => c.used).length;
    if (
      programmed > 1 &&
      !window.confirm(
        `Sort all ${programmed} programmed channels by ${by === 'freq' ? 'frequency' : 'name'}? Channels are renumbered from 1.`
      )
    ) {
      return;
    }
    const active = channels.filter((c) => c.used && c.rxFreqHz > 0);
    if (by === 'freq') {
      active.sort((a, b) => a.rxFreqHz - b.rxFreqHz || a.name.localeCompare(b.name));
    } else {
      active.sort((a, b) => a.name.localeCompare(b.name) || a.rxFreqHz - b.rxFreqHz);
    }

    const next: ChannelRecord[] = [];
    for (let i = 0; i < MAX_CHANNELS; i++) {
      if (i < active.length) {
        next.push({ ...active[i], channelNumber: i + 1 });
      } else {
        next.push(createEmptyChannel(i + 1));
      }
    }
    onUpdateChannels(next);
  };

  const handleCopySelected = () => {
    const ch = channels[selectedChannelNumber - 1];
    if (ch) {
      setClipboardChannel({ ...ch });
    }
  };

  const handlePasteSelected = () => {
    if (!clipboardChannel) return;
    updateSingleChannel(selectedChannelNumber, () => ({
      ...clipboardChannel,
      channelNumber: selectedChannelNumber,
      used: true,
    }));
  };

  const handleClearSelected = () => {
    const ch = channels[selectedChannelNumber - 1];
    if (ch?.used && !window.confirm(`Clear channel ${selectedChannelNumber}${ch.name ? ` "${ch.name}"` : ''}?`)) {
      return;
    }
    updateSingleChannel(selectedChannelNumber, () => createEmptyChannel(selectedChannelNumber));
  };

  const handleClearAllChannels = () => {
    const programmed = channels.filter((c) => c.used).length;
    if (programmed > 0 && !window.confirm(`Clear all ${programmed} programmed channels? This cannot be undone.`)) {
      return;
    }
    const emptyAll = Array.from({ length: MAX_CHANNELS }, (_, idx) => createEmptyChannel(idx + 1));
    onUpdateChannels(emptyAll);
  };

  const handleExportChirpCsv = () => {
    const csvText = exportChirpCsv(channels);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_Channels_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddAtFirstEmpty = () => {
    const firstEmpty = channels.find((c) => !c.used);
    const targetNum = firstEmpty ? firstEmpty.channelNumber : selectedChannelNumber;
    updateSingleChannel(targetNum, (prev) => ({
      ...prev,
      used: true,
      rxFreqHz: 146520000,
      txFreqHz: 146520000,
      name: `CH ${String(targetNum).padStart(3, '0')}`,
    }));
    onSelectChannel(targetNum);
  };

  const selectedCh = channels[selectedChannelNumber - 1] ?? createEmptyChannel(selectedChannelNumber);

  // Format offset badge for a channel
  const formatOffsetBadge = (ch: ChannelRecord): { text: string; colorClass: string } => {
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
  };

  // Compute raw bytes for the inspector panel
  const inspectorData = useMemo(() => {
    if (!showHexInspector) return null;
    const ysf85 = getChannelRawYsfBytes(codeplug, selectedChannelNumber);
    const ysfOffset = YSF_OFFSETS.CHANNELS_START + (selectedChannelNumber - 1) * 85;
    const eepromAddr = computeChannelEepromAddress(selectedChannelNumber);
    const eeprom34 = extractChannelEeprom34Bytes(codeplug.rawYsfBuffer, selectedChannelNumber);
    return { ysf85, ysfOffset, eepromAddr, eeprom34 };
  }, [showHexInspector, codeplug, selectedChannelNumber]);

  const activeCount = useMemo(() => channels.filter((c) => c.used).length, [channels]);

  return (
    <div className="h-full flex flex-col bg-[#090d16] overflow-hidden">
      {/* Top Toolbar: Search, Filter & Batch Actions */}
      <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search & Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, freq, city, callsign..."
              className="w-60 bg-slate-950 border border-slate-700/90 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
            {(
              [
                { id: 'all', label: `All (500)` },
                { id: 'active', label: `Active (${activeCount})` },
                { id: 'vhf', label: '2m / VHF' },
                { id: 'uhf', label: '70cm / UHF' },
                { id: 'oob', label: 'Out-of-Band' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  filterMode === tab.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Channel Manipulation Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={handleAddAtFirstEmpty}
            title="Activate first available empty channel"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Channel</span>
          </button>

          <button
            type="button"
            onClick={() => handleMoveRow('up')}
            disabled={selectedChannelNumber <= 1}
            title="Move Selected Channel Up"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => handleMoveRow('down')}
            disabled={selectedChannelNumber >= MAX_CHANNELS}
            title="Move Selected Channel Down"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopySelected}
            title="Copy Selected Channel"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handlePasteSelected}
            disabled={!clipboardChannel}
            title="Paste into Selected Channel"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => handleSortActive('freq')}
            title="Sort Active Channels by Frequency"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sort Freq</span>
          </button>

          <button
            type="button"
            onClick={() => handleSortActive('name')}
            title="Sort Active Channels by Name"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sort Name</span>
          </button>

          <button
            type="button"
            onClick={handleExportChirpCsv}
            disabled={activeCount === 0}
            title="Export Active Channels to Standard CHIRP CSV"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40"
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleClearSelected}
            title="Clear Selected Channel Slot"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Row</span>
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={handleClearAllChannels}
              title="Clear All 500 Channels"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60"
            >
              <span>Clear All</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowHexInspector((v) => !v)}
            title="Toggle 85B .Ysf / 34B EEPROM Binary Record Inspector"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showHexInspector
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <Binary className="w-3.5 h-3.5" />
            <span>Hex Inspector</span>
          </button>
        </div>
      </div>

      {/* Empty State Quick-Start Callout when 0 channels are programmed */}
      {activeCount === 0 && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500/10 via-slate-900 to-emerald-500/10 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-cyan-400 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-slate-100">
                Clean Codeplug Ready — 0 of 500 Channels Programmed
              </p>
              <p className="text-[11px] text-slate-400">
                Click any row below to enter a frequency manually, or import directly from RepeaterBook API, CHIRP CSV, or Built-in Quick-Packs (NOAA / GMRS / FRS / Calling).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenImportModal}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 transition-colors"
            >
              Open RepeaterBook / CHIRP Importer
            </button>
          </div>
        </div>
      )}

      {/* Main 500-Channel Scrollable Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 select-none">
            <tr>
              <th className="py-2.5 px-3 w-14 text-center">#</th>
              <th className="py-2.5 px-2 w-14 text-center">On</th>
              <th className="py-2.5 px-3 w-44">Name (16 Chars)</th>
              <th className="py-2.5 px-3 w-36">RX Freq (MHz)</th>
              <th className="py-2.5 px-3 w-36">TX Freq (MHz)</th>
              <th className="py-2.5 px-2 w-28 text-center">Offset</th>
              <th className="py-2.5 px-2 w-40">TX Tone (PL/DCS)</th>
              <th className="py-2.5 px-2 w-40">RX Tone (TSQ)</th>
              <th className="py-2.5 px-2 w-24">Power</th>
              <th className="py-2.5 px-2 w-24">BW</th>
              <th className="py-2.5 px-2 w-20">Mod</th>
              <th className="py-2.5 px-2 w-16 text-center">Scan</th>
              <th className="py-2.5 px-2 w-16 text-center">BCL</th>
              <th className="py-2.5 px-2 w-16 text-center" title="Hardware NOAA Flag (Byte 59 Bit 4)">
                NOAA
              </th>
              <th className="py-2.5 px-2 w-24">PTT-ID</th>
              <th className="py-2.5 px-2 w-20">Scram</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
            {filteredChannels.map((ch) => {
              const isSelected = ch.channelNumber === selectedChannelNumber;
              const offsetInfo = formatOffsetBadge(ch);
              const rxInBand = !ch.used || isFrequencyInBand(ch.rxFreqHz, bandLimits);
              const txInBand = !ch.used || isFrequencyInBand(ch.txFreqHz, bandLimits);
              const hasOobWarning = !rxInBand || !txInBand;

              return (
                <tr
                  key={ch.channelNumber}
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
            })}
          </tbody>
        </table>
      </div>

      {/* Collapsible Binary Record Inspector & 8-Digit Custom Subaudio Drawer */}
      {showHexInspector && inspectorData && (
        <div className="bg-slate-950 border-t border-slate-800 p-4 shrink-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Binary className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-200">
                Channel #{String(selectedChannelNumber).padStart(3, '0')} Binary Record Inspector
              </span>
              <span className="text-[11px] font-mono text-cyan-400">
                .Ysf Offset: 0x{inspectorData.ysfOffset.toString(16).toUpperCase().padStart(4, '0')} (85 B)
              </span>
              <span className="text-[11px] font-mono text-emerald-400">
                • EEPROM Addr: 0x{inspectorData.eepromAddr.toString(16).toUpperCase().padStart(5, '0')} (34 B)
              </span>
            </div>

            {/* 8-Digit Custom Subaudio Controls (`Byte 58 Bit 6`) */}
            {selectedCh.used && (
              <div className="flex items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedCh.customSubaudioEnabled}
                    onChange={(e) =>
                      updateSingleChannel(selectedChannelNumber, (prev) => ({
                        ...prev,
                        customSubaudioEnabled: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-700 bg-slate-900 text-amber-500"
                  />
                  <span>8-Digit Custom Subaudio (Byte 58 Bit 6)</span>
                </label>

                {selectedCh.customSubaudioEnabled && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">RX Hex:</span>
                      <input
                        type="text"
                        maxLength={8}
                        value={selectedCh.customRxSubaudioHex}
                        onChange={(e) =>
                          updateSingleChannel(selectedChannelNumber, (prev) => ({
                            ...prev,
                            customRxSubaudioHex: e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase(),
                          }))
                        }
                        className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 font-mono text-amber-300"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">TX Hex:</span>
                      <input
                        type="text"
                        maxLength={8}
                        value={selectedCh.customTxSubaudioHex}
                        onChange={(e) =>
                          updateSingleChannel(selectedChannelNumber, (prev) => ({
                            ...prev,
                            customTxSubaudioHex: e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase(),
                          }))
                        }
                        className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 font-mono text-amber-300"
                      />
                    </div>
                    <span className="text-slate-500">
                      The radio stores 4 hex digits per direction (0000–FFFF); the .Ysf file keeps all 8.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 font-mono text-[11px]">
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
              <div className="text-slate-400 mb-1">
                34-Byte Radio EEPROM Record (`0x{inspectorData.eepromAddr.toString(16).toUpperCase()}`):
              </div>
              <div className="text-emerald-300 break-all leading-relaxed">
                {Array.from(inspectorData.eeprom34)
                  .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                  .join(' ')}
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
              <div className="text-slate-400 mb-1">
                85-Byte `.Ysf` File Record (`0x{inspectorData.ysfOffset.toString(16).toUpperCase()}`):
              </div>
              <div className="text-cyan-300 break-all leading-relaxed">
                {Array.from(inspectorData.ysf85)
                  .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                  .join(' ')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
