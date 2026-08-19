/**
 * Procedural ambient scene generator.
 *
 * Generates synthetic ambient audio for three bundled scenes (subway, café, gym)
 * using the Web Audio API. No copyrighted audio files needed — each scene is
 * a combination of filtered noise and oscillators with amplitude modulation.
 *
 * The generated audio approximates the frequency content and dynamics of each
 * environment well enough for a demo. It is NOT a realistic recording.
 */

export type SceneId = "subway" | "cafe" | "gym";

type SceneConfig = {
  noiseGain: number;
  filterType: BiquadFilterType;
  filterFreq: number;
  filterQ: number;
  lfoFreq: number; // amplitude modulation rate (Hz)
  lfoDepth: number; // modulation depth (0-1)
  oscillatorFreq?: number; // optional tonal component
  oscillatorGain?: number;
};

const SCENE_CONFIGS: Record<SceneId, SceneConfig> = {
  subway: {
    noiseGain: 0.35,
    filterType: "lowpass",
    filterFreq: 400,
    filterQ: 1.0,
    lfoFreq: 0.3,
    lfoDepth: 0.4,
    oscillatorFreq: 60,
    oscillatorGain: 0.08,
  },
  cafe: {
    noiseGain: 0.15,
    filterType: "bandpass",
    filterFreq: 1200,
    filterQ: 0.7,
    lfoFreq: 1.5,
    lfoDepth: 0.5,
  },
  gym: {
    noiseGain: 0.2,
    filterType: "lowpass",
    filterFreq: 250,
    filterQ: 2.0,
    lfoFreq: 0.8,
    lfoDepth: 0.6,
    oscillatorFreq: 50,
    oscillatorGain: 0.06,
  },
};

/**
 * Creates and starts a procedural ambient scene.
 * Returns a MediaStream that can be fed to SoundLevelMeter.startFromStream(),
 * plus a stop() function for cleanup.
 */
export function createScene(
  sceneId: SceneId,
  audioCtx: AudioContext,
): { stream: MediaStream; stop: () => void } {
  const config = SCENE_CONFIGS[sceneId];
  const dest = audioCtx.createMediaStreamDestination();

  // Noise source (white noise via ScriptProcessor alternative: buffer source)
  const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;

  // Filter the noise
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = config.filterType;
  noiseFilter.frequency.value = config.filterFreq;
  noiseFilter.Q.value = config.filterQ;

  // Amplitude modulation via LFO
  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = config.lfoFreq;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = config.lfoDepth;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = config.noiseGain * (1 - config.lfoDepth);

  // LFO modulates the noise gain
  lfo.connect(lfoGain);
  lfoGain.connect(noiseGain.gain);

  // Connect noise chain
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(dest);

  // Optional tonal component (low rumble)
  let osc: OscillatorNode | null = null;
  let oscGain: GainNode | null = null;
  if (config.oscillatorFreq && config.oscillatorGain) {
    osc = audioCtx.createOscillator();
    osc.frequency.value = config.oscillatorFreq;
    osc.type = "sine";
    oscGain = audioCtx.createGain();
    oscGain.gain.value = config.oscillatorGain;
    osc.connect(oscGain);
    oscGain.connect(dest);
  }

  // Start everything
  noiseSource.start();
  lfo.start();
  osc?.start();

  // Also connect to destination for audible playback
  const audibleGain = audioCtx.createGain();
  audibleGain.gain.value = 0.5;
  noiseGain.connect(audibleGain);
  audibleGain.connect(audioCtx.destination);

  const stop = () => {
    try {
      noiseSource.stop();
      lfo.stop();
      osc?.stop();
    } catch {
      // already stopped
    }
    noiseSource.disconnect();
    noiseFilter.disconnect();
    noiseGain.disconnect();
    lfo.disconnect();
    lfoGain.disconnect();
    oscGain?.disconnect();
    audibleGain.disconnect();
    dest.disconnect();
  };

  return { stream: dest.stream, stop };
}
