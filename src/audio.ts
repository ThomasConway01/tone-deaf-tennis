// Everything that touches Web Audio: the microphone, the robot hummer used in
// demo mode, and the little synthesised sound effects.

import { detectPitch, midiToHz, type PitchResult } from './pitch';

export class Ear {
  ctx: AudioContext;
  analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private stream: MediaStream | null = null;
  private robot: { osc: OscillatorNode; gain: GainNode } | null = null;
  /** Ignore the mic until this time, so our own sound effects don't steer the paddle. */
  deafUntil = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  async listenToMic(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    src.connect(this.analyser);
  }

  /**
   * Demo mode: a synthetic hum goes through the exact same detector as your voice.
   * It is also routed quietly to the speakers, because a robot humming is funny.
   */
  listenToRobot(startHz = 220): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = startHz;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.35;
    const toSpeakers = this.ctx.createGain();
    toSpeakers.gain.value = 0.05;
    osc.connect(filter).connect(gain);
    gain.connect(this.analyser);
    gain.connect(toSpeakers).connect(this.ctx.destination);
    osc.start();
    this.robot = { osc, gain };
  }

  robotHum(hz: number | null, loud = false) {
    if (!this.robot) return;
    const t = this.ctx.currentTime;
    if (hz === null) {
      this.robot.gain.gain.setTargetAtTime(0, t, 0.02);
    } else {
      this.robot.osc.frequency.setTargetAtTime(hz, t, 0.03);
      this.robot.gain.gain.setTargetAtTime(loud ? 0.9 : 0.35, t, 0.02);
    }
  }

  get isRobot() {
    return this.robot !== null;
  }

  read(): PitchResult | null {
    this.analyser.getFloatTimeDomainData(this.buf);
    return detectPitch(this.buf, this.ctx.sampleRate, { minRms: 0.012 });
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.robot?.osc.stop();
    this.stream = null;
    this.robot = null;
  }
}

export class Sfx {
  muted = false;
  constructor(private ctx: AudioContext, private ear?: Ear) {}

  private tone(hz: number, dur: number, type: OscillatorType, vol: number, when = 0) {
    if (this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    if (this.ear) this.ear.deafUntil = Math.max(this.ear.deafUntil, performance.now() + (when + dur) * 1000 + 60);
  }

  /** Your returns ring out at the note you were humming. Rallies become tunes. */
  yourHit(midi: number, smash: boolean) {
    const hz = midiToHz(Math.round(midi));
    this.tone(hz, smash ? 0.35 : 0.18, 'triangle', smash ? 0.35 : 0.22);
    if (smash) this.tone(hz * 2, 0.25, 'square', 0.06);
  }

  /** Pete only ever plays a perfectly tuned C. Of course he does. */
  peteHit(n: number) {
    const arp = [60, 64, 67, 72];
    this.tone(midiToHz(arp[n % arp.length]), 0.12, 'sine', 0.16);
  }

  wall() {
    this.tone(1800, 0.03, 'square', 0.03);
  }

  point(you: boolean) {
    const notes = you ? [72, 76, 79] : [55, 54, 53];
    notes.forEach((m, i) => this.tone(midiToHz(m), 0.14, 'triangle', 0.15, i * 0.09));
  }

  /** Play back the notes you hit, in order. */
  melody(midis: number[]) {
    midis.slice(0, 48).forEach((m, i) => this.tone(midiToHz(Math.round(m)), 0.2, 'triangle', 0.2, i * 0.22));
    return midis.slice(0, 48).length * 220;
  }
}
