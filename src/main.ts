import './style.css';
import { Ear, Sfx } from './audio';
import { COURT, PADDLE, BALL_R, newGame, step, type GameState, type PlayerInput } from './game';
import { hzToMidi, midiToHz, noteName, pitchToCourt, PitchSmoother } from './pitch';
import { QUIPS, pick, verdict } from './quips';
import { drawCertificate, type Stats } from './certificate';

type Mode = 'voice' | 'robot' | 'coward';
type Screen = 'title' | 'calibrate' | 'ready' | 'play' | 'over';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('court');
const ctx2d = canvas.getContext('2d')!;
const params = new URLSearchParams(location.search);

const app = {
  screen: 'title' as Screen,
  mode: 'voice' as Mode,
  audio: null as AudioContext | null,
  ear: null as Ear | null,
  sfx: null as Sfx | null,
  game: null as GameState | null,
  range: { lowHz: midiToHz(48), highHz: midiToHz(67) }, // C3 .. G4 by default
  smoother: new PitchSmoother(5),
  target: null as number | null,
  lastHeardAt: 0,
  lastMidi: null as number | null,
  loud: false,
  beltRms: 0.14,
  pointerTarget: 0.5,
  keys: new Set<string>(),
  trail: [] as { y: number; t: number }[],
  ballTrail: [] as { x: number; y: number }[],
  flash: 0,
  stats: null as Stats | null,
  silentSince: 0,
  quipTimer: 0 as number | undefined,
};

// ---------- canvas sizing ----------
function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = COURT.w * dpr;
  canvas.height = COURT.h * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// ---------- screens ----------
function show(screen: Screen) {
  app.screen = screen;
  for (const s of ['title', 'calibrate', 'ready', 'over'] as const) {
    $(`screen-${s}`).classList.toggle('hidden', s !== screen);
  }
  $('note-readout').classList.toggle('hidden', !(screen === 'play' || screen === 'calibrate') || app.mode === 'coward');
  $('mode-pill').textContent = screen === 'title' ? 'menu' : { voice: 'voice', robot: 'robot demo', coward: 'coward mode' }[app.mode];
  document.body.dataset.screen = screen;
}

function quip(text: string, ms = 2600) {
  const el = $('quip');
  el.textContent = text;
  el.classList.remove('hidden');
  window.clearTimeout(app.quipTimer);
  app.quipTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
}

async function ensureAudio() {
  if (!app.audio) app.audio = new AudioContext();
  if (app.audio.state === 'suspended') await app.audio.resume();
  return app.audio;
}

async function start(mode: Mode) {
  app.mode = mode;
  const ac = await ensureAudio();
  app.ear?.stop();
  app.ear = null;
  if (mode === 'voice') {
    const ear = new Ear(ac);
    try {
      await ear.listenToMic();
    } catch (err) {
      console.warn(err);
      quip('No microphone, no humming. Coward mode it is.', 4000);
      return start('coward');
    }
    app.ear = ear;
    app.sfx = new Sfx(ac, ear);
    beginCalibration();
  } else if (mode === 'robot') {
    const ear = new Ear(ac);
    ear.listenToRobot();
    app.ear = ear;
    app.sfx = new Sfx(ac);
    app.range = { lowHz: midiToHz(50), highHz: midiToHz(69) }; // D3 .. A4, a very average robot
    readyScreen(true);
  } else {
    app.sfx = new Sfx(ac);
    readyScreen(true);
  }
  app.sfx!.muted = muted;
}

// ---------- calibration ----------
const cal = { step: 0 as 0 | 1, samples: [] as number[], rmsSamples: [] as number[], startedAt: 0, low: 0 };
const CAL_SECONDS = 2.2;

function beginCalibration() {
  cal.step = 0;
  cal.samples = [];
  cal.rmsSamples = [];
  setCalText();
  show('calibrate');
}

function setCalText() {
  $('cal-step').textContent = `Step ${cal.step + 1} of 2`;
  $('cal-title').textContent = cal.step === 0 ? 'Hum your lowest comfortable note' : 'Now your highest comfortable note';
  $('cal-help').textContent =
    cal.step === 0
      ? 'Hold it steady for a couple of seconds. This becomes the bottom of the court.'
      : 'No need to scream. Something you could hold for a while. This becomes the top.';
  $('cal-progress').style.width = '0%';
}

function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

function tickCalibration(now: number) {
  const r = app.ear?.read();
  const live = $('cal-note');
  if (r && r.clarity > 0.8) {
    const midi = hzToMidi(r.hz);
    const { name, cents } = noteName(r.hz);
    live.textContent = `${name} ${cents >= 0 ? '+' : ''}${cents}¢`;
    if (!cal.samples.length) cal.startedAt = now;
    cal.samples.push(midi);
    cal.rmsSamples.push(r.rms);
  } else {
    live.textContent = '…';
  }
  updateReadout(r && r.clarity > 0.8 ? r.hz : null, r?.rms ?? 0);
  const elapsed = cal.samples.length ? (now - cal.startedAt) / 1000 : 0;
  $('cal-progress').style.width = `${Math.min(100, (elapsed / CAL_SECONDS) * 100)}%`;
  if (elapsed >= CAL_SECONDS && cal.samples.length > 20) {
    if (cal.step === 0) {
      cal.low = percentile(cal.samples, 0.3);
      cal.step = 1;
      cal.samples = [];
      setCalText();
    } else {
      let high = percentile(cal.samples, 0.7);
      let low = cal.low;
      let note = '';
      if (high < low) [high, low] = [low, high];
      if (high - low < 7) {
        const span = Math.round(high - low);
        const mid = (high + low) / 2;
        low = mid - 3.5;
        high = mid + 3.5;
        note = `Your low and high notes were ${span} semitone${span === 1 ? '' : 's'} apart, which is cosy. We stretched it to 7. You're welcome.`;
      }
      app.range = { lowHz: midiToHz(low), highHz: midiToHz(high) };
      app.beltRms = Math.max(0.1, percentile(cal.rmsSamples, 0.5) * 2.4);
      readyScreen(false, note);
    }
  }
}

function readyScreen(skipCal: boolean, extra = '') {
  const lo = noteName(app.range.lowHz).name;
  const hi = noteName(app.range.highHz).name;
  const semis = Math.round(hzToMidi(app.range.highHz) - hzToMidi(app.range.lowHz));
  $('ready-range').textContent = app.mode === 'coward' ? 'Coward mode' : `${lo} to ${hi}`;
  $('ready-quip').textContent =
    app.mode === 'coward'
      ? 'Move the mouse (or use the arrow keys). Hold Shift to smash. Pete will know.'
      : app.mode === 'robot'
        ? 'A robot will hum for you, through the same pitch detector your voice would use. Sit back.'
        : extra || `${semis} semitones. ${verdict(semis)}. Pete has heard worse.`;
  $('btn-recal').classList.toggle('hidden', app.mode !== 'voice' || skipCal);
  show('ready');
}

// ---------- game ----------
function startGame() {
  app.game = newGame();
  app.stats = { humSeconds: 0, minMidi: Infinity, maxMidi: -Infinity, notes: [], smashes: 0, longestRally: 0, you: 0, pete: 0, mode: app.mode };
  app.smoother.reset();
  app.trail = [];
  app.ballTrail = [];
  app.silentSince = performance.now();
  updateScore();
  show('play');
  quip(pick(QUIPS.serve));
}

function updateScore() {
  $('score-you').textContent = String(app.game?.score.you ?? 0);
  $('score-pete').textContent = String(app.game?.score.pete ?? 0);
}

function updateReadout(hz: number | null, level: number) {
  const name = $('note-name');
  const detail = $('note-detail');
  if (hz) {
    const n = noteName(hz);
    name.textContent = n.name;
    detail.textContent = `${hz.toFixed(0)} Hz · ${n.cents >= 0 ? '+' : ''}${n.cents}¢`;
  } else {
    name.textContent = '—';
    detail.textContent = app.mode === 'robot' ? 'robot is breathing' : 'hum something';
  }
  $('meter-fill').style.width = `${Math.min(100, (level / app.beltRms) * 100)}%`;
  $('meter-fill').classList.toggle('loud', level >= app.beltRms);
}

/** The robot hummer: works out where the paddle should be and hums that note. */
function robotThink(g: GameState, now: number) {
  const ear = app.ear!;
  // Predict where the ball will cross our paddle, bouncing off walls.
  let y = g.ball.y;
  if (g.ball.vx < 0) {
    const t = (g.ball.x - (PADDLE.inset + PADDLE.w)) / -g.ball.vx;
    y = g.ball.y + g.ball.vy * t;
    const h = COURT.h - 2 * BALL_R;
    y = ((((y - BALL_R) % (2 * h)) + 2 * h) % (2 * h));
    y = (y > h ? 2 * h - y : y) + BALL_R;
  } else {
    y = COURT.h / 2 + (g.ball.y - COURT.h / 2) * 0.3;
  }
  // Aim a little off-centre so it angles the ball, and wobble like a real voice.
  y += Math.sin(now / 900) * 24;
  const t = Math.min(1, Math.max(0, (y - PADDLE.h / 2) / (COURT.h - PADDLE.h)));
  const lo = hzToMidi(app.range.lowHz);
  const hi = hzToMidi(app.range.highHz);
  const midi = lo + (1 - t) * (hi - lo) + Math.sin(now / 70) * 0.15;
  const breathing = g.ball.vx > 0 && g.ball.x > COURT.w * 0.75 && Math.sin(now / 1300) > 0.6;
  const closeIn = g.ball.vx < 0 && g.ball.x < 190;
  ear.robotHum(breathing ? null : midiToHz(midi), closeIn && Math.sin(now / 2100) > 0.2);
}

function readInput(now: number): PlayerInput {
  if (app.mode === 'coward') {
    let t = app.pointerTarget;
    if (app.keys.has('ArrowUp')) t -= 0.03;
    if (app.keys.has('ArrowDown')) t += 0.03;
    app.pointerTarget = Math.min(1, Math.max(0, t));
    return { target: app.pointerTarget, loud: app.keys.has('Shift') };
  }
  const ear = app.ear!;
  const r = ear.read();
  const deaf = !ear.isRobot && now < ear.deafUntil;
  if (r && r.clarity > 0.75 && !deaf) {
    const midi = app.smoother.push(hzToMidi(r.hz));
    app.lastMidi = midi;
    app.lastHeardAt = now;
    app.target = pitchToCourt(midiToHz(midi), app.range.lowHz, app.range.highHz);
    app.loud = r.rms >= app.beltRms;
    updateReadout(midiToHz(midi), r.rms);
    if (app.stats) {
      app.stats.minMidi = Math.min(app.stats.minMidi, midi);
      app.stats.maxMidi = Math.max(app.stats.maxMidi, midi);
    }
  } else if (deaf || now - app.lastHeardAt < 140) {
    // brief gaps between syllables or our own beeps: hold position
  } else {
    app.target = null;
    app.loud = false;
    app.smoother.reset();
    updateReadout(null, r?.rms ?? 0);
  }
  return { target: app.target, loud: app.loud };
}

let last = performance.now();
let acc = 0;
const DT = 1 / 120;

function frame(now: number) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.screen === 'calibrate') tickCalibration(now);
  if (app.screen === 'play' && app.game) {
    const g = app.game;
    if (app.mode === 'robot') robotThink(g, now);
    const input = readInput(now);
    if (input.target !== null && app.stats && app.mode !== 'coward') app.stats.humSeconds += elapsed;
    if (input.target === null && app.mode !== 'coward') {
      if (now - app.silentSince > 2500) {
        quip(pick(QUIPS.silent), 1800);
        app.silentSince = now;
      }
    } else app.silentSince = now;
    acc += elapsed;
    while (acc >= DT) {
      acc -= DT;
      for (const ev of step(g, input, DT)) handleEvent(ev, g);
    }
    app.trail.push({ y: g.you.y, t: now });
    while (app.trail.length && now - app.trail[0].t > 2600) app.trail.shift();
    app.ballTrail.push({ x: g.ball.x, y: g.ball.y });
    if (app.ballTrail.length > 14) app.ballTrail.shift();
  }
  draw(now);
  requestAnimationFrame(frame);
}

function handleEvent(ev: ReturnType<typeof step>[number], g: GameState) {
  const sfx = app.sfx!;
  const stats = app.stats!;
  switch (ev.type) {
    case 'hit':
      if (ev.by === 'you') {
        const midi = app.mode === 'coward' ? 72 - app.pointerTarget * 19 : (app.lastMidi ?? 60);
        stats.notes.push(midi);
        sfx.yourHit(midi, ev.smash);
        if (ev.smash) {
          stats.smashes += 1;
          app.flash = 1;
          quip(pick(QUIPS.smash), 1600);
        }
      } else {
        sfx.peteHit(g.rally);
      }
      if (g.rally > 0 && g.rally % 8 === 0) quip(pick(QUIPS.longRally).replace('{n}', String(g.rally)), 2000);
      break;
    case 'wall':
      sfx.wall();
      break;
    case 'point':
      sfx.point(ev.to === 'you');
      updateScore();
      quip(pick(ev.to === 'you' ? QUIPS.youScore : QUIPS.peteScore));
      break;
    case 'gameover':
      stats.you = g.score.you;
      stats.pete = g.score.pete;
      stats.longestRally = g.longestRally;
      app.ear?.robotHum(null);
      window.setTimeout(() => gameOver(ev.winner === 'you'), 900);
      break;
  }
}

function gameOver(won: boolean) {
  const stats = app.stats!;
  $('over-title').textContent = won ? 'You beat Perfect Pitch Pete' : 'Pete wins. Obviously.';
  quip(pick(won ? QUIPS.youWin : QUIPS.peteWins), 4000);
  drawCertificate($<HTMLCanvasElement>('cert'), stats);
  show('over');
  (window as unknown as { __lastStats: Stats }).__lastStats = stats;
}

// ---------- drawing ----------
const INK = '#1f1c17';
const PAPER = '#f4ecdb';
const RED = '#e2532d';
const BALL = '#cfe03a';

function draw(now: number) {
  const c = ctx2d;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, COURT.w, COURT.h);

  // The court is a stave: one line per semitone in your range, labelled on the left.
  const lo = Math.ceil(hzToMidi(app.range.lowHz));
  const hi = Math.floor(hzToMidi(app.range.highHz));
  const curMidi = app.target !== null && app.lastMidi !== null && app.mode !== 'coward' ? Math.round(app.lastMidi) : null;
  c.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  c.textBaseline = 'middle';
  for (let m = lo; m <= hi; m++) {
    const t = pitchToCourt(midiToHz(m), app.range.lowHz, app.range.highHz);
    const y = PADDLE.h / 2 + t * (COURT.h - PADDLE.h);
    const natural = ![1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
    if (m === curMidi) {
      c.fillStyle = 'rgba(207, 224, 58, 0.45)';
      c.fillRect(0, y - 9, COURT.w, 18);
    }
    c.strokeStyle = natural ? 'rgba(31,28,23,0.16)' : 'rgba(31,28,23,0.06)';
    c.lineWidth = m % 12 === 0 ? 2 : 1;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(COURT.w, y);
    c.stroke();
    if (natural && app.mode !== 'coward') {
      c.fillStyle = m === curMidi ? INK : 'rgba(31,28,23,0.45)';
      c.fillText(noteName(midiToHz(m)).name, 6, y - 7);
    }
  }

  // Big faint score.
  if (app.game) {
    c.fillStyle = 'rgba(31,28,23,0.07)';
    c.font = '700 180px "Fraunces", Georgia, serif';
    c.textAlign = 'center';
    c.fillText(String(app.game.score.you), COURT.w * 0.27, COURT.h / 2 + 10);
    c.fillText(String(app.game.score.pete), COURT.w * 0.73, COURT.h / 2 + 10);
    c.textAlign = 'left';
  }

  // Net.
  c.strokeStyle = 'rgba(31,28,23,0.5)';
  c.lineWidth = 3;
  c.setLineDash([10, 14]);
  c.beginPath();
  c.moveTo(COURT.w / 2, 0);
  c.lineTo(COURT.w / 2, COURT.h);
  c.stroke();
  c.setLineDash([]);

  const g = app.game;
  const youY = g?.you.y ?? COURT.h / 2 + Math.sin(now / 700) * 120;
  const peteY = g?.pete.y ?? COURT.h / 2 + Math.sin(now / 700 + 1) * 90;

  // Your voice leaves a wake across your half of the court.
  if (app.trail.length > 2) {
    c.strokeStyle = 'rgba(226, 83, 45, 0.55)';
    c.lineWidth = 2.5;
    c.beginPath();
    app.trail.forEach((p, i) => {
      const x = PADDLE.inset + PADDLE.w + (now - p.t) * 0.16;
      if (i === 0) c.moveTo(x, p.y);
      else c.lineTo(x, p.y);
    });
    c.stroke();
  }

  // Paddles.
  roundRect(c, PADDLE.inset, youY - PADDLE.h / 2, PADDLE.w, PADDLE.h, 7, RED);
  roundRect(c, COURT.w - PADDLE.inset - PADDLE.w, peteY - PADDLE.h / 2, PADDLE.w, PADDLE.h, 7, INK);
  c.fillStyle = 'rgba(31,28,23,0.5)';
  c.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  c.fillText('YOU', PADDLE.inset - 4, Math.max(14, youY - PADDLE.h / 2 - 10));
  c.fillText('PETE', COURT.w - PADDLE.inset - PADDLE.w - 10, Math.max(14, peteY - PADDLE.h / 2 - 10));

  // Ball and its trail.
  if (g) {
    app.ballTrail.forEach((p, i) => {
      c.fillStyle = `rgba(31,28,23,${(i / app.ballTrail.length) * 0.15})`;
      c.beginPath();
      c.arc(p.x, p.y, BALL_R * (i / app.ballTrail.length), 0, Math.PI * 2);
      c.fill();
    });
    c.fillStyle = BALL;
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(g.ball.x, g.ball.y, BALL_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (g.serveTimer > 0 && !g.over) {
      c.fillStyle = INK;
      c.font = '700 28px "Fraunces", Georgia, serif';
      c.textAlign = 'center';
      c.fillText(g.servingTo === 'you' ? 'Serving to you' : 'Serving to Pete', COURT.w / 2, 60);
      c.textAlign = 'left';
    }
  }

  if (app.flash > 0) {
    c.fillStyle = `rgba(226, 83, 45, ${app.flash * 0.25})`;
    c.fillRect(0, 0, COURT.w, COURT.h);
    app.flash = Math.max(0, app.flash - 0.05);
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

// ---------- wiring ----------
let muted = false;
$('btn-mic').addEventListener('click', () => start('voice'));
$('btn-robot').addEventListener('click', () => start('robot'));
$('btn-coward').addEventListener('click', () => start('coward'));
$('btn-cal-skip').addEventListener('click', () => {
  app.range = { lowHz: midiToHz(48), highHz: midiToHz(67) };
  readyScreen(true, 'Default range C3 to G4. If your voice lives elsewhere, recalibrate.');
  $('btn-recal').classList.remove('hidden');
});
$('btn-play').addEventListener('click', startGame);
$('btn-recal').addEventListener('click', beginCalibration);
$('btn-rematch').addEventListener('click', startGame);
$('btn-menu').addEventListener('click', () => {
  app.ear?.stop();
  app.ear = null;
  app.game = null;
  show('title');
});
$('btn-melody').addEventListener('click', () => {
  const notes = app.stats?.notes ?? [];
  if (!notes.length) return quip('You did not hit the ball. There is no song. Only silence.');
  app.sfx?.melody(notes);
  quip(`Playing your ${notes.length}-note masterpiece.`, 3000);
});
$('btn-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = 'tone-deaf-tennis-certificate.png';
  a.href = $<HTMLCanvasElement>('cert').toDataURL('image/png');
  a.click();
});
$('mute').addEventListener('click', () => {
  muted = !muted;
  if (app.sfx) app.sfx.muted = muted;
  $('mute').classList.toggle('off', muted);
});

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * COURT.h;
  app.pointerTarget = Math.min(1, Math.max(0, (y - PADDLE.h / 2) / (COURT.h - PADDLE.h)));
});
window.addEventListener('keydown', (e) => {
  app.keys.add(e.key);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') e.preventDefault();
});
window.addEventListener('keyup', (e) => app.keys.delete(e.key));

show('title');
requestAnimationFrame(frame);

// ?demo=robot starts the robot straight away (used for the demo video and the e2e test).
if (params.get('demo') === 'robot') {
  document.addEventListener(
    'click',
    async () => {
      if (app.screen === 'title') {
        await start('robot');
        startGame();
      }
    },
    { once: true },
  );
}

// Expose a little state for the end-to-end tests.
(window as unknown as { __tdt: unknown }).__tdt = app;
