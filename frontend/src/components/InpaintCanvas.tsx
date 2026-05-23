"use client";

import { Eraser, Paintbrush, Square, Trash2 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface InpaintCanvasHandle {
  getMaskBlob: () => Promise<Blob>;
  hasMask: () => boolean;
}

interface Props {
  imageFile: File;
}

type ToolMode = "brush" | "box" | "erase";

type Point = { x: number; y: number };

const InpaintCanvas = forwardRef<InpaintCanvasHandle, Props>(({ imageFile }, ref) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSrc, setImageSrc] = useState("");
  const [ready, setReady] = useState(false);
  const [displaySize, setDisplaySize] = useState({ width: 1, height: 1 });
  const [brushSize, setBrushSize] = useState(12);
  const [mode, setMode] = useState<ToolMode>("box");
  const [cursor, setCursor] = useState<Point | null>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const dragStart = useRef<Point | null>(null);
  const hasDrawnRef = useRef(false);
  const previewRect = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

  const getCanvasPos = useCallback((clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current!;
    const mask = maskCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(mask.width, (clientX - rect.left) * (mask.width / rect.width))),
      y: Math.max(0, Math.min(mask.height, (clientY - rect.top) * (mask.height / rect.height))),
    };
  }, []);

  const redrawOverlay = useCallback(() => {
    const display = displayCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!display || !mask) return;
    const dc = display.getContext("2d")!;
    dc.clearRect(0, 0, display.width, display.height);

    dc.save();
    dc.drawImage(mask, 0, 0, display.width, display.height);
    dc.globalCompositeOperation = "source-in";
    dc.fillStyle = "rgba(255, 112, 35, 0.53)";
    dc.fillRect(0, 0, display.width, display.height);
    dc.restore();

    const rect = previewRect.current;
    if (rect) {
      const scaleX = display.width / mask.width;
      const scaleY = display.height / mask.height;
      dc.save();
      dc.fillStyle = "rgba(255, 112, 35, 0.22)";
      dc.strokeStyle = "rgba(255, 255, 255, 0.96)";
      dc.lineWidth = 2;
      dc.setLineDash([8, 5]);
      dc.fillRect(rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
      dc.strokeRect(rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
      dc.restore();
    }
  }, []);

  useEffect(() => {
    setReady(false);
    hasDrawnRef.current = false;
    previewRect.current = null;
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

      setImageSrc(url);
      setReady(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile, redrawOverlay]);


  const syncDisplayCanvas = useCallback(() => {
    const image = imageRef.current;
    const display = displayCanvasRef.current;
    if (!image || !display) return;
    const rect = image.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (display.width !== nextWidth || display.height !== nextHeight) {
      display.width = nextWidth;
      display.height = nextHeight;
      setDisplaySize({ width: nextWidth, height: nextHeight });
    }
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    if (!ready) return;
    syncDisplayCanvas();
    const image = imageRef.current;
    if (!image || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncDisplayCanvas);
    observer.observe(image);
    return () => observer.disconnect();
  }, [ready, syncDisplayCanvas]);

  const setMaskCircle = useCallback((x: number, y: number, fill: string) => {
    const mask = maskCanvasRef.current;
    const display = displayCanvasRef.current;
    if (!mask || !display) return;
    const scaleX = mask.width / Math.max(1, display.width);
    const scaleY = mask.height / Math.max(1, display.height);
    const mc = mask.getContext("2d")!;
    mc.fillStyle = fill;
    mc.beginPath();
    mc.ellipse(x, y, (brushSize * scaleX) / 2, (brushSize * scaleY) / 2, 0, 0, Math.PI * 2);
    mc.fill();
  }, [brushSize]);

  const applyBrush = useCallback((x: number, y: number, redraw = true) => {
    setMaskCircle(x, y, mode === "erase" ? "black" : "white");
    if (mode !== "erase") hasDrawnRef.current = true;
    if (redraw) redrawOverlay();
  }, [mode, redrawOverlay, setMaskCircle]);

  const strokeTo = useCallback((to: Point) => {
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
      applyBrush(from.x + dx * t, from.y + dy * t, false);
    }
    redrawOverlay();
  }, [applyBrush, brushSize, redrawOverlay]);

  const applyBox = useCallback((from: Point, to: Point) => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const left = Math.min(from.x, to.x);
    const top = Math.min(from.y, to.y);
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < 4 || height < 4) return;
    const mc = mask.getContext("2d")!;
    mc.fillStyle = "white";
    mc.fillRect(left, top, width, height);
    hasDrawnRef.current = true;
    previewRect.current = null;
    redrawOverlay();
  }, [redrawOverlay]);

  const pointerDown = useCallback((clientX: number, clientY: number) => {
    const pos = getCanvasPos(clientX, clientY);
    setCursor(pos);
    isDrawing.current = true;
    dragStart.current = pos;
    lastPoint.current = pos;
    if (mode === "brush" || mode === "erase") applyBrush(pos.x, pos.y);
  }, [applyBrush, getCanvasPos, mode]);

  const pointerMove = useCallback((clientX: number, clientY: number) => {
    const pos = getCanvasPos(clientX, clientY);
    setCursor(pos);
    if (!isDrawing.current) return;
    if (mode === "box" && dragStart.current) {
      const start = dragStart.current;
      previewRect.current = {
        left: Math.min(start.x, pos.x),
        top: Math.min(start.y, pos.y),
        width: Math.abs(pos.x - start.x),
        height: Math.abs(pos.y - start.y),
      };
      lastPoint.current = pos;
      redrawOverlay();
      return;
    }
    strokeTo(pos);
    lastPoint.current = pos;
  }, [getCanvasPos, mode, redrawOverlay, strokeTo]);

  const stopDrawing = useCallback(() => {
    if (mode === "box" && dragStart.current && lastPoint.current) applyBox(dragStart.current, lastPoint.current);
    isDrawing.current = false;
    lastPoint.current = null;
    dragStart.current = null;
    previewRect.current = null;
    redrawOverlay();
  }, [applyBox, mode, redrawOverlay]);

  const clearMask = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const mc = mask.getContext("2d")!;
    mc.fillStyle = "black";
    mc.fillRect(0, 0, mask.width, mask.height);
    hasDrawnRef.current = false;
    previewRect.current = null;
    redrawOverlay();
  }, [redrawOverlay]);

  useImperativeHandle(ref, () => ({
    getMaskBlob: () => new Promise<Blob>((resolve, reject) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return reject(new Error("Mask canvas not ready"));
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to export mask"))), "image/png");
    }),
    hasMask: () => hasDrawnRef.current,
  }));

  const toolClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:bg-panel"}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" title="Select rectangular inpaint area" onClick={() => setMode("box")} className={toolClass(mode === "box")}>
          <Square className="h-3.5 w-3.5" /> Area
        </button>
        <button type="button" title="Paint inpaint area" onClick={() => setMode("brush")} className={toolClass(mode === "brush")}>
          <Paintbrush className="h-3.5 w-3.5" /> Brush
        </button>
        <button type="button" title="Remove selected area" onClick={() => setMode("erase")} className={toolClass(mode === "erase")}>
          <Eraser className="h-3.5 w-3.5" /> Eraser
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Size</span>
          <input type="range" min={2} max={40} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-24 accent-accent" />
          <span className="w-9 text-right text-xs text-muted">{brushSize}px</span>
        </div>
        <button type="button" onClick={clearMask} className="ml-auto flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-panel">
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      <div className="flex justify-center">
        <div className="relative inline-block max-w-full overflow-hidden rounded-md border border-line bg-black/5">
          {imageSrc && <img ref={imageRef} src={imageSrc} alt="Inpaint source" className="block max-w-full rounded-md" style={{ maxHeight: 520, display: "block" }} draggable={false} onLoad={syncDisplayCanvas} />}
          {ready && (
            <canvas
              ref={displayCanvasRef}
              className="absolute inset-0 h-full w-full rounded-md"
              style={{ cursor: "none", touchAction: "none" }}
              onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); pointerDown(e.clientX, e.clientY); } }}
              onMouseMove={(e) => pointerMove(e.clientX, e.clientY)}
              onMouseUp={stopDrawing}
              onMouseLeave={() => { setCursor(null); stopDrawing(); }}
              onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; pointerDown(t.clientX, t.clientY); }}
              onTouchMove={(e) => { e.preventDefault(); const t = e.touches[0]; pointerMove(t.clientX, t.clientY); }}
              onTouchEnd={stopDrawing}
            />
          )}
          {ready && cursor && (
            <div
              className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(255,112,35,0.95),0_0_12px_rgba(0,0,0,0.28)]"
              style={{
                left: `${(cursor.x / (maskCanvasRef.current?.width || 1)) * displaySize.width}px`,
                top: `${(cursor.y / (maskCanvasRef.current?.height || 1)) * displaySize.height}px`,
                width: mode === "box" ? 16 : `${brushSize}px`,
                height: mode === "box" ? 16 : `${brushSize}px`,
                transform: "translate(-50%, -50%)",
                background: mode === "erase" ? "rgba(255,255,255,0.14)" : "rgba(255,112,35,0.16)",
              }}
            />
          )}
        </div>
      </div>

      <canvas ref={maskCanvasRef} className="hidden" />
      <p className="text-xs text-muted">Drag Area for a clear target region, or use the 2-40px circular Brush/Eraser for fine masks. Orange overlay is the exact inpaint area.</p>
    </div>
  );
});

InpaintCanvas.displayName = "InpaintCanvas";
export default InpaintCanvas;
