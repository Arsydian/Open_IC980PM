/**
 * @file src/App.tsx
 * @description Root application shell for Open_IC980PM.
 * Coordinates the 500-channel grid, General Settings (with VFO A/B subsection),
 * Advanced Settings submenu (Cross-Band Repeater, DTMF, Band Unlock, RF Calibration),
 * Boot Logo Studio, RepeaterBook/CHIRP Importer, and Backup/Rollback Vault.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ListFilter,
  Settings,
  ShieldAlert,
  Image as ImageIcon,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import type {
  BandLimitsConfig,
  ChannelInsertionMode,
  ChannelRecord,
  CrossBandRepeaterSlot,
  DtmfConfig,
  GeneralSettingsConfig,
  RadioCodeplug,
  VfoConfig,
} from './types/radio';
import { MAX_CHANNELS } from './core/constants';
import {
  createDefaultCodeplug,
  decodeYsfBuffer,
  encodeYsfBuffer,
} from './core/ysfCodec';
import { mergeImportedChannels } from './core/chirpCsvCodec';
import { deserializeRichBundle } from './core/backupBundle';
import { TitleBar } from './components/TitleBar';
import { ChannelGrid } from './components/ChannelGrid';
import { GeneralSettings } from './components/GeneralSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { BootLogoStudio } from './components/BootLogoStudio';
import { ImportModal } from './components/ImportModal';
import { BackupVaultModal } from './components/BackupVaultModal';
import { RadioSyncModal } from './components/RadioSyncModal';
import { ErrorBoundary } from './components/ErrorBoundary';

type NavView = 'channels' | 'settings_general' | 'settings_advanced' | 'bootlogo';

type ToastKind = 'success' | 'warning' | 'error';

const TOAST_STYLES: Record<ToastKind, { box: string; icon: string }> = {
  success: { box: 'border-emerald-500/40 text-emerald-200', icon: 'text-emerald-400' },
  warning: { box: 'border-amber-500/50 text-amber-200', icon: 'text-amber-400' },
  error: { box: 'border-rose-500/60 text-rose-200', icon: 'text-rose-400' },
};

export const App: React.FC = () => {
  // Starts with a clean, zero-placeholder codeplug (0 sample/test channels)
  const [codeplug, setCodeplug] = useState<RadioCodeplug>(() => createDefaultCodeplug());
  const [activeView, setActiveView] = useState<NavView>('channels');
  const [selectedChannelNumber, setSelectedChannelNumber] = useState<number>(1);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Modals
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [radioSyncMode, setRadioSyncMode] = useState<'read' | 'write' | null>(null);

  // Toast Banner
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (message: string, kind: ToastKind = 'success') => {
    setToast({ message, kind });
    // Errors stay up longer so they can be read
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, kind === 'success' ? 4500 : 9000);
  };

  /** Asks before `action` replaces a codeplug that has unsaved edits; true when it may go ahead. */
  const confirmReplaceUnsaved = (action: string): boolean =>
    !hasUnsavedChanges ||
    window.confirm(`You have unsaved changes. ${action} replaces the codeplug in the editor. Continue?`);

  // Warn before closing or reloading with unsaved edits (Electron asks in main.ts)
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  const activeChannelCount = useMemo(
    () => codeplug.channels.filter((c) => c.used && c.rxFreqHz > 0).length,
    [codeplug.channels]
  );

  // rawYsfBuffer stays the buffer the codeplug was loaded from: encodeYsfBuffer() uses it only to
  // keep bytes it does not map, so it is not re-encoded (47 KB) on every edit. Code that needs the
  // current bytes encodes on demand.
  const applyCodeplugUpdate = (updater: (prev: RadioCodeplug) => RadioCodeplug) => {
    setCodeplug(updater);
    setHasUnsavedChanges(true);
  };

  const handleUpdateChannels = (channels: ChannelRecord[]) => {
    applyCodeplugUpdate((prev) => ({ ...prev, channels }));
  };

  const handleUpdateGeneral = (general: GeneralSettingsConfig) => {
    applyCodeplugUpdate((prev) => ({ ...prev, general }));
  };

  const handleUpdateVfoA = (vfoA: VfoConfig) => {
    applyCodeplugUpdate((prev) => ({ ...prev, vfoA }));
  };

  const handleUpdateVfoB = (vfoB: VfoConfig) => {
    applyCodeplugUpdate((prev) => ({ ...prev, vfoB }));
  };

  const handleUpdateCrossBandSlots = (crossBandSlots: CrossBandRepeaterSlot[]) => {
    applyCodeplugUpdate((prev) => ({ ...prev, crossBandSlots }));
  };

  const handleUpdateDtmf = (dtmf: DtmfConfig) => {
    applyCodeplugUpdate((prev) => ({ ...prev, dtmf }));
  };

  const handleUpdateBandLimits = (bandLimits: BandLimitsConfig) => {
    applyCodeplugUpdate((prev) => ({ ...prev, bandLimits }));
  };

  const handleUpdateCalibration = (rfCalibrationBase64?: string) => {
    applyCodeplugUpdate((prev) => ({ ...prev, rfCalibrationBase64 }));
  };

  const handleImportChannels = (
    incoming: ChannelRecord[],
    mode: ChannelInsertionMode,
    targetChannelNumber: number
  ) => {
    const { channels: merged, importedCount, skippedCount } = mergeImportedChannels(
      codeplug.channels,
      incoming,
      mode,
      targetChannelNumber
    );
    handleUpdateChannels(merged);
    setActiveView('channels');
    if (skippedCount > 0) {
      showToast(
        `Imported ${importedCount} of ${incoming.length} channel(s) using "${mode}" strategy; ${skippedCount} did not fit in the 500-channel list and were not imported.`,
        'warning'
      );
    } else {
      showToast(`Imported ${importedCount} channel(s) using "${mode}" strategy.`);
    }
  };

  const handleQuickSaveYsf = () => {
    const ysfBytes = encodeYsfBuffer(codeplug);
    const blob = new Blob([ysfBytes as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_${new Date().toISOString().slice(0, 10)}.Ysf`;
    a.click();
    URL.revokeObjectURL(url);
    setHasUnsavedChanges(false);
    showToast('Saved 47,046-byte .Ysf codeplug file.');
  };

  const handleQuickFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (typeof reader.result === 'string') {
            const loaded = deserializeRichBundle(reader.result);
            setCodeplug(loaded);
            setHasUnsavedChanges(false);
            showToast(`Loaded rich bundle: ${file.name}`);
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to load .ic980.json file.', 'error');
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (reader.result instanceof ArrayBuffer) {
            const loaded = decodeYsfBuffer(new Uint8Array(reader.result));
            setCodeplug(loaded);
            setHasUnsavedChanges(false);
            showToast(`Loaded .Ysf codeplug: ${file.name}`);
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to decode .Ysf file.', 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-slate-100 overflow-hidden">
      {/* Hidden Quick File Input */}
      <input
        ref={quickFileInputRef}
        type="file"
        accept=".ysf,.Ysf,.json"
        onChange={handleQuickFileChange}
        className="hidden"
      />

      {/* Top TitleBar */}
      <TitleBar
        activeChannelCount={activeChannelCount}
        totalChannels={MAX_CHANNELS}
        hasUnsavedChanges={hasUnsavedChanges}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        onOpenRadioSync={(mode) => {
          if (mode === 'read' && !confirmReplaceUnsaved('Reading the radio')) return;
          setRadioSyncMode(mode);
        }}
        onQuickSaveYsf={handleQuickSaveYsf}
        onQuickLoadFile={() => {
          if (confirmReplaceUnsaved('Opening a file')) quickFileInputRef.current?.click();
        }}
      />

      {/* Main Content Area: Left Navigation Rail + Active Workspace */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Navigation Sidebar */}
        <aside className="w-full md:w-60 bg-slate-900/95 border-b md:border-b-0 md:border-r border-slate-800 p-3 flex md:flex-col justify-between gap-2 shrink-0 overflow-x-auto">
          <nav className="flex md:flex-col gap-1.5">
            {/* 1. Channels (1-500) */}
            <button
              type="button"
              onClick={() => setActiveView('channels')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeView === 'channels'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ListFilter className="w-4 h-4 text-cyan-400" />
                <span>Channels (1–500)</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                {activeChannelCount}
              </span>
            </button>

            {/* Radio Settings Section (General + VFO Subsection, and Advanced Submenu) */}
            <div className="hidden md:block pt-3 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Radio Settings
            </div>

            <button
              type="button"
              onClick={() => setActiveView('settings_general')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeView === 'settings_general'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-cyan-400" />
                <span>General & VFO Config</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60 hidden md:block" />
            </button>

            <button
              type="button"
              onClick={() => setActiveView('settings_advanced')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeView === 'settings_advanced'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Advanced Submenu</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60 hidden md:block" />
            </button>

            {/* 4. Boot Logo Studio */}
            <div className="hidden md:block pt-3 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Hardware Utilities
            </div>

            <button
              type="button"
              onClick={() => setActiveView('bootlogo')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeView === 'bootlogo'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-purple-400" />
                <span>Boot Logo Studio</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60 hidden md:block" />
            </button>
          </nav>

          {/* Bottom Hardware Summary Card */}
          <div className="hidden md:block bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-400">
              <span>Band Limits:</span>
              <span className="font-mono text-cyan-300">VHF / UHF</span>
            </div>
            <div className="font-mono text-[10px] text-slate-300">
              V: {codeplug.bandLimits.vhfMinMhz.toFixed(1)}–{codeplug.bandLimits.vhfMaxMhz.toFixed(1)} MHz
            </div>
            <div className="font-mono text-[10px] text-slate-300">
              U: {codeplug.bandLimits.uhfMinMhz.toFixed(1)}–{codeplug.bandLimits.uhfMaxMhz.toFixed(1)} MHz
            </div>
            <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
              <span>.Ysf Size:</span>
              <span className="font-mono text-emerald-400">47,046 B</span>
            </div>
          </div>
        </aside>

        {/* Active Workspace Pane */}
        <main className="flex-1 overflow-hidden relative">
          {/* Keyed by view so switching views clears a caught error */}
          <ErrorBoundary
            key={activeView}
            title="This view hit an error and was closed"
            hint="Your codeplug is still loaded: you can switch views, save a .Ysf file or open another file. Reload the app if this keeps happening."
          >
          {activeView === 'channels' && (
            <ChannelGrid
              codeplug={codeplug}
              selectedChannelNumber={selectedChannelNumber}
              onSelectChannel={setSelectedChannelNumber}
              onUpdateChannels={handleUpdateChannels}
              onOpenImportModal={() => setIsImportModalOpen(true)}
            />
          )}

          {activeView === 'settings_general' && (
            <GeneralSettings
              general={codeplug.general}
              vfoA={codeplug.vfoA}
              vfoB={codeplug.vfoB}
              onChangeGeneral={handleUpdateGeneral}
              onChangeVfoA={handleUpdateVfoA}
              onChangeVfoB={handleUpdateVfoB}
            />
          )}

          {activeView === 'settings_advanced' && (
            <AdvancedSettings
              general={codeplug.general}
              crossBandSlots={codeplug.crossBandSlots}
              dtmf={codeplug.dtmf}
              bandLimits={codeplug.bandLimits}
              channels={codeplug.channels}
              rfCalibrationBase64={codeplug.rfCalibrationBase64}
              onChangeGeneral={handleUpdateGeneral}
              onChangeCrossBandSlots={handleUpdateCrossBandSlots}
              onChangeDtmf={handleUpdateDtmf}
              onChangeBandLimits={handleUpdateBandLimits}
              onChangeCalibration={handleUpdateCalibration}
            />
          )}

          {activeView === 'bootlogo' && (
            <BootLogoStudio defaultCallsign={codeplug.general.radioCallsign} />
          )}
          </ErrorBoundary>

          {/* Floating Toast Notification */}
          {toast && (
            <div
              role={toast.kind === 'success' ? 'status' : 'alert'}
              data-kind={toast.kind}
              className={`fixed bottom-5 right-5 z-40 max-w-md bg-slate-900/95 border px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-medium ${TOAST_STYLES[toast.kind].box}`}
            >
              {toast.kind === 'success' && <CheckCircle2 className={`w-4 h-4 shrink-0 ${TOAST_STYLES.success.icon}`} />}
              {toast.kind === 'warning' && <AlertTriangle className={`w-4 h-4 shrink-0 ${TOAST_STYLES.warning.icon}`} />}
              {toast.kind === 'error' && <XCircle className={`w-4 h-4 shrink-0 ${TOAST_STYLES.error.icon}`} />}
              <span>{toast.message}</span>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <ImportModal
        isOpen={isImportModalOpen}
        selectedChannelNumber={selectedChannelNumber}
        onClose={() => setIsImportModalOpen(false)}
        onImportChannels={handleImportChannels}
      />

      <BackupVaultModal
        isOpen={isBackupModalOpen}
        codeplug={codeplug}
        onClose={() => setIsBackupModalOpen(false)}
        onRestoreCodeplug={(restored) => {
          if (!confirmReplaceUnsaved('Restoring')) return;
          setCodeplug(restored);
          setHasUnsavedChanges(false);
          showToast('Restored codeplug configuration.');
        }}
      />

      {radioSyncMode && (
        <RadioSyncModal
          isOpen={true}
          mode={radioSyncMode}
          codeplug={codeplug}
          onClose={() => setRadioSyncMode(null)}
          onCodeplugReadFromRadio={(readCp) => {
            setCodeplug(readCp);
            setHasUnsavedChanges(false);
            showToast('Loaded configuration from HIROYASU IC-980 Pro Max.');
          }}
        />
      )}
    </div>
  );
};
