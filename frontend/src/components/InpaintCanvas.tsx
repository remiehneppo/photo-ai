"use client";

import { Eraser, Paintbrush, Trash2 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface InpaintCanvasHandle {
  getMaskBlob: () => Promise<Blob>;
  hasMask: () => boolean;
}

interface Props {
  imageFile: File;
}

const InpaintCanvas = forwardRef<InpaintCanvasHandle, Props>(({ imageFile }, ref) => {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSrc, setImageSrc] = useState("");
  const [ready, setReady] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [mode, setMode] = useState<"draw" | "erase">("draw");
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const hasDrawnRef = useRef(false);

  // Load image and initialise canvases at native resolution
  useEffect(() => {
    setReady(false);
    hasDrawnRef.current = false;
    const url = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const mask = maskCanvasRef.current;
      if (mask) {
        mask.width = w;
        mask.height = h;
        const ctx = mask.getContext("2d")!;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, w, h);
      }

      const display = displayCanvasRef.current;
      if (display) {
        display.width = w;
        display.height = h;
        display.getContext("2d")!.clearRect(0, 0, w, h);
      }

      setImageSrc(url);
      setReady(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Project display (CSS) coordinates → canvas (logical) coordinates
  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const applyBrush = useCallback(
    (x: number, y: number) => {
      const display = displayCanvasRef.current;
      const mask = maskCanvasRef.current;
      if (!display || !mask) return;

      const dc = display.getContext("2d")!;
      const mc = mask.getContext("2d")!;

      if (mode === "draw") {
        dc.globalCompositeOperation = "source-over";
        dc.fillStyle = "rgba(255, 80, 0, 0.45)";
        dc.beginPath();
        dc.arc(x, y, brushSize, 0, Math.PI * 2);
        dc.fill();

        mc.fillStyle = "white";
        mc.beginPath();
        mc.arc(x, y, brushSize, 0, Math.PI * 2);
        mc.fill();
        hasDrawnRef.current = true;
      } else {
        dc.globalCompositeOperation = "destination-out";
        dc.beginPath();
        dc.arc(x, y, brushSize, 0, Math.PI * 2);
        dc.fill();
        dc.globalCompositeOperation = "source-over";

        mc.fillStyle = "black";
        mc.beginPath();
        mc.arc(x, y, brushSize, 0, Math.PI * 2);
        mc.fill();
      }
    },
    [mode, brushSize]
  );

  // Interpolated stroke for smooth lines
  const strokeTo = useCallback(
    (to: { x: number; y: number }) => {
      const from = lastPoint.current;
      if (!from) {
        applyBrush(to.x, to.y);
        return;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, brushSize / 4)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        applyBrush(from.x + dx * t, from.y + dy * t);
      }
    },
    [applyBrush, brushSize]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      isDrawing.current = true;
      const pos = getCanvasPos(e.clientX, e.clientY);
      applyBrush(pos.x, pos.y);
      lastPoint.current = pos;
    },
    [getCanvasPos, applyBrush]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current) return;
      const pos = getCanvasPos(e.clientX, e.clientY);
      strokeTo(pos);
      lastPoint.current = pos;
    },
    [getCanvasPos, strokeTo]
  );

  const stopDrawing = useCallback(() => {
    isDrawing.current = false;
    lastPoint.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      isDrawing.current = true;
      const t = e.touches[0];
      const pos = getCanvasPos(t.clientX, t.clientY);
      applyBrush(pos.x, pos.y);
      lastPoint.current = pos;
    },
    [getCanvasPos, applyBrush]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawing.current) return;
      const t = e.touches[0];
      const pos = getCanvasPos(t.clientX, t.clientY);
      strokeTo(pos);
      lastPoint.current = pos;
    },
    [getCanvasPos, strokeTo]
  );

  const clearMask = useCallback(() => {
    const display = displayCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!display || !mask) return;
    display.getContext("2d")!.clearRect(0, 0, display.width, display.height);
    const mc = mask.getContext("2d")!;
    mc.fillStyle = "black";
    mc.fillRect(0, 0, mask.width, mask.height);
    hasDrawnRef.current = false;
  }, []);

  useImperativeHandle(ref, () => ({
    getMaskBlob: () =>
      new Promise<Blob>((resolve, reject) => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return reject(new Error("Mask canvas not ready"));
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Failed to export mask"))),
          "image/png"
        );
      }),
    hasMask: () => hasDrawnRef.current,
  }));

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
            mode === "draw" ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:bg-panel"
          }`}
        >
          <Paintbrush className="h-3.5 w-3.5" /> Brush
        </button>
        <button
          type="button"
          onClick={() => setMode("erase")}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
            mode === "erase" ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:bg-panel"
          }`}
        >
          <Eraser className="h-3.5 w-3.5" /> Eraser
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Size</span>
          <input
            type="range"
            min={5}
            max={120}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24 accent-accent"
          />
          <span className="w-8 text-right text-xs text-muted">{brushSize}px</span>
        </div>
        <button
          type="button"
          onClick={clearMask}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-panel"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      {/* Image + canvas overlay */}
      <div className="flex justify-center">
        <div className="relative inline-block max-w-full rounded-md border border-line">
          {imageSrc && (
            <img
              src={imageSrc}
              alt="Inpaint source"
              className="block max-w-full rounded-md"
              style={{ maxHeight: 480, display: "block" }}
              draggable={false}
            />
          )}
          {ready && (
            <canvas
              ref={displayCanvasRef}
              className="absolute inset-0 h-full w-full rounded-md"
              style={{
                cursor: mode === "draw" ? "crosshair" : "cell",
                touchAction: "none",
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={stopDrawing}
            />
          )}
        </div>
      </div>

      {/* Hidden mask canvas (native resolution) */}
      <canvas ref={maskCanvasRef} className="hidden" />

      <p className="text-xs text-muted">
        Paint over the area to regenerate (shown in orange). Use eraser to remove selection.
      </p>
    </div>
  );
});

InpaintCanvas.displayName = "InpaintCanvas";
export default InpaintCanvas;
