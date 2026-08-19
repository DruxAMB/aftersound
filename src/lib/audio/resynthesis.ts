/**
 * Resynthesis engine — replays captured audio through a projected audiogram.
 *
 * Creates a multiband biquad filter chain that attenuates each audiometric
 * frequency by the NIPTS amount. Also widens filter Q to model the loss of
 * frequency selectivity (spectral smearing) that damaged cochlear hair cells
 * cause — so the result loses *clarity*, not merely loudness.
 *
 * The engine provides two playback paths for A/B comparison:
 *   clean:     source → destination
 *   projected: source → filter chain → destination
 */

import { AUDIO_FREQS, type Audiogram } from "./nipts";

export type PlaybackMode = "clean" | "projected";

export class ResynthesisEngine {
  private audioCtx: AudioContext;
  private bufferSource: AudioBufferSourceNode | null = null;
  private filterChain: BiquadFilterNode[] = [];
  private gainNode: GainNode;
  private audioBuffer: AudioBuffer | null = null;
  private onEndedCallback: (() => void) | null = null;

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this.gainNode = audioCtx.createGain();
    this.gainNode.connect(audioCtx.destination);
  }

  /**
   * Load captured audio data into an AudioBuffer.
   */
  loadCapturedAudio(samples: Float32Array, sampleRate: number) {
    this.audioBuffer = this.audioCtx.createBuffer(1, samples.length, sampleRate);
    // Copy into a fresh Float32Array to satisfy strict ArrayBuffer typing
    const channelData = new Float32Array(samples);
    this.audioBuffer.copyToChannel(channelData, 0);
  }

  /**
   * Build the filter chain from an audiogram.
   * Each audiometric frequency gets a peaking biquad with:
   *   - gain = -thresholdShift dB (attenuation)
   *   - Q varies: lower Q for more severe loss (spectral smearing)
   */
  setAudiogram(audiogram: Audiogram) {
    // Disconnect and remove old filters
    for (const f of this.filterChain) {
      f.disconnect();
    }
    this.filterChain = [];

    for (const point of audiogram) {
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = point.frequency;

      // Attenuate by the threshold shift (negative gain), scaled up for perceptibility
      // Real hearing loss is more severe than the NIPTS numbers suggest at the
      // perceptual level — we apply a 1.5x multiplier to make the A/B more dramatic
      const attenuation = -point.thresholdShift * 1.5;
      filter.gain.value = Math.max(-40, attenuation);

      // Q widens with severity: normal Q=1.5, degrading to Q=0.3 for severe loss
      // Lower Q = wider bandwidth = more spectral smearing
      const severity = Math.min(1, point.thresholdShift / 40);
      filter.Q.value = 1.5 - severity * 1.2;

      this.filterChain.push(filter);
    }

    // Add a highshelf filter for overall high-frequency rolloff
    // Real hearing loss affects broad high-frequency regions, not just notch frequencies
    const totalLoss = audiogram.reduce((sum, p) => sum + p.thresholdShift, 0);
    const avgLoss = totalLoss / audiogram.length;
    if (avgLoss > 5) {
      const highshelf = this.audioCtx.createBiquadFilter();
      highshelf.type = "highshelf";
      highshelf.frequency.value = 2000;
      highshelf.gain.value = Math.max(-15, -avgLoss * 0.8);
      this.filterChain.push(highshelf);
    }

    // Add a gentle lowpass to simulate loss of high-frequency detail
    // The cutoff frequency decreases with increasing average loss
    if (avgLoss > 10) {
      const lowpass = this.audioCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      // More loss = lower cutoff. 8000 Hz at mild loss, down to 3000 Hz at severe
      const cutoff = Math.max(3000, 8000 - avgLoss * 100);
      lowpass.frequency.value = cutoff;
      lowpass.Q.value = 0.7; // gentle rolloff
      this.filterChain.push(lowpass);
    }

    // Chain the filters: input → filter[0] → filter[1] → ... → gainNode
    if (this.filterChain.length > 0) {
      let prev: AudioNode = this.filterChain[0];
      for (let i = 1; i < this.filterChain.length; i++) {
        prev.connect(this.filterChain[i]);
        prev = this.filterChain[i];
      }
      this.filterChain[this.filterChain.length - 1].connect(this.gainNode);
    }
  }

  /**
   * Play the captured audio in the specified mode.
   * Returns a promise that resolves when playback ends.
   */
  play(mode: PlaybackMode): Promise<void> {
    if (!this.audioBuffer) return Promise.reject(new Error("No audio loaded"));

    this.stop();

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.audioBuffer;
    this.bufferSource = source;

    source.onended = () => {
      this.bufferSource = null;
      this.onEndedCallback?.();
    };

    if (mode === "clean") {
      source.connect(this.audioCtx.destination);
    } else {
      // Connect through the filter chain
      if (this.filterChain.length > 0) {
        source.connect(this.filterChain[0]);
      } else {
        source.connect(this.gainNode);
      }
    }

    source.start();
    return new Promise<void>((resolve) => {
      this.onEndedCallback = resolve;
    });
  }

  /**
   * Get the AudioContext (for ear test tone generation).
   */
  getAudioContext(): AudioContext {
    return this.audioCtx;
  }

  /**
   * Stop current playback.
   */
  stop() {
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // already stopped
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this.stop();
    for (const f of this.filterChain) {
      f.disconnect();
    }
    this.filterChain = [];
    this.gainNode.disconnect();
    this.audioBuffer = null;
  }
}
