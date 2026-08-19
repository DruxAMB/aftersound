"use client";

import { useEffect, useRef } from "react";

type Props = {
  buffer: Float32Array | null;
  sampleRate: number;
  label: string;
  className?: string;
};

/**
 * Renders a waveform as SVG bars from captured audio data.
 * Not canvas, not hand-keyframed animation — static SVG with CSS.
 */
export default function WaveformChip({ buffer, sampleRate, label, className }: Props) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!buffer || !pathRef.current) return;

    // Downsample to ~80 bars
    const barCount = 80;
    const samplesPerBar = Math.floor(buffer.length / barCount);
    const width = 200;
    const height = 40;
    const barWidth = width / barCount;

    let pathD = "";
    for (let i = 0; i < barCount; i++) {
      let max = 0;
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, buffer.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(buffer[j]);
        if (abs > max) max = abs;
      }
      const barHeight = Math.max(2, max * height * 0.9);
      const x = i * barWidth + barWidth / 2;
      const yTop = (height - barHeight) / 2;
      const yBot = (height + barHeight) / 2;
      pathD += `M${x.toFixed(1)} ${yTop.toFixed(1)}L${x.toFixed(1)} ${yBot.toFixed(1)} `;
    }

    pathRef.current.setAttribute("d", pathD);
  }, [buffer, sampleRate]);

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-cards border border-paper-white/[0.06] bg-midnight-surface px-5 py-3 ${className ?? ""}`}
    >
      <svg width="200" height="40" viewBox="0 0 200 40">
        <path
          ref={pathRef}
          stroke="#19d0e8"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="ui-mono text-[12px] text-paper-white/50">{label}</span>
    </div>
  );
}
