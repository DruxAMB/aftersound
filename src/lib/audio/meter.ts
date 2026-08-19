/**
 * SoundLevelMeter — manages the Web Audio graph for A-weighted SPL measurement.
 *
 * Signal chain:
 *   source → A-weighting biquads → analyser (for spectrum viz) → spl-meter worklet
 *
 * The AudioWorklet applies A-weighting and computes LAeq internally.
 * The biquad chain before the analyser ensures the spectrum visualization
 * also shows A-weighted signal, consistent with the SPL reading.
 *
 * The worklet posts { type: 'level', laeq, inst } messages on each audio block.
 */

export type LevelData = {
  laeq: number; // exponentially-averaged A-weighted level (dBA)
  inst: number; // instantaneous A-weighted level (dBA)
};

export type MeterCallbacks = {
  onLevel?: (data: LevelData) => void;
  onError?: (error: Error) => void;
  onCaptured?: (buffer: Float32Array, sampleRate: number) => void;
};

// A-weighting biquad filter parameters
const HP_FREQ = 20.6;
const LP_FREQ = 12200;
const FILTER_Q = 0.5;

export class SoundLevelMeter {
  private audioCtx: AudioContext | null = null;
  private ownsAudioCtx = false;
  private source: AudioNode | null = null;
  private biquads: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private callbacks: MeterCallbacks;
  private running = false;

  constructor(callbacks: MeterCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Start the meter from a MediaStream (microphone or scene generator).
   * If externalCtx is provided, uses it instead of creating a new one.
   */
  async startFromStream(stream: MediaStream, externalCtx?: AudioContext): Promise<void> {
    this.cleanup();
    this.stream = stream;

    const audioCtx = externalCtx ?? new AudioContext();
    this.audioCtx = audioCtx;
    this.ownsAudioCtx = !externalCtx;

    // Load the SPL meter and capture AudioWorklets
    await audioCtx.audioWorklet.addModule("/worklets/spl-meter-processor.js");
    await audioCtx.audioWorklet.addModule("/worklets/capture-processor.js");

    // Create source from stream
    this.source = audioCtx.createMediaStreamSource(stream);

    // Create A-weighting biquad chain (4 filters: 2 HP + 2 LP)
    this.biquads = [
      this.makeBiquad("highpass", HP_FREQ),
      this.makeBiquad("highpass", HP_FREQ),
      this.makeBiquad("lowpass", LP_FREQ),
      this.makeBiquad("lowpass", LP_FREQ),
    ];

    // Create analyser for spectrum visualization
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // Create SPL meter worklet
    this.workletNode = new AudioWorkletNode(audioCtx, "spl-meter");
    this.workletNode.port.onmessage = (e) => {
      if (e.data?.type === "level" && this.callbacks.onLevel) {
        this.callbacks.onLevel({
          laeq: e.data.laeq,
          inst: e.data.inst,
        });
      }
    };

    // Create capture worklet (taps raw source, before A-weighting)
    this.captureNode = new AudioWorkletNode(audioCtx, "capture");
    this.captureNode.port.onmessage = (e) => {
      if (e.data?.type === "captured" && this.callbacks.onCaptured) {
        this.callbacks.onCaptured(e.data.buffer, e.data.sampleRate);
      }
    };

    // Connect: source → biquads → analyser → worklet (for SPL)
    // Also: source → capture worklet (for raw audio capture)
    let node: AudioNode = this.source;
    for (const bq of this.biquads) {
      node.connect(bq);
      node = bq;
    }
    node.connect(this.analyser);
    this.analyser.connect(this.workletNode);
    this.source.connect(this.captureNode);

    // Resume context (in case it's suspended)
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    this.running = true;
  }

  /**
   * Start the meter from a bundled audio source (sample scene).
   * The audio element should be playing before calling this.
   */
  async startFromAudioElement(audioEl: HTMLAudioElement): Promise<void> {
    this.cleanup();

    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;

    await audioCtx.audioWorklet.addModule("/worklets/spl-meter-processor.js");

    this.source = audioCtx.createMediaElementSource(audioEl);

    this.biquads = [
      this.makeBiquad("highpass", HP_FREQ),
      this.makeBiquad("highpass", HP_FREQ),
      this.makeBiquad("lowpass", LP_FREQ),
      this.makeBiquad("lowpass", LP_FREQ),
    ];

    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.workletNode = new AudioWorkletNode(audioCtx, "spl-meter");
    this.workletNode.port.onmessage = (e) => {
      if (e.data?.type === "level" && this.callbacks.onLevel) {
        this.callbacks.onLevel({
          laeq: e.data.laeq,
          inst: e.data.inst,
        });
      }
    };

    // Connect: source → biquads → analyser → worklet
    // Also connect to destination so the user hears the scene
    let node: AudioNode = this.source;
    for (const bq of this.biquads) {
      node.connect(bq);
      node = bq;
    }
    node.connect(this.analyser);
    this.analyser.connect(this.workletNode);
    // Also connect to speakers for audible playback
    this.analyser.connect(audioCtx.destination);

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    this.running = true;
  }

  /**
   * Get the AnalyserNode for spectrum visualization.
   */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Reset the LAeq averaging (e.g., when switching scenes).
   */
  reset() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "reset" });
    }
  }

  /**
   * Start capturing raw audio for the given duration (seconds).
   * The onCaptured callback fires when the buffer is complete.
   */
  startCapture(duration: number) {
    if (this.captureNode) {
      this.captureNode.port.postMessage({ type: "start", duration });
    }
  }

  /**
   * Get the AudioContext (for creating AudioBuffers from captured data).
   */
  getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  /**
   * Stop and clean up all audio resources.
   */
  stop() {
    this.cleanup();
  }

  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.captureNode) {
      this.captureNode.port.onmessage = null;
      this.captureNode.disconnect();
      this.captureNode = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    for (const bq of this.biquads) {
      bq.disconnect();
    }
    this.biquads = [];
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioCtx && this.ownsAudioCtx) {
      this.audioCtx.close();
    }
    this.audioCtx = null;
    this.ownsAudioCtx = false;
    this.running = false;
  }

  private makeBiquad(type: BiquadFilterType, freq: number): BiquadFilterNode {
    const bq = this.audioCtx!.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = freq;
    bq.Q.value = FILTER_Q;
    return bq;
  }
}
