"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { AUDIO_FREQS, type Audiogram } from "@/lib/audio/nipts";
import { useReducedMotion } from "@/lib/use-reduced-motion";

gsap.registerPlugin(useGSAP);

type Props = {
  audiogram: Audiogram | null;
  className?: string;
};

/**
 * Audiogram chart — SVG line graph of threshold shift vs frequency.
 * Standard audiogram convention: higher threshold shift = lower on chart
 * (worse hearing is plotted downward).
 *
 * GSAP draw-on reveal: the line animates from left to right using
 * strokeDasharray/strokeDashoffset, a documented GSAP recipe.
 */
export default function AudiogramChart({ audiogram, className }: Props) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotsRef = useRef<SVGGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const width = 320;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 36 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Y axis: 0 dB at top, 60 dB at bottom (standard audiogram)
  const maxDB = 60;
  const yScale = (db: number) => padding.top + (db / maxDB) * plotH;
  // X axis: log scale across audiometric frequencies
  const minFreq = Math.min(...AUDIO_FREQS);
  const maxFreq = Math.max(...AUDIO_FREQS);
  const xScale = (freq: number) => {
    const logMin = Math.log2(minFreq);
    const logMax = Math.log2(maxFreq);
    return padding.left + ((Math.log2(freq) - logMin) / (logMax - logMin)) * plotW;
  };

  useGSAP(
    () => {
      if (!audiogram || !pathRef.current) return;

      // Build path string
      const points = audiogram.map((p) => ({
        x: xScale(p.frequency),
        y: yScale(p.thresholdShift),
      }));

      const pathD = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");

      const path = pathRef.current;
      path.setAttribute("d", pathD);

      // GSAP draw-on reveal (documented recipe) — skipped if reduced motion
      if (reducedMotion) {
        // Just show the path and dots immediately
        gsap.set(path, { strokeDashoffset: 0 });
        if (dotsRef.current) {
          gsap.set(dotsRef.current.querySelectorAll("circle"), { scale: 1, opacity: 1 });
        }
      } else {
        const pathLength = path.getTotalLength();
        gsap.set(path, { strokeDasharray: pathLength, strokeDashoffset: pathLength });
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.2,
          ease: "power2.inOut",
        });

        // Animate dots in after the line
        if (dotsRef.current) {
          const dots = dotsRef.current.querySelectorAll("circle");
          // Reset dots to visible first, then animate from hidden
          gsap.set(dots, { scale: 1, opacity: 1 });
          gsap.from(dots, {
            scale: 0,
            opacity: 0,
            duration: 0.3,
            stagger: 0.1,
            ease: "back.out(2)",
            delay: 0.8,
          });
        }
      }
    },
    { scope: containerRef, dependencies: [audiogram, reducedMotion] },
  );

  const freqLabels = [250, 1000, 4000, 8000];
  const dbLabels = [0, 20, 40, 60];

  return (
    <div ref={containerRef} className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Projected hearing loss audiogram"
      >
        {/* Grid lines */}
        {dbLabels.map((db) => (
          <line
            key={`h-${db}`}
            x1={padding.left}
            y1={yScale(db)}
            x2={width - padding.right}
            y2={yScale(db)}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        ))}
        {AUDIO_FREQS.map((freq) => (
          <line
            key={`v-${freq}`}
            x1={xScale(freq)}
            y1={padding.top}
            x2={xScale(freq)}
            y2={height - padding.bottom}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
          />
        ))}

        {/* Y axis labels (dB) */}
        {dbLabels.map((db) => (
          <text
            key={`yl-${db}`}
            x={padding.left - 8}
            y={yScale(db) + 4}
            textAnchor="end"
            className="fill-zinc-600 text-[10px]"
          >
            {db}
          </text>
        ))}
        <text
          x={8}
          y={height / 2}
          textAnchor="middle"
          className="fill-zinc-600 text-[9px]"
          transform={`rotate(-90 8 ${height / 2})`}
        >
          dB loss
        </text>

        {/* X axis labels (Hz) */}
        {freqLabels.map((freq) => (
          <text
            key={`xl-${freq}`}
            x={xScale(freq)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            className="fill-zinc-600 text-[10px]"
          >
            {freq >= 1000 ? `${freq / 1000}k` : freq}
          </text>
        ))}

        {/* Zero line (normal hearing) */}
        <line
          x1={padding.left}
          y1={yScale(0)}
          x2={width - padding.right}
          y2={yScale(0)}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* Audiogram line */}
        <path
          ref={pathRef}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        <g ref={dotsRef}>
          {audiogram?.map((p, i) => (
            <circle
              key={i}
              cx={xScale(p.frequency)}
              cy={yScale(p.thresholdShift)}
              r="3"
              fill="white"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
