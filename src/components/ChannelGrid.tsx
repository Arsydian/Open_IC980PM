/**
 * @file src/components/ChannelGrid.tsx
 * @description 500-Channel Memory Editor with inline editing, search/band filtering,
 * row reordering, sorting, copy/paste, out-of-band warnings, and a live 85-byte `.Ysf` /
 * 34-byte EEPROM hex inspector.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  Sparkles,
} from 'lucide-react';
import type { ChannelRecord, RadioCodeplug } from '../types/radio';
import { MAX_CHANNELS, YSF_OFFSETS } from '../core/constants';
import { createEmptyChannel, encodeYsfBuffer, getChannelRawYsfBytes } from '../core/ysfCodec';
import { computeChannelEepromAddress, extractChannelEeprom34Bytes } from '../core/eepromCodec';
import { exportChirpCsv } from '../core/chirpCsvCodec';
import { isFrequencyInBand } from '../core/codeplugValidator';
import { ChannelRow, type ChannelUpdater } from './ChannelRow';

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

  // Rows are memoized, so they get an updater whose identity never changes; it reads the current
  // channels and callback at call time. Unchanged channels keep their object identity.
  const latestRef = useRef({ channels, onUpdateChannels });
  latestRef.current = { channels, onUpdateChannels };
  const updateRowChannel = useCallback<ChannelUpdater>((channelNumber, updater) => {
    const { channels: current, onUpdateChannels: update } = latestRef.current;
    update(current.map((ch) => (ch.channelNumber === channelNumber ? updater({ ...ch }) : ch)));
  }, []);

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

  // Compute raw bytes for the inspector panel
  const inspectorData = useMemo(() => {
    if (!showHexInspector) return null;
    const ysf85 = getChannelRawYsfBytes(codeplug, selectedChannelNumber);
    const ysfOffset = YSF_OFFSETS.CHANNELS_START + (selectedChannelNumber - 1) * 85;
    const eepromAddr = computeChannelEepromAddress(selectedChannelNumber);
    const eeprom34 = extractChannelEeprom34Bytes(encodeYsfBuffer(codeplug), selectedChannelNumber);
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
            {filteredChannels.map((ch) => (
              <ChannelRow
                key={ch.channelNumber}
                ch={ch}
                isSelected={ch.channelNumber === selectedChannelNumber}
                bandLimits={bandLimits}
                onSelectChannel={onSelectChannel}
                updateSingleChannel={updateRowChannel}
              />
            ))}
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
