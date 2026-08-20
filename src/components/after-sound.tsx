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
import HeroParticles from "@/components/hero-particles";
import { useReducedMotion } from "@/lib/use-reduced-motion";

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
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

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
    setPlaybackError(null);
    stopAll();
    setIsLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      await startMeter(stream);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone access denied. Try a sample scene below instead.");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError("No microphone found. Try a sample scene below instead.");
      } else {
        setError("Could not access microphone. Try a sample scene below instead.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [startMeter, stopAll]);

  const handleScene = useCallback(
    async (sceneId: SceneId) => {
      setError(null);
      setPlaybackError(null);
      stopAll();
      setIsLoading(true);
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
        setError("Could not start scene audio. Try another scene or use your microphone.");
      } finally {
        setIsLoading(false);
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
      setPlaybackError(null);
      // Stop current playback if any
      resynthesisRef.current.stop();
      setPlaybackMode(mode);
      setIsPlaying(true);
      try {
        await resynthesisRef.current.play(mode);
      } catch {
        setPlaybackError("Playback failed. Try again or start over.");
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
      // Reset all animated elements to visible first (prevents stuck opacity:0)
      gsap.set("[data-animate]", { opacity: 1, y: 0 });
      if (reducedMotion) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-animate='title']", { y: 30, opacity: 0, duration: 0.8 })
        .from("[data-animate='tagline']", { y: 20, opacity: 0, duration: 0.6 }, "-=0.4")
        .from("[data-animate='cta']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='scene-btn']", { y: 12, opacity: 0, duration: 0.4, stagger: 0.08 }, "-=0.2");
    },
    { scope: containerRef, dependencies: [phase, reducedMotion] },
  );

  // GSAP entrance for revealed phase
  useGSAP(
    () => {
      if (phase !== "revealed") return;
      gsap.set("[data-animate]", { opacity: 1, y: 0 });
      if (reducedMotion) return;
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-animate='reveal-title']", { y: 20, opacity: 0, duration: 0.6 })
        .from("[data-animate='reveal-waveform']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='reveal-ab']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3")
        .from("[data-animate='reveal-audiogram']", { y: 16, opacity: 0, duration: 0.5 }, "-=0.3");
    },
    { scope: containerRef, dependencies: [phase, reducedMotion] },
  );

  if (phase === "landing") {
    return (
      <div ref={containerRef} className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-void-black px-6 text-center">
        {/* Ghost wordmark — Instrument Serif, overflowing viewport */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="ghost-wordmark text-[180px] sm:text-[280px] md:text-[360px]">
            AfterSound
          </span>
        </div>

        {/* Subtle cyan glow — the single chromatic pulse */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse-slow"
            style={{ background: "radial-gradient(circle, rgba(25,208,232,0.05) 0%, transparent 70%)" }}
          />
        </div>

        {/* Drifting particles — dust motes in a dark room */}
        <HeroParticles />

        {/* Animated EQ bars — decorative sound wave at bottom */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex h-24 items-end justify-center gap-[2px] opacity-[0.12]">
          {Array.from({ length: 60 }).map((_, i) => (
            <div
              key={i}
              className="w-[2px] flex-1 animate-eq-bar rounded-full bg-paper-white"
              style={{
                animationDelay: `${i * 0.04}s`,
                animationDuration: `${1.2 + (i % 7) * 0.25}s`,
              }}
            />
          ))}
        </div>

        <main className="relative z-10 flex flex-col items-center gap-6">
          {/* DM Mono caption — like "Start working 3× faster today" */}
          <p
            data-animate="title"
            className="ui-mono text-[14px] text-paper-white/60"
          >
            Start hearing 3× clearer today
          </p>

          {/* Instrument Serif headline — normal style, 92px, tight leading */}
          <h1
            data-animate="tagline"
            className="heading-serif text-[56px] text-paper-white sm:text-[72px] md:text-[92px]"
            style={{ letterSpacing: "-0.03em", lineHeight: "0.78" }}
          >
            You can&apos;t hear the damage happening.
          </h1>

          {/* Description paragraph */}
          <p
            data-animate="tagline"
            className="max-w-lg text-body text-paper-white/50 leading-relaxed"
          >
            AfterSound measures the noise around you, projects your hearing forward,
            and replays five seconds of your world through your future ears.
          </p>

          {/* Primary CTA — white button matching monologue.to exactly */}
          <button
            data-animate="cta"
            onClick={handleListen}
            disabled={isLoading}
            className="btn-primary mt-4"
          >
            {isLoading ? "Starting…" : "Listen to your room"}
          </button>

          {error && (
            <div className="mt-2 max-w-sm rounded-medium border border-paper-white/10 bg-midnight-surface px-5 py-4 text-left">
              <p className="ui-mono text-[10px] caption-tracking text-electric-cyan uppercase mb-1">Error</p>
              <p className="text-sm text-paper-white/60">{error}</p>
            </div>
          )}

          {/* Scene buttons — secondary style */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <p className="ui-mono text-[12px] text-paper-white/40">
              or try a sample scene
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SCENES.map((scene) => (
                <button
                  key={scene.id}
                  data-animate="scene-btn"
                  onClick={() => handleScene(scene.id)}
                  className="btn-secondary"
                  style={{ height: "36px", fontSize: "12px" }}
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
      <div className="flex min-h-dvh flex-col bg-void-black px-6 py-8">
        <div className="mx-auto w-full max-w-6xl">
        <header className="flex items-center justify-between">
          <span className="ui-mono text-[14px] text-paper-white/60">
            {activeScene ? `${SCENES.find((s) => s.id === activeScene)?.label} scene` : "Your room"}
          </span>
          <button
            onClick={handleStop}
            className="btn-secondary"
            style={{ height: "36px", fontSize: "12px" }}
          >
            Stop
          </button>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-10 py-12">
          {/* Live dB readout — Instrument Serif at display scale */}
          <div className="flex flex-col items-center">
            <div
              className="heading-serif text-[80px] text-paper-white sm:text-[120px]"
              style={{ lineHeight: "0.9" }}
            >
              {laeq != null && isFinite(laeq) ? Math.round(laeq) : "—"}
            </div>
            <div className="ui-mono mt-3 text-[12px] text-paper-white/40">
              dBA · A-weighted
            </div>
          </div>

          {/* Spectrum visualization */}
          <SpectrumVisualizer
            analyser={analyser}
            className="w-full max-w-3xl"
          />

          {/* NIOSH safe daily dose — midnight card */}
          <div className="flex flex-col items-center gap-2 rounded-cards border border-paper-white/[0.06] bg-midnight-surface px-8 py-5">
            <p className="ui-mono text-[10px] caption-tracking text-paper-white/40 uppercase">
              Safe daily exposure
            </p>
            <p className="heading-serif-italic text-[32px] text-electric-cyan">
              {safeTime != null ? formatDuration(safeTime) : "—"}
            </p>
            <p className="ui-mono text-[10px] caption-tracking text-paper-white/30">
              NIOSH REL · 85 dBA · 3 dB exchange rate
            </p>
          </div>

          {/* Capture progress — cyan progress bar */}
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <div className="ui-mono flex w-full items-center justify-between text-[12px] text-paper-white/40">
              <span>Capturing {captureLabel}</span>
              <span className="tabular-nums">
                {Math.ceil(CAPTURE_DURATION - (captureProgress / 100) * CAPTURE_DURATION)}s
              </span>
            </div>
            <div className="h-[2px] w-full overflow-hidden rounded-[9px] bg-graphite">
              <div
                className="h-full rounded-[9px] bg-electric-cyan transition-[width] duration-100 ease-linear"
                style={{ width: `${captureProgress}%`, boxShadow: "0 0 8px rgba(25,208,232,0.5)" }}
              />
            </div>
          </div>
        </main>
        </div>
      </div>
    );
  }

  if (phase === "revealed") {
    const captureLabel = activeScene
      ? `${SCENES.find((s) => s.id === activeScene)?.label} · 5s`
      : "your room · 5s";
    return (
      <div ref={containerRef} className="flex min-h-dvh flex-col bg-void-black px-6 py-8">
        <div className="mx-auto w-full max-w-6xl">
        <header className="flex items-center justify-between">
          <span className="ui-mono text-[14px] text-paper-white/60">
            Your reveal
          </span>
          <button
            onClick={handleStop}
            className="btn-secondary"
            style={{ height: "36px", fontSize: "12px" }}
          >
            Start over
          </button>
        </header>

        <main className="flex flex-1 flex-col gap-10 py-10">
          {/* Hero heading — centered, full width */}
          <div className="flex flex-col items-center gap-6">
            <h2
              data-animate="reveal-title"
              className="heading-serif text-[48px] text-paper-white sm:text-[64px] md:text-[80px]"
              style={{ lineHeight: "0.85", textAlign: "center" }}
            >
              This is what it<br />could sound like
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
            <div data-animate="reveal-ab" className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => handlePlayback("clean")}
                disabled={isPlaying}
                className={playbackMode === "clean" && isPlaying ? "btn-primary" : "btn-secondary"}
              >
                ▶ As you heard it
              </button>
              <button
                onClick={() => handlePlayback("projected")}
                disabled={isPlaying}
                className={playbackMode === "projected" && isPlaying ? "btn-primary" : "btn-secondary"}
              >
                ▶ After {age} years
              </button>
            </div>

            {playbackError && (
              <p className="ui-mono text-[12px] text-electric-cyan">{playbackError}</p>
            )}
          </div>

          {/* Two-column: audiogram (left) + controls (right) */}
          <div className="flex flex-col gap-8 md:flex-row md:gap-12">
            {/* Audiogram — left, wider */}
            <div data-animate="reveal-audiogram" className="flex flex-1 flex-col gap-3 rounded-cards border border-paper-white/[0.06] bg-midnight-surface px-6 py-5">
              <p className="ui-mono text-[10px] caption-tracking text-paper-white/40 uppercase">
                Projected loss · age {age} · {dailyExposure} dBA daily
              </p>
              <AudiogramChart audiogram={audiogram} className="w-full" />
            </div>

            {/* Controls — right, narrower */}
            <div className="flex w-full flex-col gap-8 md:w-[320px] md:shrink-0">
              {/* Sliders */}
              <div className="flex flex-col gap-6">
                <p className="ui-mono text-[10px] caption-tracking text-paper-white/40 uppercase">
                  Adjust the projection
                </p>
                <div className="flex flex-col gap-2">
                  <div className="ui-mono flex items-center justify-between text-[12px]">
                    <label htmlFor="age-slider" className="text-paper-white/50">Age</label>
                    <span className="tabular-nums text-electric-cyan">{age}</span>
                  </div>
                  <input
                    id="age-slider"
                    type="range"
                    min={20}
                    max={80}
                    value={age}
                    onChange={(e) => setAge(Number(e.target.value))}
                    className="h-[2px] w-full cursor-pointer appearance-none rounded-[9px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="ui-mono flex items-center justify-between text-[12px]">
                    <label htmlFor="exposure-slider" className="text-paper-white/50">Daily exposure</label>
                    <span className="tabular-nums text-electric-cyan">{dailyExposure} dBA</span>
                  </div>
                  <input
                    id="exposure-slider"
                    type="range"
                    min={70}
                    max={110}
                    value={dailyExposure}
                    onChange={(e) => setDailyExposure(Number(e.target.value))}
                    className="h-[2px] w-full cursor-pointer appearance-none rounded-[9px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan"
                  />
                </div>
              </div>

              {/* Ear test CTA */}
              <div className="flex flex-col items-start gap-3 border-t border-paper-white/[0.06] pt-6">
                {earTestResults.length > 0 && (
                  <p className="ui-mono text-[10px] caption-tracking text-electric-cyan uppercase">
                    ✓ Measured thresholds applied
                  </p>
                )}
                <button
                  onClick={handleStartEarTest}
                  className="btn-secondary"
                >
                  {earTestResults.length > 0 ? "Retest your hearing" : "Test your actual hearing"}
                </button>
                <p className="ui-mono text-[10px] caption-tracking text-paper-white/30">
                  90 seconds · headphones recommended
                </p>
              </div>
            </div>
          </div>

          {/* Honest limits — full width */}
          <details className="w-full rounded-cards border border-paper-white/[0.06] bg-midnight-surface p-6">
            <summary className="ui-mono cursor-pointer text-[10px] caption-tracking text-paper-white/40 uppercase transition-colors hover:text-electric-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan">
              What this tool can and can&apos;t do
            </summary>
            <div className="mt-5 grid gap-5 md:grid-cols-2 text-[15px] leading-relaxed text-paper-white/50">
              <p>
                <span className="text-paper-white">Sound level:</span> The dB reading is
                uncalibrated. Consumer microphones vary ±15-20 dB from professional
                equipment. Use it to compare environments, not as an absolute measurement.
              </p>
              <p>
                <span className="text-paper-white">Hearing loss projection:</span> The NIPTS
                model is our own approximation, not the ISO 1999 standard (which is
                paywalled). It captures the general shape of noise-induced hearing loss
                (the 4 kHz notch, logarithmic age growth) but should not be used for risk
                assessment. For that, see an audiologist.
              </p>
              <p>
                <span className="text-paper-white">Ear test:</span> This is not a clinical
                audiometer. Results depend on your headphones, background noise, and
                response honesty. Calibrated audiometric equipment in a sound-treated booth
                is the only way to get a real threshold.
              </p>
              <p>
                <span className="text-paper-white">Resynthesis:</span> The &quot;after N years&quot;
                playback models hearing loss as frequency attenuation, spectral smearing,
                and — when loss is significant — tinnitus (a faint 4kHz ringing) plus a
                raised noise floor (reduced dynamic range). Real hearing loss also involves
                temporal smearing and loudness recruitment, which this tool does not simulate.
              </p>
            </div>
          </details>

          {/* Closing beat — centered, wide */}
          <div className="flex flex-col items-center gap-4 border-t border-paper-white/[0.06] pt-10 text-center">
            <p className="heading-serif-italic text-[32px] text-paper-white sm:text-[40px]">
              You can&apos;t undo hearing damage.
            </p>
            <p className="max-w-xl text-[15px] text-paper-white/50 leading-relaxed">
              But you can prevent it. Lower the volume, take breaks, and wear protection
              in loud environments.
            </p>
            <p className="ui-mono text-[10px] caption-tracking text-paper-white/30">
              NIOSH recommends 85 dBA max for 8 hours · 3 dB louder = half the safe time
            </p>
          </div>
        </main>
        </div>
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
