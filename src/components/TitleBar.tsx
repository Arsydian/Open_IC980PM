/**
 * @file src/components/TitleBar.tsx
 * @description Top application header bar for Open_IC980PM.
 * Displays the synchronized build version badge (`window.api.appVersion` / `__APP_VERSION__`),
 * active channel count, USB HID connection indicator, and primary workflow actions.
 */

import React from 'react';
import {
  Download,
  Upload,
  Radio,
  Database,
  ShieldCheck,
  Sparkles,
  FolderOpen,
  Save,
} from 'lucide-react';

interface TitleBarProps {
  activeChannelCount: number;
  totalChannels: number;
  hasUnsavedChanges: boolean;
  onOpenImportModal: () => void;
  onOpenBackupModal: () => void;
  onOpenRadioSync: (mode: 'read' | 'write') => void;
  onQuickSaveYsf: () => void;
  onQuickLoadFile: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeChannelCount,
  totalChannels,
  hasUnsavedChanges,
  onOpenImportModal,
  onOpenBackupModal,
  onOpenRadioSync,
  onQuickSaveYsf,
  onQuickLoadFile,
}) => {
  const appVersion =
    (typeof window !== 'undefined' && window.api?.appVersion) ||
    (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0');

  return (
    <header className="h-16 bg-slate-900/95 border-b border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-3 select-none shrink-0 z-20">
      {/* Brand & Dynamic Version Badge */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/40 flex items-center justify-center shadow-inner shrink-0">
          <Radio className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-slate-100 truncate">
              Open_IC980PM
            </h1>
            <span
              data-testid="app-version-badge"
              className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
            >
              v{appVersion}
            </span>
            {hasUnsavedChanges && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Modified
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate">
            HIROYASU IC-980 Pro Max Programming Studio •{' '}
            <span className="font-mono text-slate-300">
              {activeChannelCount}/{totalChannels}
            </span>{' '}
            Active Channels
          </p>
        </div>
      </div>

      {/* Center / Right Action Toolbar */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {/* Load & Save Codeplug File */}
        <button
          type="button"
          onClick={onQuickLoadFile}
          title="Open .Ysf or .ic980.json Codeplug File"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Open File</span>
        </button>

        <button
          type="button"
          onClick={onQuickSaveYsf}
          title="Save 47,046-byte .Ysf Codeplug File"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
        >
          <Save className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Save .Ysf</span>
        </button>

        {/* RepeaterBook / CHIRP / Quick-Pack Importer */}
        <button
          type="button"
          onClick={onOpenImportModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 transition-colors shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Import Channels</span>
        </button>

        {/* Backup & Rollback Vault */}
        <button
          type="button"
          onClick={onOpenBackupModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden md:inline">Backup & Vault</span>
        </button>

        <div className="h-5 w-px bg-slate-800 mx-0.5 hidden sm:block" />

        {/* Direct USB HID Read / Write */}
        <button
          type="button"
          onClick={() => onOpenRadioSync('read')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Read Radio</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenRadioSync('write')}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-sm transition-all"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Write Radio</span>
        </button>
      </div>
    </header>
  );
};
