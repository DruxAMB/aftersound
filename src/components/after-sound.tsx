"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { SoundLevelMeter, type LevelData } from "@/lib/audio/meter";
import { allowedTime, formatDuration } from "@/lib/audio/niosh";
import { createScene, type SceneId } from "@/lib/audio/scenes";
import { computeAudiogram, DEFAULT_AGE, DEFAULT_DAILY_EXPOSURE, type Audiogram } from "@/lib/audio/nipts";
import { ResynthesisEngine, type PlaybackMode } from "@/lib/audio/resynthesis";
import SpectrumVisualizer from "@/components/spectrum-visualizer";
import WaveformChip from "@/components/waveform-chip";
import AudiogramChart from "@/components/audiogram-chart";
import EarTest from "@/components/ear-test";

gsap.registerPlugin(useGSAP);

type Phase = "landing" | "listening" | "revealed" | "testing";

const SCENES: { id: SceneId; label: string }[] = [
  { id: "subway", label: "Subway" },
  { id: "cafe", label: "Café" },
  { id: "gym", label: "Gym" },
];

const CAPTURE_DURATION = 5; // seconds

export default function AfterSound() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [error, setError] = useState<string | null>(null);
  const [laeq, setLaeq] = useState<number | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activeScene, setActiveScene] = useState<SceneId | null>(null);
  const [capturedBuffer, setCapturedBuffer] = useState<Float32Array | null>(null);
  const [capturedSampleRate, setCapturedSampleRate] = useState<number>(44100);
  const [captureProgress, setCaptureProgress] = useState<number>(0);
  const [audiogram, setAudiogram] = useState<Audiogram | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [age, setAge] = useState(DEFAULT_AGE);
  const [dailyExposure, setDailyExposure] = useState(DEFAULT_DAILY_EXPOSURE);
  const [earTestResults, setEarTestResults] = useState<{ frequency: number; threshold: number | null }[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<SoundLevelMeter | null>(null);
  const sceneStopRef = useRef<(() => void) | null>(null);
  const sceneCtxRef = useRef<AudioContext | null>(null);
  const resynthesisRef = useRef<ResynthesisEngine | null>(null);
  const latestLevelRef = useRef<LevelData | null>(null);
  const rafRef = useRef<number | null>(null);
  const captureStartTimeRef = useRef<number>(0);

  // Throttled state updates from AudioWorklet (60fps max)
  useEffect(() => {
    if (phase !== "listening") return;
    const tick = () => {
      const data = latestLevelRef.current;
      if (data && isFinite(data.laeq)) {
        setLaeq(data.laeq);
      }
      // Update capture progress
      if (captureStartTimeRef.current > 0) {
        const elapsed = (performance.now() - captureStartTimeRef.current) / 1000;
        const progress = Math.min(100, (elapsed / CAPTURE_DURATION) * 100);
        setCaptureProgress(progress);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  // Recompute audiogram when age or exposure changes (in revealed phase)
  useEffect(() => {
    if (phase !== "revealed") return;
    const newAudiogram = computeAudiogram(age, dailyExposure);
    setAudiogram(newAudiogram);
    if (resynthesisRef.current) {
      resynthesisRef.current.setAudiogram(newAudiogram);
    }
  }, [phase, age, dailyExposure]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  const stopAll = useCallback(() => {
    if (resynthesisRef.current) {
      resynthesisRef.current.destroy();
      resynthesisRef.current = null;
    }
    if (meterRef.current) {
      meterRef.current.stop();
      meterRef.current = null;
    }
    if (sceneStopRef.current) {
      sceneStopRef.current();
      sceneStopRef.current = null;
    }
    if (sceneCtxRef.current) {
      sceneCtxRef.current.close().catch(() => {});
      sceneCtxRef.current = null;
    }
    setAnalyser(null);
    setLaeq(null);
    setActiveScene(null);
    setCapturedBuffer(null);
    setCaptureProgress(0);
    setAudiogram(null);
    setPlaybackMode(null);
    setIsPlaying(false);
    captureStartTimeRef.current = 0;
  }, []);

  const startMeter = useCallback(
    async (stream: MediaStream, ctx?: AudioContext) => {
      const meter = new SoundLevelMeter({
        onLevel: (data) => {
          latestLevelRef.current = data;
        },
        onCaptured: (buffer, sampleRate) => {
          setCapturedBuffer(buffer);
          setCapturedSampleRate(sampleRate);
          // Hand off audio context to resynthesis engine
          const audioCtx = meter.detachAudioContext();
          meterRef.current = null;
          if (sceneStopRef.current) {
            sceneStopRef.current();
            sceneStopRef.current = null;
          }
          if (audioCtx) {
            const engine = new ResynthesisEngine(audioCtx);
            engine.loadCapturedAudio(buffer, sampleRate);
            const newAudiogram = computeAudiogram(age, dailyExposure);
            engine.setAudiogram(newAudiogram);
            resynthesisRef.current = engine;
            setAudiogram(newAudiogram);
          }
          setPhase("revealed");
        },
      });
      meterRef.current = meter;
      await meter.startFromStream(stream, ctx);
      setAnalyser(meter.getAnalyser());
      setPhase("listening");
      // Start capture immediately
      meter.startCapture(CAPTURE_DURATION);
      captureStartTimeRef.current = performance.now();
    },
    [age, dailyExposure],
  );

  const handleListen = useCallback(async () => {
    setError(null);
    stopAll();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      await startMeter(stream);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone access denied. Try a sample scene below.");
      } else {
        setError("Could not access microphone. Try a sample scene below.");
      }
    }
  }, [startMeter, stopAll]);

  const handleScene = useCallback(
    async (sceneId: SceneId) => {
      setError(null);
      stopAll();
      try {
        const ctx = new AudioContext();
        sceneCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const { stream, stop } = createScene(sceneId, ctx);
        sceneStopRef.current = stop;
        setActiveScene(sceneId);
        await startMeter(stream, ctx);
      } catch {
        setError("Could not start scene audio.");
      }
    },
    [startMeter, stopAll],
  );

  const handleStop = useCallback(() => {
    stopAll();
    setPhase("landing");
  }, [stopAll]);

  const handlePlayback = useCallback(
    async (mode: PlaybackMode) => {
      if (!resynthesisRef.current) return;
      // Stop current playback if any
      resynthesisRef.current.stop();
      setPlaybackMode(mode);
      setIsPlaying(true);
      try {
        await resynthesisRef.current.play(mode);
      } catch {
        // playback error
      }
      setIsPlaying(false);
    },
    [],
  );

  const handleStartEarTest = useCallback(() => {
    // Stop any playback
    if (resynthesisRef.current) {
      resynthesisRef.current.stop();
    }
    setIsPlaying(false);
    setPhase("testing");
  }, []);

  const handleEarTestComplete = useCallback(
    (results: { frequency: number; threshold: number | null }[]) => {
      setEarTestResults(results);
      // Update audiogram with measured thresholds overlaid on projected
      if (audiogram) {
        const updatedAudiogram = audiogram.map((point) => {
          const measured = results.find((r) => r.frequency === point.frequency);
          if (measured && measured.threshold != null) {
            // Use measured threshold if higher than projected (existing loss)
            return {
              ...point,
              thresholdShift: Math.max(point.thresholdShift, measured.threshold),
            };
          }
          return point;
        });
        setAudiogram(updatedAudiogram);
        if (resynthesisRef.current) {
          resynthesisRef.current.setAudiogram(updatedAudiogram);
        }
      }
      setPhase("revealed");
    },
    [audiogram],
  );

  const handleEarTestBack = useCallback(() => {
    setPhase("revealed");
  }, []);

  // GSAP entrance animation for landing
  useGSAP(
    () => {
      if (phase !== "landing") return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-animate='title']", { y: 30, opacity: 0, duration: 0.8 })
        .from("[data-animate='tagline']", { y: 20, opacity: 0, duration: 0.6 }, "-=0.4")
        .from("[data-animate='cta']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='scene-btn']", { y: 12, opacity: 0, duration: 0.4, stagger: 0.08 }, "-=0.2");
    },
    { scope: containerRef, dependencies: [phase] },
  );

  // GSAP entrance for revealed phase
  useGSAP(
    () => {
      if (phase !== "revealed") return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-animate='reveal-title']", { y: 20, opacity: 0, duration: 0.6 })
        .from("[data-animate='reveal-waveform']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='reveal-ab']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='reveal-audiogram']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3");
    },
    { scope: containerRef, dependencies: [phase] },
  );

  if (phase === "landing") {
    return (
      <div ref={containerRef} className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-center">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)" }}
          />
        </div>

        <main className="relative z-10 flex flex-col items-center gap-6">
          <h1
            data-animate="title"
            className="text-5xl font-semibold tracking-tight text-white sm:text-7xl"
          >
            AfterSound
          </h1>
          <p
            data-animate="tagline"
            className="max-w-md text-lg leading-8 text-zinc-400 sm:text-xl"
          >
            You can&apos;t hear the damage happening.
            <br />
            <span className="text-zinc-200">Now you can.</span>
          </p>

          <button
            data-animate="cta"
            onClick={handleListen}
            className="mt-4 h-14 rounded-full bg-white px-8 text-base font-medium text-black transition-all hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]"
          >
            Listen to your room
          </button>

          {error && (
            <p className="max-w-sm text-sm text-amber-400">{error}</p>
          )}

          <div className="mt-8 flex flex-col items-center gap-3">
            <p className="text-sm text-zinc-500">or try a sample scene</p>
            <div className="flex gap-3">
              {SCENES.map((scene) => (
                <button
                  key={scene.id}
                  data-animate="scene-btn"
                  onClick={() => handleScene(scene.id)}
                  className="h-10 rounded-full border border-white/15 px-5 text-sm text-zinc-300 transition-all hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]"
                >
                  {scene.label}
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (phase === "listening") {
    const safeTime = laeq != null ? allowedTime(laeq) : null;
    const captureLabel = activeScene
      ? `${SCENES.find((s) => s.id === activeScene)?.label} · 5s`
      : "your room · 5s";
    return (
      <div className="flex min-h-dvh flex-col bg-black px-6 py-8">
        <header className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-500">
            {activeScene ? `${SCENES.find((s) => s.id === activeScene)?.label} scene` : "Your room"}
          </span>
          <button
            onClick={handleStop}
            className="h-9 rounded-full border border-white/15 px-4 text-sm text-zinc-400 transition-all hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Stop
          </button>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-8">
          {/* Live dB readout */}
          <div className="flex flex-col items-center">
            <div className="text-7xl font-semibold tabular-nums text-white sm:text-8xl">
              {laeq != null && isFinite(laeq) ? Math.round(laeq) : "—"}
            </div>
            <div className="mt-1 text-sm font-medium uppercase tracking-widest text-zinc-500">
              dBA
            </div>
          </div>

          {/* Spectrum visualization */}
          <SpectrumVisualizer
            analyser={analyser}
            className="w-full max-w-2xl"
          />

          {/* NIOSH safe daily dose */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm text-zinc-500">
              At this level, your safe daily exposure is
            </p>
            <p className="text-2xl font-medium text-white">
              {safeTime != null ? formatDuration(safeTime) : "—"}
            </p>
            <p className="text-xs text-zinc-600">
              NIOSH REL · 85 dBA · 3 dB exchange rate
            </p>
          </div>

          {/* Capture progress */}
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Capturing {captureLabel}</span>
              <span className="tabular-nums">
                {Math.ceil(CAPTURE_DURATION - (captureProgress / 100) * CAPTURE_DURATION)}s
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear"
                style={{ width: `${captureProgress}%` }}
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (phase === "revealed") {
    const captureLabel = activeScene
      ? `${SCENES.find((s) => s.id === activeScene)?.label} · 5s`
      : "your room · 5s";
    return (
      <div ref={containerRef} className="flex min-h-dvh flex-col bg-black px-6 py-8">
        <header className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-500">Your reveal</span>
          <button
            onClick={handleStop}
            className="h-9 rounded-full border border-white/15 px-4 text-sm text-zinc-400 transition-all hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Start over
          </button>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-8">
          <h2 data-animate="reveal-title" className="text-2xl font-semibold text-white sm:text-3xl">
            This is what it could sound like
          </h2>

          {/* Waveform chip */}
          <div data-animate="reveal-waveform">
            <WaveformChip
              buffer={capturedBuffer}
              sampleRate={capturedSampleRate}
              label={captureLabel}
            />
          </div>

          {/* A/B playback buttons */}
          <div data-animate="reveal-ab" className="flex gap-3">
            <button
              onClick={() => handlePlayback("clean")}
              disabled={isPlaying}
              className={`h-12 rounded-full px-6 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 ${
                playbackMode === "clean" && isPlaying
                  ? "bg-white text-black"
                  : "border border-white/15 text-zinc-300 hover:border-white/30 hover:text-white"
              }`}
            >
              ▶ As you heard it
            </button>
            <button
              onClick={() => handlePlayback("projected")}
              disabled={isPlaying}
              className={`h-12 rounded-full px-6 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 ${
                playbackMode === "projected" && isPlaying
                  ? "bg-white text-black"
                  : "border border-white/15 text-zinc-300 hover:border-white/30 hover:text-white"
              }`}
            >
              ▶ After {age} years
            </button>
          </div>

          {/* Audiogram */}
          <div data-animate="reveal-audiogram" className="flex flex-col items-center gap-2">
            <p className="text-sm text-zinc-500">
              Projected hearing loss at age {age} · {dailyExposure} dBA daily
            </p>
            <AudiogramChart audiogram={audiogram} className="w-full max-w-sm" />
          </div>

          {/* Age and exposure sliders */}
          <div className="flex w-full max-w-sm flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="age-slider" className="text-zinc-400">Age</label>
                <span className="tabular-nums text-white">{age}</span>
              </div>
              <input
                id="age-slider"
                type="range"
                min={20}
                max={80}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="exposure-slider" className="text-zinc-400">Daily exposure</label>
                <span className="tabular-nums text-white">{dailyExposure} dBA</span>
              </div>
              <input
                id="exposure-slider"
                type="range"
                min={70}
                max={110}
                value={dailyExposure}
                onChange={(e) => setDailyExposure(Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
            </div>
          </div>

          {/* Ear test CTA */}
          <div className="flex flex-col items-center gap-2 border-t border-white/10 pt-6">
            {earTestResults.length > 0 && (
              <p className="text-xs text-green-400/80">
                ✓ Measured thresholds applied to your projection
              </p>
            )}
            <button
              onClick={handleStartEarTest}
              className="h-11 rounded-full border border-white/15 px-6 text-sm font-medium text-zinc-300 transition-all hover:border-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]"
            >
              {earTestResults.length > 0 ? "Retest your actual hearing" : "Test your actual hearing"}
            </button>
            <p className="text-xs text-zinc-600">90 seconds · headphones recommended</p>
          </div>

          {/* Honest limits panel */}
          <details className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              What this tool can and can&apos;t do
            </summary>
            <div className="mt-4 space-y-3 text-xs leading-5 text-zinc-500">
              <p>
                <span className="text-zinc-300">Sound level:</span> The dB reading is
                uncalibrated. Consumer microphones vary ±15-20 dB from professional
                equipment. Use it to compare environments, not as an absolute measurement.
              </p>
              <p>
                <span className="text-zinc-300">Hearing loss projection:</span> The NIPTS
                model is our own approximation, not the ISO 1999 standard (which is
                paywalled). It captures the general shape of noise-induced hearing loss
                (the 4 kHz notch, logarithmic age growth) but should not be used for risk
                assessment. For that, see an audiologist.
              </p>
              <p>
                <span className="text-zinc-300">Ear test:</span> This is not a clinical
                audiometer. Results depend on your headphones, background noise, and
                response honesty. Calibrated audiometric equipment in a sound-treated booth
                is the only way to get a real threshold.
              </p>
              <p>
                <span className="text-zinc-300">Resynthesis:</span> The &quot;after N years&quot;
                playback models hearing loss as frequency attenuation and spectral smearing.
                Real hearing loss also involves reduced dynamic range, temporal smearing,
                and tinnitus — which this tool does not simulate.
              </p>
            </div>
          </details>

          {/* Closing beat */}
          <div className="flex w-full max-w-md flex-col items-center gap-3 border-t border-white/10 pt-6 text-center">
            <p className="text-base text-zinc-300">
              You can&apos;t undo hearing damage.
            </p>
            <p className="text-sm text-zinc-500">
              But you can prevent it. Lower the volume, take breaks, and wear protection
              in loud environments.
            </p>
            <p className="text-xs text-zinc-600">
              NIOSH recommends 85 dBA max for 8 hours. 3 dB louder = half the safe time.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (phase === "testing") {
    const audioCtx = resynthesisRef.current?.getAudioContext?.() ?? sceneCtxRef.current;
    return (
      <EarTest
        audioCtx={audioCtx ?? null}
        onComplete={handleEarTestComplete}
        onBack={handleEarTestBack}
      />
    );
  }

  // Fallback — should not be reached
  return null;
}
