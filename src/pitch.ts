// Pitch detection for Tone Deaf Tennis.
// A small YIN implementation (de Cheveigné & Kawahara, 2002), written for this project.
// Pure functions only, so it can be unit-tested in Node with synthetic signals.

export interface PitchResult {
  /** Fundamental frequency in Hz. */
  hz: number;
  /** 0..1, how sure we are (1 - YIN aperiodicity). */
  clarity: number;
  /** Root-mean-square loudness of the frame. */
  rms: number;
}

export interface DetectOptions {
  minHz?: number;
  maxHz?: number;
  /** YIN absolute threshold. Lower = pickier. */
  threshold?: number;
  /** Frames quieter than this are treated as silence. */
  minRms?: number;
}

export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Detect the fundamental frequency of a mono frame.
 * Returns null for silence or anything too noisy to call a note.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  opts: DetectOptions = {},
): PitchResult | null {
  const minHz = opts.minHz ?? 70;
  const maxHz = opts.maxHz ?? 1100;
  const threshold = opts.threshold ?? 0.15;
  const minRms = opts.minRms ?? 0.01;

  const level = rms(buf);
  if (level < minRms) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(Math.floor(buf.length / 2), Math.ceil(sampleRate / minHz));
  if (maxTau <= minTau + 2) return null;

  const window = buf.length - maxTau;
  const d = new Float32Array(maxTau + 1);

  // Step 1-2: difference function.
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // Step 3: cumulative mean normalised difference.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  // Step 4: first dip under the threshold, then walk to its local minimum.
  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= maxTau && d[tau + 1] < d[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null;

  // Step 5: parabolic interpolation for sub-sample accuracy.
  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < maxTau) {
    const s0 = d[tauEstimate - 1];
    const s1 = d[tauEstimate];
    const s2 = d[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEstimate + (s2 - s0) / denom;
  }

  const hz = sampleRate / betterTau;
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - d[tauEstimate])), rms: level };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Hz to fractional MIDI note number (A4 = 440 Hz = 69). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** "A4", "C#3" and so on, plus how many cents off you are. */
export function noteName(hz: number): { name: string; cents: number } {
  const midi = hzToMidi(hz);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  const octave = Math.floor(nearest / 12) - 1;
  return { name: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${octave}`, cents };
}

/**
 * Map a pitch onto the court. Your calibrated low note is the bottom of
 * the court, your high note is the top. Returns 0 (top) .. 1 (bottom).
 */
export function pitchToCourt(hz: number, lowHz: number, highHz: number): number {
  const lo = hzToMidi(lowHz);
  const hi = hzToMidi(highHz);
  const span = Math.max(1, hi - lo);
  const t = (hzToMidi(hz) - lo) / span;
  return Math.min(1, Math.max(0, 1 - t));
}

/**
 * Median of the last few readings. Voices wobble and YIN occasionally jumps an
 * octave; a short median kills single-frame spikes without adding much lag.
 */
export class PitchSmoother {
  private history: number[] = [];
  constructor(private size = 5) {}
  push(midi: number): number {
    this.history.push(midi);
    if (this.history.length > this.size) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  reset() {
    this.history = [];
  }
}
