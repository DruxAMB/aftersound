/**
 * Tone generator for the ear test.
 *
 * Generates calibrated pure tones at audiometric frequencies with
 * specified levels (in dB HL). Uses the Web Audio API with a
 * calibration offset to convert dB HL to dB SPL at the headphone.
 *
 * Calibration: assumes standard audiometric headphones. The conversion
 * from dB HL to dB SPL follows RETSPL (Reference Equivalent Threshold
 * Sound Pressure Level) values from ISO 389-7 (supra-aural headphones).
 * These are approximate and will vary with actual headphone type.
 *
 * DISCLAIMER: This is NOT a clinical audiometer. Results are approximate
 * and depend on headphone calibration, background noise, and response
 * honesty. For actual hearing assessment, see an audiologist.
 */

// RETSPL values for TDH-39 headphones (ISO 389-7), dB SPL for 0 dB HL
const RETSPL: Record<number, number> = {
  250: 45.0,
  500: 13.5,
  1000: 7.5,
  2000: 9.0,
  3000: 11.5,
  4000: 12.0,
  6000: 16.0,
  8000: 15.5,
};

// Calibration offset: 0 dBFS = 100 dB SPL (approximate for typical headphones)
const DBFS_TO_SPL = 100;

/**
 * Convert dB HL to linear amplitude for Web Audio.
 * dB SPL = dB HL + RETSPL(freq)
 * amplitude = 10^((dB SPL - DBFS_TO_SPL) / 20)
 */
export function hlToAmplitude(dbHL: number, freq: number): number {
  const retspl = RETSPL[freq] ?? 10;
  const dbSPL = dbHL + retspl;
  const dbFS = dbSPL - DBFS_TO_SPL;
  if (dbFS <= -80) return 0; // silence
  return Math.pow(10, dbFS / 20);
}

/**
 * Play a tone at a given frequency and level for a specified duration.
 * Returns a promise that resolves when the tone ends.
 *
 * The tone has 20ms rise/fall ramps to avoid clicks.
 */
export function playTone(
  audioCtx: AudioContext,
  freq: number,
  dbHL: number,
  duration: number,
): Promise<void> {
  return new Promise((resolve) => {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.frequency.value = freq;
    osc.type = "sine";

    const amplitude = hlToAmplitude(dbHL, freq);
    const rampTime = 0.02; // 20ms ramps

    // Envelope: rise → hold → fall
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(amplitude, now + rampTime);
    gain.gain.setValueAtTime(amplitude, now + duration - rampTime);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + duration);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      resolve();
    };
  });
}

/**
 * Play a tone and return the oscillator/gain nodes so it can be stopped early.
 * Used for the "was that a tone?" response paradigm where the user responds
 * while the tone is still playing.
 */
export function startTone(
  audioCtx: AudioContext,
  freq: number,
  dbHL: number,
  duration: number,
): { stop: () => void; promise: Promise<void> } {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.frequency.value = freq;
  osc.type = "sine";

  const amplitude = hlToAmplitude(dbHL, freq);
  const rampTime = 0.02;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(amplitude, now + rampTime);
  gain.gain.setValueAtTime(amplitude, now + duration - rampTime);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);

  const promise = new Promise<void>((resolve) => {
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      resolve();
    };
  });

  const stop = () => {
    try {
      // Quick fade out
      gain.gain.cancelScheduledValues(audioCtx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01);
      osc.stop(audioCtx.currentTime + 0.02);
    } catch {
      // already stopped
    }
  };

  return { stop, promise };
}
