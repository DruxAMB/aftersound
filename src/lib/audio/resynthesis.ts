/**
 * Resynthesis engine — replays captured audio through a projected audiogram.
 *
 * Creates a multiband biquad filter chain that attenuates each audiometric
 * frequency by the NIPTS amount. Also widens filter Q to model the loss of
 * frequency selectivity (spectral smearing) that damaged cochlear hair cells
 * cause — so the result loses *clarity*, not merely loudness.
 *
 * When hearing loss is significant, also mixes in:
 *   - A faint 4kHz pure tone (tinnitus ringing)
 *   - Low-level broadband noise (reduced dynamic range)
 * This makes the "after" playback genuinely uncomfortable — which is the
 * emotional point: you don't just hear less, you hear a constant ringing.
 *
 * The engine provides two playback paths for A/B comparison:
 *   clean:     source → destination
 *   projected: source → filter chain → destination (+ tinnitus mix)
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
  // Tinnitus simulation nodes
  private tinnitusOsc: OscillatorNode | null = null;
  private tinnitusGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private tinnitusMixGain: GainNode | null = null;
  private avgLoss = 0;

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

    // Clean up old tinnitus nodes
    this.destroyTinnitus();

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
    this.avgLoss = totalLoss / audiogram.length;
    if (this.avgLoss > 5) {
      const highshelf = this.audioCtx.createBiquadFilter();
      highshelf.type = "highshelf";
      highshelf.frequency.value = 2000;
      highshelf.gain.value = Math.max(-15, -this.avgLoss * 0.8);
      this.filterChain.push(highshelf);
    }

    // Add a gentle lowpass to simulate loss of high-frequency detail
    // The cutoff frequency decreases with increasing average loss
    if (this.avgLoss > 10) {
      const lowpass = this.audioCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      // More loss = lower cutoff. 8000 Hz at mild loss, down to 3000 Hz at severe
      const cutoff = Math.max(3000, 8000 - this.avgLoss * 100);
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

    // Build tinnitus simulation if loss is significant
    // Tinnitus is common with noise-induced hearing loss: ~70% of NIHL patients
    // report it. We simulate it as a faint 4kHz tone + broadband noise.
    // The intensity scales with hearing loss severity.
    if (this.avgLoss > 15) {
      this.buildTinnitus();
    }
  }

  /**
   * Build tinnitus simulation: a 4kHz oscillator + broadband noise,
   * mixed into the output at a level that's audible but not overwhelming.
   * The ringing should feel like an unwanted guest, not a scream.
   */
  private buildTinnitus() {
    // Master mix gain for tinnitus layer
    this.tinnitusMixGain = this.audioCtx.createGain();
    // Scale: barely audible at 15dB loss, clearly present at 30+ dB
    // Max gain ~0.04 (very faint — tinnitus is a whisper, not a shout)
    const tinnitusLevel = Math.min(0.04, (this.avgLoss - 15) * 0.002);
    this.tinnitusMixGain.gain.value = tinnitusLevel;
    this.tinnitusMixGain.connect(this.gainNode);

    // 4kHz pure tone — the classic tinnitus pitch
    this.tinnitusOsc = this.audioCtx.createOscillator();
    this.tinnitusOsc.type = "sine";
    this.tinnitusOsc.frequency.value = 4000;
    this.tinnitusGain = this.audioCtx.createGain();
    // The tone is the dominant tinnitus component
    this.tinnitusGain.gain.value = 0.7;
    this.tinnitusOsc.connect(this.tinnitusGain);
    this.tinnitusGain.connect(this.tinnitusMixGain);

    // Broadband noise — simulates the "reduced dynamic range" aspect
    // Damaged ears have a narrower gap between "can't hear" and "painfully loud"
    // We model this as a low-level noise floor that raises the silence threshold
    const noiseBuffer = this.createNoiseBuffer(this.audioBuffer?.duration ?? 5);
    this.noiseSource = this.audioCtx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseGain = this.audioCtx.createGain();
    // Noise is quieter than the tone — it's the bed, not the feature
    this.noiseGain.gain.value = 0.3;
    this.noiseSource.connect(this.noiseGain);
    this.noiseGain.connect(this.tinnitusMixGain);
  }

  /**
   * Create a buffer of white noise for the tinnitus noise floor.
   */
  private createNoiseBuffer(duration: number): AudioBuffer {
    const sampleRate = this.audioCtx.sampleRate;
    const length = Math.max(sampleRate, Math.ceil(duration * sampleRate));
    const buffer = this.audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Destroy tinnitus simulation nodes.
   */
  private destroyTinnitus() {
    if (this.tinnitusOsc) {
      try { this.tinnitusOsc.stop(); } catch { /* not started */ }
      this.tinnitusOsc.disconnect();
      this.tinnitusOsc = null;
    }
    if (this.tinnitusGain) {
      this.tinnitusGain.disconnect();
      this.tinnitusGain = null;
    }
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch { /* not started */ }
      this.noiseSource.disconnect();
      this.noiseSource = null;
    }
    if (this.noiseGain) {
      this.noiseGain.disconnect();
      this.noiseGain = null;
    }
    if (this.tinnitusMixGain) {
      this.tinnitusMixGain.disconnect();
      this.tinnitusMixGain = null;
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
      // Stop tinnitus when playback ends
      if (this.tinnitusOsc) {
        try { this.tinnitusOsc.stop(); } catch { /* already stopped */ }
      }
      if (this.noiseSource) {
        try { this.noiseSource.stop(); } catch { /* already stopped */ }
      }
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

      // Start tinnitus simulation alongside the projected playback
      if (this.tinnitusOsc && this.avgLoss > 15) {
        try {
          this.tinnitusOsc.start();
        } catch {
          // already started — recreate if needed
        }
      }
      if (this.noiseSource && this.avgLoss > 15) {
        try {
          this.noiseSource.start();
        } catch {
          // already started
        }
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
    // Stop tinnitus oscillators
    if (this.tinnitusOsc) {
      try { this.tinnitusOsc.stop(); } catch { /* already stopped */ }
    }
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch { /* already stopped */ }
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
    this.destroyTinnitus();
    this.gainNode.disconnect();
    this.audioBuffer = null;
  }
}
