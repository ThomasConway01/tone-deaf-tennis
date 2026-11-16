// The end-of-match certificate: a shareable PNG drawn on a canvas.
import { midiToHz, noteName } from './pitch';
import { verdict } from './quips';

export interface Stats {
  humSeconds: number;
  minMidi: number;
  maxMidi: number;
  notes: number[];
  smashes: number;
  longestRally: number;
  you: number;
  pete: number;
  mode: 'voice' | 'robot' | 'coward';
}

export function summarise(stats: Stats) {
  const hasRange = Number.isFinite(stats.minMidi) && Number.isFinite(stats.maxMidi);
  const semis = hasRange ? Math.max(0, Math.round(stats.maxMidi - stats.minMidi)) : 0;
  const range = hasRange ? `${noteName(midiToHz(stats.minMidi)).name} – ${noteName(midiToHz(stats.maxMidi)).name}` : 'none';
  const title =
    stats.mode === 'coward' ? 'Certified Coward' : stats.mode === 'robot' ? 'Robot (Not Eligible)' : verdict(semis);
  return { semis, range, title, octaves: (semis / 12).toFixed(1) };
}

export function drawCertificate(cv: HTMLCanvasElement, stats: Stats) {
  const c = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  const { semis, range, title, octaves } = summarise(stats);
  c.fillStyle = '#f4ecdb';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#1f1c17';
  c.lineWidth = 6;
  c.strokeRect(24, 24, W - 48, H - 48);
  c.lineWidth = 1.5;
  c.strokeRect(38, 38, W - 76, H - 76);

  c.fillStyle = '#1f1c17';
  c.textAlign = 'center';
  c.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
  c.fillText('TONE DEAF TENNIS · OFFICIAL CERTIFICATE OF HUMMING', W / 2, 92);
  c.font = '700 76px "Fraunces", Georgia, serif';
  c.fillText(title, W / 2, 178);
  c.font = '400 26px "Fraunces", Georgia, serif';
  c.fillText(`Final score: You ${stats.you} – ${stats.pete} Perfect Pitch Pete`, W / 2, 222);

  // The stave, with every note you returned the ball on.
  const top = 290;
  const gap = 18;
  c.strokeStyle = 'rgba(31,28,23,0.55)';
  c.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo(110, top + i * gap);
    c.lineTo(W - 110, top + i * gap);
    c.stroke();
  }
  const notes = stats.notes.slice(0, 40);
  if (notes.length) {
    const lo = Math.min(...notes);
    const hi = Math.max(...notes);
    const span = Math.max(1, hi - lo);
    notes.forEach((m, i) => {
      const x = 140 + (i / Math.max(1, notes.length - 1)) * (W - 280);
      const y = top + 4 * gap - ((m - lo) / span) * 4 * gap;
      c.fillStyle = '#e2532d';
      c.beginPath();
      c.ellipse(x, y, 10, 7, -0.35, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#1f1c17';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + 9, y);
      c.lineTo(x + 9, y - 42);
      c.stroke();
    });
  } else {
    c.font = 'italic 24px "Fraunces", Georgia, serif';
    c.fillStyle = 'rgba(31,28,23,0.6)';
    c.fillText('(no returns, so no tune)', W / 2, top + 2 * gap + 8);
  }

  const cells = [
    ['Hummed for', `${Math.round(stats.humSeconds)} s`],
    ['Range', stats.mode === 'coward' ? 'mouse' : `${range} (${octaves} oct)`],
    ['Longest rally', String(stats.longestRally)],
    ['Smashes', String(stats.smashes)],
  ];
  c.textAlign = 'center';
  cells.forEach(([k, v], i) => {
    const x = 150 + i * ((W - 300) / 3);
    c.fillStyle = 'rgba(31,28,23,0.6)';
    c.font = '600 18px "JetBrains Mono", ui-monospace, monospace';
    c.fillText(k.toUpperCase(), x, 450);
    c.fillStyle = '#1f1c17';
    c.font = '700 34px "Fraunces", Georgia, serif';
    c.fillText(v, x, 494);
  });
  c.font = '400 18px "JetBrains Mono", ui-monospace, monospace';
  c.fillStyle = 'rgba(31,28,23,0.6)';
  c.fillText(`${semis} semitones of pure confidence · tone-deaf-tennis.thethomas.tech`, W / 2, 560);
  c.textAlign = 'left';
}
