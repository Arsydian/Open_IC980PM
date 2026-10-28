/**
 * @file src/components/RadioSyncModal.tsx
 * @description Direct USB HID / WebHID Read & Write modal for the HIROYASU IC-980 Pro Max
 * (`VendorName: "ASER _HID"`, `ProductName: "ASER-471"`, `PROG81LS` handshake).
 * Before writing, blocks codeplugs that fail `validateCodeplugForWrite` and backs up the radio's
 * current contents to the Rollback Vault.
 */

import React, { useMemo, useState } from 'react';
import {
  X,
  Download,
  Upload,
  Usb,
  ShieldAlert,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { HidProgressEvent } from '../types/global';
import type { RadioCodeplug } from '../types/radio';
import { decodeYsfBuffer, encodeYsfBuffer } from '../core/ysfCodec';
import { eepromImageToYsf, ysfToEepromImage } from '../core/eepromCodec';
import {
  createSnapshotFromRadioImage,
  saveSnapshotToVault,
  uint8ArrayToBase64,
} from '../core/backupBundle';
import {
  readRadioViaWebHid,
  writeRadioViaWebHid,
} from '../core/webHidTransport';
import { validateCodeplugForWrite } from '../core/codeplugValidator';

/** How many pre-write problems to list before summarizing the rest. */
const MAX_LISTED_ISSUES = 8;

interface RadioSyncModalProps {
  isOpen: boolean;
  mode: 'read' | 'write';
  codeplug: RadioCodeplug;
  onClose: () => void;
  onCodeplugReadFromRadio: (readCodeplug: RadioCodeplug) => void;
}

export const RadioSyncModal: React.FC<RadioSyncModalProps> = ({
  isOpen,
  mode,
  codeplug,
  onClose,
  onCodeplugReadFromRadio,
}) => {
  const [includeCalibration, setIncludeCalibration] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<HidProgressEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedMsg, setCompletedMsg] = useState<string | null>(null);

  const writeIssues = useMemo(
    () => (isOpen && mode === 'write' ? validateCodeplugForWrite(codeplug) : []),
    [isOpen, mode, codeplug]
  );
  const writeBlocked = mode === 'write' && writeIssues.length > 0;

  if (!isOpen) return null;

  const handleStartTransfer = async () => {
    if (writeBlocked) return;
    setIsRunning(true);
    setErrorMsg(null);
    setCompletedMsg(null);

    try {
      if (mode === 'read') {
        const { eeprom, calibration } = await readRadioViaWebHid(
          { includeCalibration, password: passwordInput },
          (ev) => setProgress(ev)
        );
        const ysfBuf = eepromImageToYsf(eeprom, codeplug.rawYsfBuffer);
        const decoded = decodeYsfBuffer(ysfBuf);
        if (calibration) {
          decoded.rfCalibrationBase64 = uint8ArrayToBase64(calibration);
        }
        onCodeplugReadFromRadio(decoded);
        setCompletedMsg('Successfully read configuration from HIROYASU IC-980 Pro Max!');
      } else {
        await writeRadioViaWebHid(async (currentRadioImage) => {
          // 1. Back up what is on the radio right now; abort before writing if that fails
          const snap = createSnapshotFromRadioImage(
            currentRadioImage,
            `Radio before write (${new Date().toLocaleTimeString()})`
          );
          await saveSnapshotToVault(snap);

          // 2. Encode .Ysf -> EEPROM Image to write over USB HID
          return ysfToEepromImage(encodeYsfBuffer(codeplug), currentRadioImage);
        }, (ev) => setProgress(ev));
        setCompletedMsg(
          'Successfully wrote codeplug to HIROYASU IC-980 Pro Max! The radio’s previous contents were saved to the Rollback Vault.'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'USB HID communication error.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Usb className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {mode === 'read' ? 'Read From Radio (USB HID)' : 'Write To Radio (USB HID)'}
              </h2>
              <p className="text-xs text-slate-400">
                Target Device: `ASER _HID` / `ASER-471` • Handshake: `PROG81LS`
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-xs">
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-2 text-slate-300">
            <div className="font-semibold text-slate-100">Connection Checklist:</div>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li>Connect the HIROYASU USB HID programming cable firmly to the handset K-plug / accessory port.</li>
              <li>Turn the radio power switch ON and ensure it is idle on VFO/Memory screen (not transmitting).</li>
              <li>
                {mode === 'write'
                  ? 'The radio is read first and its current contents saved to the Rollback Vault; if that backup fails, nothing is written.'
                  : 'Select whether to also back up the 775-byte RF Calibration region (0x18000).'}
              </li>
            </ol>
          </div>

          {writeBlocked && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-rose-200">
              <div className="flex items-start gap-2.5 font-semibold">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>
                  Fix {writeIssues.length === 1 ? 'this problem' : `these ${writeIssues.length} problems`} before
                  writing. Nothing will be sent to the radio until they are resolved.
                </span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-rose-200/90">
                {writeIssues.slice(0, MAX_LISTED_ISSUES).map((issue, idx) => (
                  <li key={idx}>
                    <span className="font-semibold">{issue.location}:</span> {issue.message}
                  </li>
                ))}
              </ul>
              {writeIssues.length > MAX_LISTED_ISSUES && (
                <div className="text-rose-300/80">…and {writeIssues.length - MAX_LISTED_ISSUES} more.</div>
              )}
            </div>
          )}

          {mode === 'read' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer text-slate-200">
                <input
                  type="checkbox"
                  checked={includeCalibration}
                  onChange={(e) => setIncludeCalibration(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                />
                <span>Include 775-Byte RF Calibration Backup (`0x18000..0x18306`)</span>
              </label>

              <div>
                <label className="block text-slate-400 mb-1">
                  6-Digit Radio Password (leave blank if radio is unlocked):
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Optional 6 digits"
                  className="w-44 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
                />
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {progress && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-cyan-300">{progress.message}</span>
                <span className="text-slate-400">{progress.percent}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-150"
                  style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-rose-200">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {completedMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{completedMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isRunning}
              onClick={onClose}
              className="px-4 py-2 rounded-xl font-medium bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Close
            </button>

            <button
              type="button"
              disabled={isRunning || writeBlocked}
              onClick={handleStartTransfer}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-md disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Communicating...</span>
                </>
              ) : mode === 'read' ? (
                <>
                  <Download className="w-4 h-4" />
                  <span>Start Radio Read</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Start Radio Write</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
