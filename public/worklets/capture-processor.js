/**
 * Capture AudioWorklet Processor
 *
 * Records raw PCM audio from the input into a buffer.
 * When the target duration is reached, posts the complete buffer
 * to the main thread as a transferable Float32Array.
 *
 * Messages in:  { type: 'start', duration: number }  (duration in seconds)
 * Messages out: { type: 'captured', buffer: Float32Array, sampleRate: number }
 */

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.samplesCaptured = 0;
    this.targetSamples = 0;
    this.capturing = false;

    this.port.onmessage = (e) => {
      if (e.data?.type === "start") {
        this.chunks = [];
        this.samplesCaptured = 0;
        this.targetSamples = Math.round(e.data.duration * sampleRate);
        this.capturing = true;
      } else if (e.data?.type === "cancel") {
        this.capturing = false;
        this.chunks = [];
        this.samplesCaptured = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    if (this.capturing) {
      const channel = input[0];
      if (channel) {
        // Copy the channel data (it's reused by the browser)
        this.chunks.push(new Float32Array(channel));
        this.samplesCaptured += channel.length;

        if (this.samplesCaptured >= this.targetSamples) {
          // Concatenate all chunks into a single buffer
          const result = new Float32Array(this.samplesCaptured);
          let offset = 0;
          for (const chunk of this.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          this.port.postMessage(
            { type: "captured", buffer: result, sampleRate: sampleRate },
            [result.buffer],
          );
          this.capturing = false;
          this.chunks = [];
          this.samplesCaptured = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
