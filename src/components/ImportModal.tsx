/**
 * @file src/components/ImportModal.tsx
 * @description Unified Channel Import Studio for Open_IC980PM:
 * 1. Live RepeaterBook API Importer (US/Canada `export.php` & RoW `exportROW.php`,
 *    State/Province+City OR Lat/Long+Radius, arbitrary Max Results limit, automatic
 *    2m/70cm FM Analog filter, and `City - Callsign` channel naming).
 * 2. CHIRP / Factory CPS CSV File & Clipboard Importer.
 * 3. Built-in Curated Quick-Packs (NOAA Weather WX 1–7 with hardware NOAA bit, GMRS, FRS, Marine, Ham Calling).
 * 4. Channel Insertion Mode Dropdown (`Append to first empty [Default]`, `Insert at selected`, `Overwrite`).
 */

import React, { useState } from 'react';
import {
  X,
  Globe,
  MapPin,
  Navigation,
  FileSpreadsheet,
  Sparkles,
  Search,
  CheckSquare,
  Square,
  Download,
  AlertCircle,
  Loader2,
  CloudLightning,
  ExternalLink,
  KeyRound,
} from 'lucide-react';
import type { ChannelInsertionMode, ChannelRecord, RepeaterBookQuery } from '../types/radio';
import {
  NormalizedRepeaterCandidate,
  US_CA_STATES,
  queryRepeaterBookApi,
} from '../core/repeaterBookClient';
import { parseChirpOrCpsCsv } from '../core/chirpCsvCodec';
import { ALL_QUICK_PACKS, QuickPackDefinition } from '../core/quickPacks';

interface ImportModalProps {
  isOpen: boolean;
  selectedChannelNumber: number;
  onClose: () => void;
  onImportChannels: (
    incoming: ChannelRecord[],
    mode: ChannelInsertionMode,
    targetChannelNumber: number
  ) => void;
}

type ImportTab = 'repeaterbook' | 'chirp' | 'quickpacks';

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  selectedChannelNumber,
  onClose,
  onImportChannels,
}) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('repeaterbook');

  // Insertion Strategy (User Requirement #6: Default = Append to first empty)
  const [insertionMode, setInsertionMode] = useState<ChannelInsertionMode>('append_empty');
  const [targetChannelNum, setTargetChannelNum] = useState<number>(selectedChannelNumber || 1);

  // RepeaterBook Query State (User Requirement #5)
  const [region, setRegion] = useState<'us_ca' | 'row'>('us_ca');
  const [searchMode, setSearchMode] = useState<'location' | 'proximity'>('location');
  const [stateId, setStateId] = useState<string>('06'); // Default California
  const [rowCountry, setRowCountry] = useState<string>('United Kingdom');
  const [cityFilter, setCityFilter] = useState<string>('');
  const [latitude, setLatitude] = useState<string>('37.7749');
  const [longitude, setLongitude] = useState<string>('-122.4194');
  const [radius, setRadius] = useState<string>('35');
  const [distanceUnit, setDistanceUnit] = useState<'miles' | 'km'>('miles');
  const [maxResults, setMaxResults] = useState<string>('50');
  const [openOnly, setOpenOnly] = useState<boolean>(true);
  const [apiToken, setApiToken] = useState<string>(() => {
    try {
      return localStorage.getItem('open_ic980pm_rb_token') || '';
    } catch {
      return '';
    }
  });

  const [isLoadingRb, setIsLoadingRb] = useState<boolean>(false);
  const [rbError, setRbError] = useState<string | null>(null);
  const [rbCandidates, setRbCandidates] = useState<NormalizedRepeaterCandidate[]>([]);
  const [selectedRbIds, setSelectedRbIds] = useState<Set<string>>(new Set());
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  React.useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // CHIRP CSV State
  const [csvText, setCsvText] = useState<string>('');
  const [csvPreview, setCsvPreview] = useState<ChannelRecord[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearchRepeaterBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoadingRb(true);
    setRbError(null);

    try {
      const parsedMax = Math.max(1, Math.min(100, parseInt(maxResults, 10) || 50));
      const query: RepeaterBookQuery = {
        region,
        searchMode,
        country: region === 'row' ? rowCountry.trim() : undefined,
        state: region === 'us_ca' ? stateId : undefined,
        city: searchMode === 'location' ? cityFilter.trim() : undefined,
        latitude: searchMode === 'proximity' ? parseFloat(latitude) : undefined,
        longitude: searchMode === 'proximity' ? parseFloat(longitude) : undefined,
        radius: searchMode === 'proximity' ? parseFloat(radius) : undefined,
        distanceUnit,
        maxResults: parsedMax,
        openOnly,
        apiToken: apiToken.trim() || undefined,
      };

      const results = await queryRepeaterBookApi(query);
      setRbCandidates(results);
      setSelectedRbIds(new Set(results.map((r) => r.id)));
      if (results.length === 0) {
        setRbError(
          'No 2m (144–148 MHz) or 70cm (420–450 MHz) FM Analog repeaters matched your search criteria.'
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to query RepeaterBook API.';
      setRbError(msg);
      if (msg.includes('429')) {
        setCooldownSeconds(60);
      }
    } finally {
      setIsLoadingRb(false);
    }
  };

  const toggleRbSelection = (id: string) => {
    setSelectedRbIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImportSelectedRepeaters = () => {
    const selectedChannels = rbCandidates
      .filter((c) => selectedRbIds.has(c.id))
      .map((c) => c.channelRecord);
    if (selectedChannels.length === 0) return;
    onImportChannels(selectedChannels, insertionMode, targetChannelNum);
    onClose();
  };

  const handleParseCsv = (raw: string) => {
    setCsvText(raw);
    setCsvError(null);
    if (!raw.trim()) {
      setCsvPreview([]);
      return;
    }
    try {
      const parsed = parseChirpOrCpsCsv(raw);
      setCsvPreview(parsed);
      if (parsed.length === 0) {
        setCsvError('No valid channel rows found in CSV.');
      }
    } catch (err) {
      setCsvPreview([]);
      setCsvError(err instanceof Error ? err.message : 'Invalid CSV format.');
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleParseCsv(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleImportCsvChannels = () => {
    if (csvPreview.length === 0) return;
    onImportChannels(csvPreview, insertionMode, targetChannelNum);
    onClose();
  };

  const handleImportQuickPack = (pack: QuickPackDefinition) => {
    onImportChannels(pack.channels, insertionMode, targetChannelNum);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Import Channels — RepeaterBook API, CHIRP CSV & Quick-Packs</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Automatically normalized for the HIROYASU IC-980 Pro Max (`City - Callsign` 16-char naming & 2m/70cm FM Analog filtering)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Insertion Mode Selector Bar (User Requirement #6) */}
        <div className="px-6 py-3 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label htmlFor="insertion-mode-select" className="text-xs font-semibold text-slate-300">
              Channel Insertion Mode:
            </label>
            <select
              id="insertion-mode-select"
              value={insertionMode}
              onChange={(e) => setInsertionMode(e.target.value as ChannelInsertionMode)}
              className="bg-slate-900 border border-cyan-500/40 rounded-lg px-3 py-1.5 text-xs text-cyan-200 font-medium focus:outline-none focus:border-cyan-400"
            >
              <option value="append_empty">
                Append to first empty slot (Default)
              </option>
              <option value="insert_at">
                Insert at selected channel (shift existing down)
              </option>
              <option value="overwrite_at">
                Overwrite starting at selected channel
              </option>
            </select>

            {(insertionMode === 'insert_at' || insertionMode === 'overwrite_at') && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400">Start Channel #:</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={targetChannelNum}
                  onChange={(e) =>
                    setTargetChannelNum(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))
                  }
                  className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Source Tab Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('repeaterbook')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                activeTab === 'repeaterbook'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>RepeaterBook API</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('chirp')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                activeTab === 'chirp'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CHIRP CSV</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('quickpacks')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                activeTab === 'quickpacks'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Quick-Packs</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: REPEATERBOOK API */}
          {activeTab === 'repeaterbook' && (
            <div className="space-y-4">
              {/* RepeaterBook Canonical Attribution Banner */}
              <div className="bg-cyan-500/10 border border-cyan-500/25 rounded-xl px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-cyan-200">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>
                    <strong>Data courtesy of{' '}
                    <a
                      href="https://www.repeaterbook.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-bold hover:text-white"
                    >
                      RepeaterBook.com
                    </a></strong>.
                    {' '}The canonical source for current amateur radio repeater data.
                  </span>
                </div>
                <a
                  href="https://www.repeaterbook.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-white hover:underline shrink-0"
                >
                  <span>RepeaterBook.com</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* RepeaterBook App-Bound API Token (rbuapp_...) */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Personal App-Bound API Token</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    RepeaterBook requires an app-bound token (<code className="text-amber-300 font-mono">rbuapp_...</code>) for distributed applications. Free for all licensed hams.
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <input
                    type="password"
                    value={apiToken}
                    onChange={(e) => {
                      setApiToken(e.target.value);
                      try {
                        localStorage.setItem('open_ic980pm_rb_token', e.target.value);
                      } catch {}
                    }}
                    placeholder="Enter rbuapp_... token"
                    className="w-full md:w-64 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  <a
                    href="https://www.repeaterbook.com/index.php/api-apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-medium whitespace-nowrap transition-colors shrink-0"
                  >
                    <span>Get Token</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <form
                onSubmit={handleSearchRepeaterBook}
                className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-4"
              >
                {/* Row 1: Region Selector (US/CA vs RoW) & Search Mode Toggle (State/City vs Lat/Long+Radius) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Region Selector */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      1. RepeaterBook Region
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setRegion('us_ca')}
                        className={`py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                          region === 'us_ca'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        US / Canada
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegion('row')}
                        className={`py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                          region === 'row'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Rest of World (RoW)
                      </button>
                    </div>
                  </div>

                  {/* Query Mode Toggle */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      2. Search Method
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setSearchMode('location')}
                        className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                          searchMode === 'location'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <MapPin className="w-3 h-3" />
                        <span>State & City</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSearchMode('proximity')}
                        className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                          searchMode === 'proximity'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Navigation className="w-3 h-3" />
                        <span>Lat/Long + Radius</span>
                      </button>
                    </div>
                  </div>

                  {/* Max Results Limit (User Requirement #5) */}
                  <div>
                    <label
                      htmlFor="rb-max-results"
                      className="block text-xs font-semibold text-slate-300 mb-1.5"
                    >
                      3. Limit Max Results (Arbitrary #)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="rb-max-results"
                        type="number"
                        min={1}
                        max={100}
                        value={maxResults}
                        onChange={(e) => setMaxResults(e.target.value)}
                        className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                      <span className="text-[11px] text-slate-400">
                        2m & 70cm FM Analog (Max 100)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Dynamic Inputs for Location vs. Proximity */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 items-end">
                  {region === 'us_ca' ? (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        State / Province
                      </label>
                      <select
                        value={stateId}
                        onChange={(e) => setStateId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                      >
                        {US_CA_STATES.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Country (RoW)
                      </label>
                      <input
                        type="text"
                        value={rowCountry}
                        onChange={(e) => setRowCountry(e.target.value)}
                        placeholder="e.g. United Kingdom, Germany, Australia"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {searchMode === 'location' ? (
                    <div className="md:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">
                        City or County (Optional filter)
                      </label>
                      <input
                        type="text"
                        value={cityFilter}
                        onChange={(e) => setCityFilter(e.target.value)}
                        placeholder="e.g. San Francisco, Los Angeles, Toronto..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Center Latitude
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={latitude}
                          onChange={(e) => setLatitude(e.target.value)}
                          placeholder="37.7749"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Center Longitude
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={longitude}
                          onChange={(e) => setLongitude(e.target.value)}
                          placeholder="-122.4194"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Search Radius
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={radius}
                            onChange={(e) => setRadius(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-100 focus:border-cyan-500 focus:outline-none"
                          />
                          <select
                            value={distanceUnit}
                            onChange={(e) => setDistanceUnit(e.target.value as 'miles' | 'km')}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200"
                          >
                            <option value="miles">mi</option>
                            <option value="km">km</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  {searchMode === 'proximity' && (
                    <div className="md:col-span-4 -mt-1">
                      <p className="text-[11px] text-slate-400 italic">
                        * Proximity radius calculates distance from center coordinates within the selected State/Province or Country.
                      </p>
                    </div>
                  )}

                  {cooldownSeconds > 0 && (
                    <div className="md:col-span-4 p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        RepeaterBook rate limit active (HTTP 429). Search is locked for {cooldownSeconds}s to protect the API.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="submit"
                      disabled={isLoadingRb || cooldownSeconds > 0}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-sm disabled:opacity-50"
                    >
                      {cooldownSeconds > 0 ? (
                        <>
                          <AlertCircle className="w-4 h-4 text-amber-300" />
                          <span>Rate Limited (Wait {cooldownSeconds}s)</span>
                        </>
                      ) : isLoadingRb ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Querying...</span>
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4" />
                          <span>Search Repeaters</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {rbError && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5 text-xs text-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{rbError}</span>
                </div>
              )}

              {/* RepeaterBook Results Table */}
              {rbCandidates.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-300">
                      Found <strong className="text-cyan-300">{rbCandidates.length}</strong> 2m/70cm
                      FM Analog Repeaters ({selectedRbIds.size} selected)
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedRbIds(new Set(rbCandidates.map((c) => c.id)))}
                        className="text-xs text-cyan-400 hover:underline"
                      >
                        Select All
                      </button>
                      <span className="text-slate-700">•</span>
                      <button
                        type="button"
                        onClick={() => setSelectedRbIds(new Set())}
                        className="text-xs text-slate-400 hover:underline"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                        <tr>
                          <th className="py-2 px-3 w-10">Use</th>
                          <th className="py-2 px-3">Channel Name (`City - Callsign`)</th>
                          <th className="py-2 px-3">Band</th>
                          <th className="py-2 px-3">Output (RX)</th>
                          <th className="py-2 px-3">Input (TX)</th>
                          <th className="py-2 px-3">PL / TSQ</th>
                          <th className="py-2 px-3">City / State</th>
                          {searchMode === 'proximity' && <th className="py-2 px-3">Distance</th>}
                          <th className="py-2 px-3 w-16 text-center">Listing</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {rbCandidates.map((item) => {
                          const checked = selectedRbIds.has(item.id);
                          return (
                            <tr
                              key={item.id}
                              onClick={() => toggleRbSelection(item.id)}
                              className={`cursor-pointer transition-colors ${
                                checked ? 'bg-cyan-500/10 hover:bg-cyan-500/15' : 'hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="py-2 px-3">
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-cyan-400" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-600" />
                                )}
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-100">
                                {item.formattedChannelName}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                    item.band === '2m'
                                      ? 'bg-cyan-500/15 text-cyan-300'
                                      : 'bg-emerald-500/15 text-emerald-300'
                                  }`}
                                >
                                  {item.band}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-cyan-300">
                                {(item.rxFreqHz / 1_000_000).toFixed(4)}
                              </td>
                              <td className="py-2 px-3 text-slate-300">
                                {(item.txFreqHz / 1_000_000).toFixed(4)}
                              </td>
                              <td className="py-2 px-3 text-slate-300">
                                {item.txToneType === 'None'
                                  ? 'CSQ'
                                  : item.txToneType === 'CTCSS'
                                  ? `${item.txToneValue.toFixed(1)} Hz`
                                  : `D${String(item.txToneValue).padStart(3, '0')}`}
                              </td>
                              <td className="py-2 px-3 font-sans text-slate-400">
                                {item.city}, {item.state}
                              </td>
                              {searchMode === 'proximity' && (
                                <td className="py-2 px-3 text-amber-300">
                                  {item.distanceMiles !== undefined ? `${item.distanceMiles} mi` : '—'}
                                </td>
                              )}
                              <td className="py-2 px-3 text-center">
                                {item.detailUrl && (
                                  <a
                                    href={item.detailUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View canonical listing on RepeaterBook.com"
                                    className="inline-flex items-center gap-0.5 text-[11px] text-cyan-400 hover:text-cyan-200 hover:underline"
                                  >
                                    <span>Link</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-400">
                      <strong>Data courtesy of RepeaterBook.com.</strong> Links direct to canonical repeater listings.
                    </p>
                    <button
                      type="button"
                      disabled={selectedRbIds.size === 0}
                      onClick={handleImportSelectedRepeaters}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-lg disabled:opacity-40 shrink-0 self-end sm:self-auto"
                    >
                      <Download className="w-4 h-4" />
                      <span>Import {selectedRbIds.size} Selected Repeaters</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CHIRP CSV IMPORT */}
          {activeTab === 'chirp' && (
            <div className="space-y-4">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-200">
                    Load Standard CHIRP CSV or Factory CPS CSV
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Supports Duplex (`+`, `-`, `split`), Offset, CTCSS (`Tone`/`TSQL`), DCS (`DTCS`), CrossMode, Mode (`FM`/`NFM`/`AM`), and Power.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 cursor-pointer shrink-0 transition-colors">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Choose .CSV File</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Or Paste CHIRP CSV Text Below:
                </label>
                <textarea
                  rows={6}
                  value={csvText}
                  onChange={(e) => handleParseCsv(e.target.value)}
                  placeholder={`Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Power,Comment\n1,W6PW RPT,145.150000,-,0.600000,Tone,114.8,88.5,023,NN,FM,5.00,,High,San Francisco`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {csvError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {csvError}
                </div>
              )}

              {csvPreview.length > 0 && (
                <div className="flex items-center justify-between bg-slate-950/90 border border-emerald-500/30 rounded-xl p-4">
                  <div className="text-xs text-slate-200">
                    Ready to import <strong className="text-emerald-400">{csvPreview.length}</strong>{' '}
                    parsed CSV channels using mode:{' '}
                    <span className="font-mono text-cyan-300">{insertionMode}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleImportCsvChannels}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 text-white"
                  >
                    <Download className="w-4 h-4" />
                    <span>Import {csvPreview.length} CSV Channels</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BUILT-IN QUICK-PACKS */}
          {activeTab === 'quickpacks' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ALL_QUICK_PACKS.map((pack) => (
                <div
                  key={pack.id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        {pack.category}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        {pack.channels.length} Channels
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                      {pack.id === 'noaa-wx' && (
                        <CloudLightning className="w-4 h-4 text-amber-400" />
                      )}
                      <span>{pack.name}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {pack.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleImportQuickPack(pack)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-cyan-500/20 text-slate-200 hover:text-cyan-200 border border-slate-700 hover:border-cyan-500/40 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Import {pack.name}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
