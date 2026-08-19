"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import {
  createStaircase,
  recordResponse,
  DEFAULT_STAIRCASE_CONFIG,
  type StaircaseState,
} from "@/lib/audio/staircase";
import { startTone } from "@/lib/audio/tone-generator";
import { AUDIO_FREQS } from "@/lib/audio/nipts";
import { useReducedMotion } from "@/lib/use-reduced-motion";

gsap.registerPlugin(useGSAP);

type Props = {
  audioCtx: AudioContext | null;
  onComplete: (results: { frequency: number; threshold: number | null }[]) => void;
  onBack: () => void;
};

type TestPhase = "intro" | "testing" | "done";

// Test 2 frequencies to fit in ~90 seconds
const TEST_FREQS = [1000, 4000];

export default function EarTest({ audioCtx, onComplete, onBack }: Props) {
  const [testPhase, setTestPhase] = useState<TestPhase>("intro");
  const [currentFreqIndex, setCurrentFreqIndex] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(DEFAULT_STAIRCASE_CONFIG.startLevel);
  const [results, setResults] = useState<{ frequency: number; threshold: number | null }[]>([]);
  const [isPlayingTone, setIsPlayingTone] = useState(false);
  const [trialCount, setTrialCount] = useState(0);
  const reducedMotion = useReducedMotion();

  const staircaseRef = useRef<StaircaseState>(createStaircase(DEFAULT_STAIRCASE_CONFIG));
  const currentToneRef = useRef<{ stop: () => void } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(audioCtx);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    audioCtxRef.current = audioCtx;
  }, [audioCtx]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentToneRef.current) {
        currentToneRef.current.stop();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const playNextTone = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const freq = TEST_FREQS[currentFreqIndex];
    const level = staircaseRef.current.currentLevel;

    // Random delay 0.5-2s before tone (so user can't predict)
    const delay = 500 + Math.random() * 1500;

    timeoutRef.current = setTimeout(() => {
      if (!audioCtxRef.current) return;
      setIsPlayingTone(true);

      // Play a 1-second tone
      const tone = startTone(audioCtxRef.current, freq, level, 1.0);
      currentToneRef.current = tone;

      tone.promise.then(() => {
        setIsPlayingTone(false);
        currentToneRef.current = null;
        // Auto-record "no" if user didn't respond within 2s after tone
        timeoutRef.current = setTimeout(() => {
          handleResponse(false);
        }, 2000);
      });
    }, delay);
  }, [currentFreqIndex]);

  const handleResponse = useCallback(
    (heard: boolean) => {
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Stop current tone if still playing
      if (currentToneRef.current) {
        currentToneRef.current.stop();
        currentToneRef.current = null;
      }
      setIsPlayingTone(false);

      const { state: newState, nextLevel } = recordResponse(
        staircaseRef.current,
        heard,
        DEFAULT_STAIRCASE_CONFIG,
      );
      staircaseRef.current = newState;
      setCurrentLevel(nextLevel);
      setTrialCount((c) => c + 1);

      if (newState.isComplete) {
        // Save result and move to next frequency
        const freq = TEST_FREQS[currentFreqIndex];
        const newResults = [...results, { frequency: freq, threshold: newState.threshold }];
        setResults(newResults);

        if (currentFreqIndex + 1 < TEST_FREQS.length) {
          // Next frequency
          setCurrentFreqIndex(currentFreqIndex + 1);
          staircaseRef.current = createStaircase(DEFAULT_STAIRCASE_CONFIG);
          setCurrentLevel(DEFAULT_STAIRCASE_CONFIG.startLevel);
          setTrialCount(0);
          // Small delay before starting next frequency
          timeoutRef.current = setTimeout(() => playNextTone(), 1500);
        } else {
          // All frequencies done
          setTestPhase("done");
        }
      } else {
        // Continue with next trial
        playNextTone();
      }
    },
    [currentFreqIndex, results, playNextTone],
  );

  const handleStart = useCallback(() => {
    if (!audioCtxRef.current) return;
    staircaseRef.current = createStaircase(DEFAULT_STAIRCASE_CONFIG);
    setCurrentLevel(DEFAULT_STAIRCASE_CONFIG.startLevel);
    setTrialCount(0);
    setResults([]);
    setCurrentFreqIndex(0);
    setTestPhase("testing");
    // Start first trial after a brief delay
    setTimeout(() => playNextTone(), 1000);
  }, [playNextTone]);

  const handleFinish = useCallback(() => {
    onComplete(results);
  }, [results, onComplete]);

  // GSAP for intro
  useGSAP(
    () => {
      if (testPhase !== "intro") return;
      gsap.set("[data-animate='test-intro']", { opacity: 1, y: 0 });
      if (reducedMotion) return;
      gsap.from("[data-animate='test-intro']", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.15,
      });
    },
    { scope: containerRef, dependencies: [testPhase, reducedMotion] },
  );

  if (testPhase === "intro") {
    return (
      <div ref={containerRef} className="flex min-h-dvh flex-col bg-void-black px-6 py-8">
        <header className="flex items-center justify-between">
          <span className="ui-mono text-caption uppercase caption-tracking text-steel-gray">Ear test</span>
          <button
            onClick={onBack}
            className="ui-mono h-9 rounded-full border border-graphite px-4 text-caption caption-tracking text-steel-gray transition-all hover:border-electric-cyan hover:text-electric-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan"
          >
            Back
          </button>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-8">
          <h2 data-animate="test-intro" className="heading-serif text-heading text-paper-white sm:text-heading-lg text-center">
            Test your
            <br />
            actual hearing
          </h2>
          <div data-animate="test-intro" className="max-w-md space-y-4 text-center">
            <p className="text-body text-steel-gray">
              We&apos;ll play tones at {TEST_FREQS.map((f) => (f >= 1000 ? `${f / 1000}k` : f)).join(" and ")} Hz,
              getting quieter until you can barely hear them.
            </p>
            <p className="ui-mono text-caption caption-tracking text-steel-gray">
              For best results: use headphones, be in a quiet room, close your eyes
            </p>
            <p className="ui-mono text-caption caption-tracking text-electric-cyan">
              Not a clinical hearing test · results are approximate
            </p>
          </div>
          <button
            data-animate="test-intro"
            onClick={handleStart}
            className="ui-mono mt-4 h-12 rounded-full bg-electric-cyan px-8 text-sm text-void-black transition-all hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan active:scale-[0.98]"
            style={{ boxShadow: "0 0 24px rgba(25,208,232,0.3)" }}
          >
            Start ear test
          </button>
        </main>
      </div>
    );
  }

  if (testPhase === "testing") {
    const freq = TEST_FREQS[currentFreqIndex];
    const freqLabel = freq >= 1000 ? `${freq / 1000}k` : freq;
    return (
      <div className="flex min-h-dvh flex-col bg-void-black px-6 py-8">
        <header className="flex items-center justify-between">
          <span className="ui-mono text-caption uppercase caption-tracking text-steel-gray">
            Testing {freqLabel} Hz · {currentFreqIndex + 1}/{TEST_FREQS.length}
          </span>
          <span className="ui-mono text-caption caption-tracking text-steel-gray tabular-nums">Trial {trialCount}</span>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-10">
          <p className="heading-serif text-heading-sm text-paper-white">
            {isPlayingTone ? "Did you hear it?" : "Listen carefully…"}
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              onClick={() => handleResponse(true)}
              className="ui-mono h-14 w-full rounded-full bg-electric-cyan px-8 text-caption caption-tracking text-void-black transition-all hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan active:scale-[0.98] sm:w-40"
            >
              Yes, I heard it
            </button>
            <button
              onClick={() => handleResponse(false)}
              className="ui-mono h-14 w-full rounded-full border border-graphite px-8 text-caption caption-tracking text-steel-gray transition-all hover:border-electric-cyan hover:text-electric-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan active:scale-[0.98] sm:w-40"
            >
              No, I didn&apos;t
            </button>
          </div>

          <p className="ui-mono max-w-xs text-center text-caption caption-tracking text-steel-gray">
            Tones play at random intervals · respond only after you hear (or don&apos;t hear) a tone
          </p>
        </main>
      </div>
    );
  }

  // Done phase
  return (
    <div className="flex min-h-dvh flex-col bg-void-black px-6 py-8">
      <header className="flex items-center justify-between">
        <span className="ui-mono text-caption uppercase caption-tracking text-steel-gray">Ear test results</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10">
        <h2 className="heading-serif text-heading text-paper-white sm:text-heading-lg text-center">
          Your measured
          <br />
          thresholds
        </h2>

        <div className="flex flex-col gap-3">
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-12 rounded-cards border border-graphite bg-midnight-surface px-6 py-4"
            >
              <span className="ui-mono text-caption caption-tracking text-steel-gray">
                {r.frequency >= 1000 ? `${r.frequency / 1000}k` : r.frequency} Hz
              </span>
              <span className="heading-serif text-heading-sm text-electric-cyan tabular-nums">
                {r.threshold != null ? `${Math.round(r.threshold)} dB HL` : "—"}
              </span>
            </div>
          ))}
        </div>

        <p className="ui-mono max-w-sm text-center text-caption caption-tracking text-steel-gray">
          These thresholds replace the population average in your projection
        </p>

        <button
          onClick={handleFinish}
          className="ui-mono h-12 rounded-full bg-electric-cyan px-8 text-sm text-void-black transition-all hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-cyan active:scale-[0.98]"
          style={{ boxShadow: "0 0 24px rgba(25,208,232,0.3)" }}
        >
          See my updated projection
        </button>
      </main>
    </div>
  );
}
