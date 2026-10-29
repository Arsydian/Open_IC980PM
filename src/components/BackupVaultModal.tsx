/**
 * @file src/components/BackupVaultModal.tsx
 * @description Backup, Restore & Rollback Vault Modal for Open_IC980PM.
 * Supports:
 * 1. Native `.Ysf` (`47,046` B) binary save & load
 * 2. Rich `.ic980.json` bundle save & load (preserving RepeaterBook metadata & RF Calibration)
 * 3. Automatic Pre-Write EEPROM Safety Snapshot ("Rollback Vault") inspection & 1-click restore
 */

import React, { useEffect, useState } from 'react';
import { useDialogA11y } from './useDialogA11y';
import {
  X,
  ShieldCheck,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  PlusCircle,
  FileCode,
  HardDrive,
} from 'lucide-react';
import type { RadioCodeplug, RollbackSnapshot } from '../types/radio';
import { decodeYsfBuffer, encodeYsfBuffer } from '../core/ysfCodec';
import {
  base64ToUint8Array,
  createSnapshotFromCodeplug,
  deleteSnapshotFromVault,
  deserializeRichBundle,
  isValidCalibrationBase64,
  loadRollbackVault,
  saveSnapshotToVault,
  serializeRichBundle,
} from '../core/backupBundle';
import { fileSizeProblem } from '../core/fileLimits';

interface BackupVaultModalProps {
  isOpen: boolean;
  codeplug: RadioCodeplug;
  onClose: () => void;
  onRestoreCodeplug: (restored: RadioCodeplug) => void;
  /** Called after a .Ysf file or .ic980.json bundle has been saved. */
  onSaved?: (format: 'ysf' | 'bundle') => void;
}

export const BackupVaultModal: React.FC<BackupVaultModalProps> = ({
  isOpen,
  codeplug,
  onClose,
  onRestoreCodeplug,
  onSaved,
}) => {
  const [snapshots, setSnapshots] = useState<RollbackSnapshot[]>([]);
  const [customLabel, setCustomLabel] = useState('Manual Checkpoint');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      loadRollbackVault()
        .then(setSnapshots)
        .catch((err: unknown) => {
          setSnapshots([]);
          setErrorMsg(`Could not read the Rollback Vault: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  }, [isOpen]);

  const dialogRef = useDialogA11y(isOpen, onClose);

  if (!isOpen) return null;

  const handleSaveNativeYsf = () => {
    const ysfBytes = encodeYsfBuffer(codeplug);
    const blob = new Blob([ysfBytes as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_${new Date().toISOString().slice(0, 10)}.Ysf`;
    a.click();
    URL.revokeObjectURL(url);
    onSaved?.('ysf');
  };

  const handleSaveRichJson = () => {
    const jsonText = serializeRichBundle(codeplug);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_Backup_${new Date().toISOString().slice(0, 10)}.ic980.json`;
    a.click();
    URL.revokeObjectURL(url);
    onSaved?.('bundle');
  };

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setErrorMsg(null);

    const isBundle = file.name.toLowerCase().endsWith('.json');
    const sizeProblem = fileSizeProblem(file, isBundle ? 'bundle' : 'ysf');
    if (sizeProblem) {
      setErrorMsg(sizeProblem);
      return;
    }

    if (isBundle) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (typeof reader.result === 'string') {
            const restored = deserializeRichBundle(reader.result);
            onRestoreCodeplug(restored);
            onClose();
          }
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to parse .ic980.json bundle.');
        }
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (reader.result instanceof ArrayBuffer) {
            const bytes = new Uint8Array(reader.result);
            const restored = decodeYsfBuffer(bytes);
            onRestoreCodeplug(restored);
            onClose();
          }
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to decode 47,046-byte .Ysf file.');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleCreateVaultSnapshot = async () => {
    const snap = createSnapshotFromCodeplug(codeplug, customLabel.trim() || 'Manual Snapshot');
    try {
      const updated = await saveSnapshotToVault(snap);
      setSnapshots(updated);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save snapshot.');
    }
  };

  const handleRestoreVaultSnapshot = (snap: RollbackSnapshot) => {
    try {
      const ysfBytes = base64ToUint8Array(snap.ysfBase64);
      const restored = decodeYsfBuffer(ysfBytes);
      if (isValidCalibrationBase64(snap.calibrationBase64)) {
        restored.rfCalibrationBase64 = snap.calibrationBase64;
      }
      onRestoreCodeplug(restored);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to restore snapshot.');
    }
  };

  const handleDeleteVaultSnapshot = async (id: string) => {
    const snap = snapshots.find((s) => s.id === id);
    if (!window.confirm(`Delete the snapshot "${snap?.label ?? id}" from the Rollback Vault? This cannot be undone.`)) {
      return;
    }
    try {
      const updated = await deleteSnapshotFromVault(id);
      setSnapshots(updated);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(`Could not delete the snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="BackupVaultModal-title"
        tabIndex={-1}
        className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 id="BackupVaultModal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
              <span>Backup, Restore & Automatic Rollback Vault</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Export/import native `47,046`-byte `.Ysf` files, rich `.ic980.json` bundles, or roll back to any pre-write safety snapshot.
            </p>
          </div>
          <button
            aria-label="Close"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div role="alert" className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Export / Import Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs mb-1">
                  <HardDrive className="w-4 h-4" />
                  <span>Native `.Ysf` Codeplug</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Exact `47,046`-byte (`0xB7C6`) binary format compatible 1:1 with the factory HIROYASU CPS.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveNativeYsf}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .Ysf (47,046 B)</span>
              </button>
            </div>

            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1">
                  <FileCode className="w-4 h-4" />
                  <span>Rich `.ic980.json` Bundle</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Embeds the full `.Ysf` binary plus RepeaterBook city/callsign metadata, notes, and `775`B RF calibration.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveRichJson}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .ic980.json</span>
              </button>
            </div>

            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-1">
                  <Upload className="w-4 h-4" />
                  <span>Restore From File</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Load either a `.Ysf` (`47,046` B) binary file or a `.ic980.json` bundle from disk.
                </p>
              </div>
              <label className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Load .Ysf / .ic980.json</span>
                <input
                  type="file"
                  accept=".ysf,.Ysf,.json"
                  onChange={handleFileLoad}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Rollback Vault Section */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  EEPROM Safety Snapshot Vault (&ldquo;Rollback Vault&rdquo;)
                </h3>
                <p className="text-xs text-slate-400">
                  Snapshots are automatically captured before every radio write operation, or you can save a manual checkpoint anytime.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Snapshot label..."
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleCreateVaultSnapshot}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Save Snapshot</span>
                </button>
              </div>
            </div>

            {snapshots.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-800 rounded-xl">
                No snapshots in the Rollback Vault yet. Click &ldquo;Save Snapshot&rdquo; above or write to a radio to create an automatic safety point.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-100">{snap.label}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {new Date(snap.createdAt).toLocaleString()} • {snap.activeChannelCount} Active Channels
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRestoreVaultSnapshot(snap)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVaultSnapshot(snap.id)}
                        aria-label={`Delete snapshot ${snap.label}`}
                        title="Delete snapshot"
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
