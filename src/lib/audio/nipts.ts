/**
 * NIPTS — Noise-Induced Permanent Threshold Shift projection model.
 *
 * DISCLAIMER: This is an illustrative approximation, NOT a clinical model.
 * The authoritative model is ISO 1999:2013 (paywalled). NIOSH DHHS 98-126
 * (public domain) references ISO 1999 but does not publish a closed-form
 * formula. The formula below is our own construction, tuned to produce
 * values broadly consistent with published NIPTS data (e.g. ~10-15 dB
 * at 4 kHz for 40 years of 85 dBA exposure, 50th percentile). It is
 * suitable for a demo/educational tool, not for risk assessment.
 *
 * Model:
 *   NIPTS(f, t, L) = a(f) * ln(1 + t) * max(0, L - 75) / 10
 *
 * Where:
 *   f = audiometric frequency (Hz)
 *   t = age in years (proxy for years of exposure)
 *   L = daily A-weighted noise exposure level (dBA)
 *   a(f) = frequency-dependent susceptibility coefficient (tuned by us)
 *
 * Key characteristics captured:
 * - 4 kHz notch (maximum damage at 3-6 kHz)
 * - Logarithmic growth with age
 * - Linear scaling with exposure level above 75 dBA threshold
 * - Zero NIPTS below 75 dBA
 *
 * Limitations:
 * - Formula structure is our invention, not from any published standard
 * - Uses age as proxy for years of exposure (assumes exposure from birth)
 * - Does not separate presbycusis (age-related) from NIPTS
 * - Coefficients are approximate, not from ISO 1999 tables
 * - Does not account for individual susceptibility variability
 * - NOT FOR CLINICAL OR RISK ASSESSMENT USE
 */

// Audiometric frequencies (Hz)
export const AUDIO_FREQS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];

// Frequency-dependent susceptibility coefficients
// Calibrated so that NIPTS(4kHz, 40yr, 85dBA) ≈ 12 dB (50th percentile)
const SUSCEPTIBILITY: Record<number, number> = {
  250: 0.3,
  500: 0.5,
  1000: 1.0,
  2000: 2.5,
  3000: 4.0,
  4000: 5.0, // peak — the "4 kHz notch"
  6000: 3.5,
  8000: 2.5,
};

const EXPOSURE_THRESHOLD = 75; // dBA, below which NIPTS = 0
const REF_EXPOSURE = 85; // dBA, reference level for coefficients

export type Audiogram = {
  frequency: number;
  thresholdShift: number; // dB
}[];

/**
 * Compute NIPTS at a single frequency.
 */
export function niptsAtFreq(freq: number, age: number, dailyExposure: number): number {
  if (dailyExposure <= EXPOSURE_THRESHOLD) return 0;
  const a = SUSCEPTIBILITY[freq] ?? 0;
  const yearsFactor = Math.log(1 + age);
  const levelFactor = (dailyExposure - EXPOSURE_THRESHOLD) / (REF_EXPOSURE - EXPOSURE_THRESHOLD);
  return a * yearsFactor * levelFactor;
}

/**
 * Compute a full audiogram (threshold shift at each audiometric frequency).
 * Returns array of { frequency, thresholdShift } sorted by frequency.
 */
export function computeAudiogram(age: number, dailyExposure: number): Audiogram {
  return AUDIO_FREQS.map((freq) => ({
    frequency: freq,
    thresholdShift: niptsAtFreq(freq, age, dailyExposure),
  }));
}

/**
 * Compute a population-average audiogram for a given age
 * (presbycusis only, no noise exposure).
 * Uses ISO 7029 simplified model for the 50th percentile.
 */
export function presbycusisAudiogram(age: number): Audiogram {
  return AUDIO_FREQS.map((freq) => {
    // Simplified presbycusis: increases with age, worse at high frequencies
    const ageFactor = Math.max(0, (age - 25) / 40); // 0 at age 25, 1 at age 65
    const freqFactor = Math.log2(freq / 1000); // 0 at 1 kHz, increases with freq
    const shift = Math.max(0, ageFactor * freqFactor * 8);
    return { frequency: freq, thresholdShift: shift };
  });
}

/**
 * Default projection parameters (pre-filled, skippable in the UI).
 */
export const DEFAULT_AGE = 45;
export const DEFAULT_DAILY_EXPOSURE = 85; // dBA
