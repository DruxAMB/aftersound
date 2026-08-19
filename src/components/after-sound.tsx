"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { SoundLevelMeter, type LevelData } from "@/lib/audio/meter";
import { allowedTime, formatDuration } from "@/lib/audio/niosh";
import { createScene, type SceneId } from "@/lib/audio/scenes";
import SpectrumVisualizer from "@/components/spectrum-visualizer";

gsap.registerPlugin(useGSAP);

type Phase = "landing" | "listening" | "captured" | "revealed" | "testing";

const SCENES: { id: SceneId; label: string }[] = [
  { id: "subway", label: "Subway" },
  { id: "cafe", label: "Café" },
  { id: "gym", label: "Gym" },
];

export default function AfterSound() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [error, setError] = useState<string | null>(null);
  const [laeq, setLaeq] = useState<number | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activeScene, setActiveScene] = useState<SceneId | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<SoundLevelMeter | null>(null);
  const sceneStopRef = useRef<(() => void) | null>(null);
  const sceneCtxRef = useRef<AudioContext | null>(null);
  const latestLevelRef = useRef<LevelData | null>(null);
  const rafRef = useRef<number | null>(null);

  // Throttled state updates from AudioWorklet (60fps max)
  useEffect(() => {
    if (phase !== "listening") return;
    const tick = () => {
      const data = latestLevelRef.current;
      if (data && isFinite(data.laeq)) {
        setLaeq(data.laeq);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMeter();
    };
  }, []);

  const stopMeter = useCallback(() => {
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
  }, []);

  const startMeter = useCallback(
    async (stream: MediaStream, ctx?: AudioContext) => {
      const meter = new SoundLevelMeter({
        onLevel: (data) => {
          latestLevelRef.current = data;
        },
      });
      meterRef.current = meter;
      await meter.startFromStream(stream, ctx);
      setAnalyser(meter.getAnalyser());
      setPhase("listening");
    },
    [],
  );

  const handleListen = useCallback(async () => {
    setError(null);
    stopMeter();
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
  }, [startMeter, stopMeter]);

  const handleScene = useCallback(
    async (sceneId: SceneId) => {
      setError(null);
      stopMeter();
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
    [startMeter, stopMeter],
  );

  const handleStop = useCallback(() => {
    stopMeter();
    setPhase("landing");
  }, [stopMeter]);

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

          {/* Scene switcher (visible when in a scene or as fallback) */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-zinc-600">Switch scene</p>
            <div className="flex gap-2">
              {SCENES.map((scene) => (
                <button
                  key={scene.id}
                  onClick={() => handleScene(scene.id)}
                  className={`h-8 rounded-full px-4 text-xs transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    activeScene === scene.id
                      ? "bg-white text-black"
                      : "border border-white/15 text-zinc-400 hover:border-white/30 hover:text-white"
                  }`}
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

  // Placeholder for subsequent phases — will be built in steps 3–7
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-center text-white">
      <p className="text-zinc-400">Building…</p>
      <button
        onClick={handleStop}
        className="mt-6 h-10 rounded-full border border-white/15 px-5 text-sm text-zinc-300 transition-all hover:border-white/30 hover:text-white"
      >
        Back
      </button>
    </div>
  );
}
