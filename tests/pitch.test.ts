import { describe, expect, it } from 'vitest';
import { detectPitch, hzToMidi, midiToHz, noteName, pitchToCourt, PitchSmoother } from '../src/pitch';
import { seededRng } from '../src/game';

const SR = 48000;
const N = 2048;

function synth(hz: number, opts: { harmonics?: number; noise?: number; amp?: number; seed?: number } = {}) {
  const rng = seededRng(opts.seed ?? 1);
  const buf = new Float32Array(N);
  const harmonics = opts.harmonics ?? 1;
  const amp = opts.amp ?? 0.3;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
    buf[i] = amp * v + (opts.noise ?? 0) * (rng() * 2 - 1);
  }
  return buf;
}

const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

describe('detectPitch', () => {
  // A range covering low male hums to high female/child hums.
  const notes = [82.41, 98, 110, 130.81, 164.81, 196, 220, 261.63, 329.63, 392, 440, 523.25, 659.25, 880];

  it.each(notes)('finds a pure %f Hz tone within 5 cents', (hz) => {
    const r = detectPitch(synth(hz), SR);
    expect(r).not.toBeNull();
    expect(cents(r!.hz, hz)).toBeLessThan(5);
  });

  it.each(notes)('finds a buzzy, hum-like %f Hz tone (6 harmonics) within 10 cents', (hz) => {
    const r = detectPitch(synth(hz, { harmonics: 6 }), SR);
    expect(r).not.toBeNull();
    expect(cents(r!.hz, hz)).toBeLessThan(10);
  });

  it('copes with background noise at roughly 10 dB SNR', () => {
    let ok = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = detectPitch(synth(196, { harmonics: 4, noise: 0.09, seed }), SR, { threshold: 0.25 });
      if (r && cents(r.hz, 196) < 25) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(45); // at least 90% of noisy frames
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(N), SR)).toBeNull();
  });

  it('returns null for white noise', () => {
    const rng = seededRng(7);
    const buf = new Float32Array(N).map(() => (rng() * 2 - 1) * 0.3);
    expect(detectPitch(buf, SR)).toBeNull();
  });

  it('works at 44.1 kHz as well as 48 kHz', () => {
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 44100);
    const r = detectPitch(buf, 44100);
    expect(cents(r!.hz, 220)).toBeLessThan(5);
  });
});

describe('note maths', () => {
  it('names notes', () => {
    expect(noteName(440).name).toBe('A4');
    expect(noteName(261.63).name).toBe('C4');
    expect(noteName(130.81).name).toBe('C3');
    expect(noteName(466.16).name).toBe('A#4');
  });

  it('round-trips Hz and MIDI', () => {
    for (const m of [40, 57, 69, 81]) expect(hzToMidi(midiToHz(m))).toBeCloseTo(m, 6);
  });

  it('maps your low note to the bottom and high note to the top', () => {
    expect(pitchToCourt(130.81, 130.81, 392)).toBeCloseTo(1);
    expect(pitchToCourt(392, 130.81, 392)).toBeCloseTo(0);
    // Halfway in semitones, not in Hz: that is how ears work.
    expect(pitchToCourt(midiToHz((48 + 67) / 2), midiToHz(48), midiToHz(67))).toBeCloseTo(0.5);
    // Out of range clamps rather than flying off the court.
    expect(pitchToCourt(1000, 130.81, 392)).toBe(0);
    expect(pitchToCourt(50, 130.81, 392)).toBe(1);
  });
});

describe('PitchSmoother', () => {
  it('ignores a single octave jump', () => {
    const s = new PitchSmoother(5);
    [57, 57, 57, 69, 57].forEach((m) => s.push(m));
    expect(s.push(57)).toBe(57);
  });
});
