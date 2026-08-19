/**
 * SPL Meter AudioWorklet Processor
 *
 * Applies A-weighting (IEC 61672-1 approximation: 4 cascaded biquads —
 * 2 highpass at 20.6 Hz + 2 lowpass at 12.2 kHz) to the input signal,
 * then computes instantaneous SPL and exponentially-averaged LAeq.
 *
 * Calibration: assumes 0 dBFS = 94 dB SPL (standard calibrator level).
 * This is an uncalibrated estimate — actual SPL may vary ±10 dB or more
 * depending on microphone sensitivity.
 *
 * Time weighting: "slow" (1 second time constant).
 *
 * Messages out: { type: 'level', laeq: number, inst: number }
 *   laeq — exponentially-averaged A-weighted level (dBA)
 *   inst — instantaneous A-weighted level (dBA)
 */

const SLOW_TIME_CONSTANT = 1.0; // seconds
const CALIBRATION_OFFSET = 94; // 0 dBFS = 94 dB SPL
const REF_LEVEL = 0.00002; // 20 µPa reference sound pressure

// A-weighting filter frequencies (IEC 61672-1 simplified)
const HP_FREQ = 20.6; // Hz
const LP_FREQ = 12200; // Hz
const FILTER_Q = 0.5; // critically damped (Butterworth)

/**
 * Compute biquad coefficients for a second-order filter.
 * Returns normalized coefficients [b0, b1, b2, a1, a2] (a0 = 1).
 */
function biquadHighpass(freq, Q, sampleRate) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cosW0) / 2) / a0,
    b1: (-(1 + cosW0)) / a0,
    b2: ((1 + cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function biquadLowpass(freq, Q, sampleRate) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosW0) / 2) / a0,
    b1: (1 - cosW0) / a0,
    b2: ((1 - cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

// A single biquad filter state
class Biquad {
  constructor(coeffs) {
    this.c = coeffs;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
  process(x) {
    const { b0, b1, b2, a1, a2 } = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

class SPLMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    const sr = sampleRate; // global in AudioWorkletGlobalScope
    this.filters = [
      new Biquad(biquadHighpass(HP_FREQ, FILTER_Q, sr)),
      new Biquad(biquadHighpass(HP_FREQ, FILTER_Q, sr)),
      new Biquad(biquadLowpass(LP_FREQ, FILTER_Q, sr)),
      new Biquad(biquadLowpass(LP_FREQ, FILTER_Q, sr)),
    ];

    // Exponential averaging state (in linear energy domain)
    // LAeq is computed as 10*log10(energy), so we track energy directly
    this.avgEnergy = 0; // 10^(LAeq/10)
    this.alpha = 1 - Math.exp(-128 / sr / SLOW_TIME_CONSTANT);

    this.port.onmessage = (e) => {
      if (e.data?.type === "reset") {
        this.avgEnergy = 0;
        this.filters.forEach((f) => f.reset());
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Use first channel (mono measurement)
    const channel = input[0];
    if (!channel) return true;

    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      let sample = channel[i];

      // Apply A-weighting filter chain
      for (let f = 0; f < this.filters.length; f++) {
        sample = this.filters[f].process(sample);
      }

      sumSquares += sample * sample;
    }

    // Instantaneous SPL for this block
    const rms = Math.sqrt(sumSquares / channel.length);
    const instDBFS = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const instSPL = instDBFS + CALIBRATION_OFFSET;

    // Exponential averaging in linear energy domain
    // energy = 10^(SPL/10), so avgEnergy = alpha * instEnergy + (1-alpha) * avgEnergy
    const instEnergy = rms > 0 ? Math.pow(10, instSPL / 10) : 0;
    this.avgEnergy = this.alpha * instEnergy + (1 - this.alpha) * this.avgEnergy;

    const laeq = this.avgEnergy > 0 ? 10 * Math.log10(this.avgEnergy) : -Infinity;

    this.port.postMessage({
      type: "level",
      laeq: laeq,
      inst: instSPL,
    });

    return true;
  }
}

registerProcessor("spl-meter", SPLMeterProcessor);
