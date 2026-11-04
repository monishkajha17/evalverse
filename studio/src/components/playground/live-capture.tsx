"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Square, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_VOICE_S = 20;

function permissionMessage(err: unknown, kind: "camera" | "mic"): string {
  const name =
    err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return kind === "camera"
      ? "Camera permission denied. Allow camera access in your browser settings, then try again."
      : "Microphone permission denied. Allow mic access in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return kind === "camera" ? "No camera found on this device." : "No microphone found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return kind === "camera"
      ? "Camera is already in use by another app."
      : "Microphone is already in use by another app.";
  }
  return kind === "camera"
    ? "Couldn’t open the camera. Try again or upload a photo instead."
    : "Couldn’t open the microphone. Try again or upload an audio file instead.";
}

export function CameraCapture({
  onCapture,
  disabled,
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture isn’t supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (err) {
      setError(permissionMessage(err, "camera"));
      setOpen(false);
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        stop();
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={start}>
          <Camera className="mr-1.5 h-3.5 w-3.5" />
          Use camera
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
          <video
            ref={videoRef}
            muted
            playsInline
            className="max-h-48 w-full rounded bg-ink/90 object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={takePhoto}>
              Take photo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={stop}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error ? <p className="text-xs text-crimson">{error}</p> : null}
    </div>
  );
}

export function VoiceRecorder({
  onCapture,
  disabled,
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    return () => {
      cleanup();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }

  function pickMime(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  async function start() {
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewFile(null);
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording isn’t supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tickLevel = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(1, sum / (data.length * 180)));
        rafRef.current = requestAnimationFrame(tickLevel);
      };
      rafRef.current = requestAnimationFrame(tickLevel);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: type.split(";")[0] });
        const url = URL.createObjectURL(blob);
        setPreviewFile(file);
        setPreviewUrl(url);
        cleanup();
        setRecording(false);
      };

      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const s = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(s);
        if (s >= MAX_VOICE_S) stop();
      }, 200);
    } catch (err) {
      cleanup();
      setError(permissionMessage(err, "mic"));
      setRecording(false);
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        cleanup();
        setRecording(false);
      }
    } else {
      cleanup();
      setRecording(false);
    }
  }

  function useRecording() {
    if (!previewFile) return;
    onCapture(previewFile);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFile(null);
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFile(null);
  }

  const remaining = Math.max(0, MAX_VOICE_S - elapsed);

  return (
    <div className="space-y-2">
      {!recording && !previewFile ? (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={start}>
          <Mic className="mr-1.5 h-3.5 w-3.5" />
          Record voice
        </Button>
      ) : null}

      {recording ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-ink/70">
            <span className="font-medium text-crimson">Recording…</span>
            <span className="tabular-nums">
              {elapsed.toFixed(1)}s · {remaining.toFixed(0)}s left
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full bg-teal transition-[width] duration-100")}
              style={{ width: `${Math.max(4, level * 100)}%` }}
            />
          </div>
          <Button type="button" size="sm" onClick={stop}>
            <StopCircle className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      ) : null}

      {previewFile && previewUrl ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <audio controls src={previewUrl} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={useRecording}>
              Use recording
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={discard}>
              <Square className="mr-1 h-3 w-3" />
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-crimson">{error}</p> : null}
    </div>
  );
}
