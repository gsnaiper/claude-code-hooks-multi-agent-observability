// Audio normalizer using Web Audio API
// Normalizes volume across different audio sources for consistent playback

// Target peak amplitude (0.8 = -2dB headroom to prevent clipping)
const TARGET_PEAK = 0.8;

// Singleton AudioContext
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

// Find peak amplitude in audio buffer
function findPeak(audioBuffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

// Play audio blob with normalization
export async function playNormalized(
  blob: Blob,
  volume: number = 1.0
): Promise<void> {
  const ctx = getAudioContext();

  // Stop any currently playing audio
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Ignore if already stopped
    }
    currentSource = null;
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  // Find peak and calculate normalization gain
  const peak = findPeak(audioBuffer);
  const normalizeGain = peak > 0 ? TARGET_PEAK / peak : 1;

  // Create audio nodes
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();

  source.buffer = audioBuffer;
  // Apply both normalization and user volume
  gainNode.gain.value = normalizeGain * volume;

  // Connect: source -> gain -> destination
  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  currentSource = source;

  return new Promise((resolve) => {
    source.onended = () => {
      currentSource = null;
      resolve();
    };
    source.start(0);
  });
}

// Play audio from URL with normalization
export async function playNormalizedUrl(
  url: string,
  volume: number = 1.0
): Promise<void> {
  const ctx = getAudioContext();

  // Stop any currently playing audio
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Ignore if already stopped
    }
    currentSource = null;
  }

  // Fetch audio file
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  // Find peak and calculate normalization gain
  const peak = findPeak(audioBuffer);
  const normalizeGain = peak > 0 ? TARGET_PEAK / peak : 1;

  // Create audio nodes
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();

  source.buffer = audioBuffer;
  gainNode.gain.value = normalizeGain * volume;

  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  currentSource = source;

  return new Promise((resolve) => {
    source.onended = () => {
      currentSource = null;
      resolve();
    };
    source.start(0);
  });
}

// Stop current playback
export function stopPlayback(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Ignore if already stopped
    }
    currentSource = null;
  }
}

// Check if currently playing
export function isPlaying(): boolean {
  return currentSource !== null;
}

// Composable wrapper for Vue
export function useAudioNormalizer() {
  return {
    playNormalized,
    playNormalizedUrl,
    stopPlayback,
    isPlaying
  };
}
