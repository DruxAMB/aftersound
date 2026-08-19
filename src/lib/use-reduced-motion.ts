"use client";

import { useEffect, useState } from "react";

/**
 * Detects the user's `prefers-reduced-motion` setting.
 * Returns true if the user has requested reduced motion.
 *
 * GSAP animations and CSS transitions should be disabled/skipped
 * when this returns true (DESIGN.md §5, AGENTS.local.md requirement).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return reduced;
}
