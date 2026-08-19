"use client";

import { useCallback, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

type Phase = "landing" | "listening" | "captured" | "revealed" | "testing";

const SCENES = [
  { id: "subway", label: "Subway" },
  { id: "cafe", label: "Café" },
  { id: "gym", label: "Gym" },
] as const;

export default function AfterSound() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleListen = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // For now, just transition to listening phase.
      // Step 2 will wire up the full meter UI.
      stream.getTracks().forEach((t) => t.stop());
      setPhase("listening");
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Microphone access denied. Try a sample scene below.");
      } else {
        setError("Could not access microphone. Try a sample scene below.");
      }
    }
  }, []);

  const handleScene = useCallback(async (_sceneId: string) => {
    // Step 2 will wire up bundled scene playback.
    setPhase("listening");
  }, []);

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

  // Placeholder for subsequent phases — will be built in steps 2–7
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-center text-white">
      <p className="text-zinc-400">Building…</p>
      <button
        onClick={() => setPhase("landing")}
        className="mt-6 h-10 rounded-full border border-white/15 px-5 text-sm text-zinc-300 transition-all hover:border-white/30 hover:text-white"
      >
        Back
      </button>
    </div>
  );
}
