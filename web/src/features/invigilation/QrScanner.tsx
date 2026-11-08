import jsQR from 'jsqr';
import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Live camera preview that decodes QR codes and reports each one through onCode (the parent decides what to do
 * and ignores repeats). Needs https (or localhost) for the browser to allow the camera; if that is not possible
 * the parent still has its manual code box.
 */
export function QrScanner({ onCode, paused = false }: { onCode: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem(window.isSecureContext ? 'This browser cannot open the camera.' : 'The camera needs a secure (https) connection.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        timer = setInterval(() => {
          const c = canvas.current;
          if (!c || pausedRef.current || el.readyState < 2 || !el.videoWidth) return;
          const scale = Math.min(1, 640 / el.videoWidth);
          c.width = Math.round(el.videoWidth * scale);
          c.height = Math.round(el.videoHeight * scale);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(el, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (hit?.data) handler.current(hit.data);
        }, 150);
      } catch (e) {
        const name = (e as DOMException).name;
        setProblem(
          name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, then reload.'
            : name === 'NotFoundError' ? 'No camera was found on this device.'
              : 'Could not start the camera.',
        );
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (problem) {
    return (
      <div role="alert" className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-line bg-bg-tertiary p-4 text-center text-ink-secondary">
        <CameraOff className="h-6 w-6" aria-hidden />
        <p>{problem}</p>
        <p className="text-xs">You can still paste the card code or link in the box below.</p>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-black">
      <video ref={video} muted playsInline className="aspect-video w-full object-cover" aria-label="Camera preview" />
      <canvas ref={canvas} className="hidden" />
      <div aria-hidden className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
    </div>
  );
}
