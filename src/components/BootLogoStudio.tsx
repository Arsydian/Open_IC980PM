/**
 * @file src/components/BootLogoStudio.tsx
 * @description Custom Boot Logo Studio for the HIROYASU IC-980 Pro Max (`160x128` Big-Endian RGB565
 * flashed to EEPROM `0x1B000`, verified from `0x0041C8E0`).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Sparkles,
  Download,
  Zap,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  BOOT_LOGO_HEIGHT,
  BOOT_LOGO_PAYLOAD_SIZE,
  BOOT_LOGO_WIDTH,
  decodeBootLogoPayloadToRgba,
  encodeRgbaToBootLogoPayload,
} from '../core/bmpLogoCodec';
import { flashBootLogoViaWebHid } from '../core/webHidTransport';

interface BootLogoStudioProps {
  defaultCallsign: string;
}

export const BootLogoStudio: React.FC<BootLogoStudioProps> = ({ defaultCallsign }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [badgeTitle, setBadgeTitle] = useState(defaultCallsign || 'IC-980 PRO MAX');
  const [badgeSubtitle, setBadgeSubtitle] = useState('10W DUAL BAND');
  const [themeColor, setThemeColor] = useState<'cyan' | 'emerald' | 'amber'>('cyan');
  const [rgb565Payload, setRgb565Payload] = useState<Uint8Array | null>(null);
  const [flashStatus, setFlashStatus] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  const quantizeCanvasToRgb565 = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);
    const payload = encodeRgbaToBootLogoPayload(imgData.data, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);
    setRgb565Payload(payload);

    // Re-decode from RGB565 so the user sees the exact 16-bit color quantization on the LCD preview
    const decoded = decodeBootLogoPayloadToRgba(payload);
    const quantizedImgData = new ImageData(
      new Uint8ClampedArray(decoded.rgba),
      decoded.width,
      decoded.height
    );
    ctx.putImageData(quantizedImgData, 0, 0);
  };

  const renderCallsignWallpaper = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);
    grad.addColorStop(0, '#060c18');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);

    const accentHex =
      themeColor === 'cyan' ? '#06b6d4' : themeColor === 'emerald' ? '#10b981' : '#f59e0b';

    // Outer technical frame
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, BOOT_LOGO_WIDTH - 12, BOOT_LOGO_HEIGHT - 12);

    // Top header bar
    ctx.fillStyle = accentHex;
    ctx.fillRect(6, 6, BOOT_LOGO_WIDTH - 12, 22);

    ctx.fillStyle = '#040812';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HIROYASU IC-980PM', BOOT_LOGO_WIDTH / 2, 21);

    // Main Callsign / Title
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px monospace';
    ctx.fillText((badgeTitle || 'OPEN_IC980').slice(0, 12), BOOT_LOGO_WIDTH / 2, 68);

    // Subtitle
    ctx.fillStyle = accentHex;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText((badgeSubtitle || '136-174 / 400-480').slice(0, 18), BOOT_LOGO_WIDTH / 2, 92);

    // Bottom status line
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('160x128 RGB565 STUDIO', BOOT_LOGO_WIDTH / 2, 114);

    quantizeCanvasToRgb565();
  };

  useEffect(() => {
    renderCallsignWallpaper();
  }, [badgeTitle, badgeSubtitle, themeColor]);

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);
        ctx.drawImage(img, 0, 0, BOOT_LOGO_WIDTH, BOOT_LOGO_HEIGHT);
        quantizeCanvasToRgb565();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleExportLogoBin = () => {
    if (!rgb565Payload) return;
    const blob = new Blob([rgb565Payload as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC980PM_BootLogo_160x128_RGB565.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFlashLogoToRadio = async () => {
    if (!rgb565Payload) return;
    setIsFlashing(true);
    setFlashError(null);
    setFlashStatus('Connecting to ASER-471 over USB HID...');
    try {
      await flashBootLogoViaWebHid(rgb565Payload, (ev) => {
        setFlashStatus(ev.message);
      });
    } catch (err) {
      setFlashError(err instanceof Error ? err.message : 'Boot logo flash failed.');
      setFlashStatus(null);
    } finally {
      setIsFlashing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-cyan-400" />
            <span>Custom Boot Logo Studio (`160×128` Big-Endian RGB565 → `EEPROM 0x1B000`)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Upload any image or generate a custom callsign boot screen. Automatically encodes the 4-byte `[0x00, 0x80, 0x00, 0xA0]` header + `40,960` Big-Endian RGB565 bytes (`40,964` bytes total).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportLogoBin}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export 40,964B .BIN</span>
          </button>

          <button
            type="button"
            disabled={isFlashing || !rgb565Payload}
            onClick={handleFlashLogoToRadio}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-sm disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{isFlashing ? 'Flashing to 0x1B000...' : 'Flash Boot Logo to Radio'}</span>
          </button>
        </div>
      </div>

      {flashStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{flashStatus}</span>
        </div>
      )}

      {flashError && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{flashError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Handset LCD 160x128 Preview */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col items-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Live 160×128 RGB565 Handset LCD Preview
          </span>

          <div className="bg-slate-950 border-4 border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col items-center">
            <canvas
              ref={canvasRef}
              width={BOOT_LOGO_WIDTH}
              height={BOOT_LOGO_HEIGHT}
              className="w-[320px] h-[256px] rounded-lg border border-cyan-500/40 shadow-inner"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="mt-3 flex items-center justify-between w-full text-[11px] font-mono text-slate-400">
              <span>160×128 px (2x Zoom)</span>
              <span>Payload: {BOOT_LOGO_PAYLOAD_SIZE.toLocaleString()} Bytes</span>
            </div>
          </div>
        </div>

        {/* Right: Image Upload & Procedural Callsign Badge Generator */}
        <div className="lg:col-span-7 space-y-5">
          {/* Upload Custom Image */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Upload className="w-4 h-4 text-cyan-400" />
              <span>Option 1: Upload Custom Image (.BMP, .PNG, .JPG, .WEBP)</span>
            </h3>
            <p className="text-xs text-slate-400">
              Any uploaded image is automatically scaled to `160×128` and quantized to 16-bit Big-Endian RGB565 (`R5G6B5`).
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              <span>Select Image File...</span>
              <input
                type="file"
                accept="image/bmp,image/png,image/jpeg,image/webp"
                onChange={handleUploadImage}
                className="hidden"
              />
            </label>
          </div>

          {/* Procedural Callsign Badge Generator */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Option 2: Callsign Boot Screen Generator</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Primary Callsign / Title</label>
                <input
                  type="text"
                  maxLength={12}
                  value={badgeTitle}
                  onChange={(e) => setBadgeTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Subtitle / Rig Info</label>
                <input
                  type="text"
                  maxLength={18}
                  value={badgeSubtitle}
                  onChange={(e) => setBadgeSubtitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1.5">Accent Theme</label>
                <div className="flex items-center gap-2">
                  {(
                    [
                      { id: 'cyan', label: 'Cyan Tactical' },
                      { id: 'emerald', label: 'Emerald Field' },
                      { id: 'amber', label: 'Amber SAR' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemeColor(t.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                        themeColor === t.id
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
