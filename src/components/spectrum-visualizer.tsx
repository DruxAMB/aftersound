"use client";

import { useEffect, useRef } from "react";
import AudioMotionAnalyzer from "audiomotion-analyzer";

type Props = {
  analyser: AnalyserNode | null;
  className?: string;
};

export default function SpectrumVisualizer({ analyser, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const analyzerRef = useRef<AudioMotionAnalyzer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !analyser) return;

    // Create AudioMotionAnalyzer with the provided AnalyserNode
    const audioMotion = new AudioMotionAnalyzer(containerRef.current, {
      source: analyser,
      connectSpeakers: false,
      fftSize: 2048,
      smoothing: 0.8,
      gradient: "rainbow",
      bgAlpha: 0,
      fillAlpha: 0,
      showScaleX: false,
      showScaleY: false,
      showPeaks: false,
      ledBars: false,
      lumiBars: false,
      roundBars: true,
      barSpace: 0.3,
      reflexRatio: 0.3,
      reflexAlpha: 0.25,
      frequencyScale: "log",
      weightingFilter: "A",
      height: 200,
      mode: 5, // discrete frequencies mode
      colorMode: "bar-index",
    });

    analyzerRef.current = audioMotion;

    return () => {
      audioMotion.destroy();
      analyzerRef.current = null;
    };
  }, [analyser]);

  return <div ref={containerRef} className={className} />;
}
