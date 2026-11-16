// Court physics and the opponent. No DOM, no audio: just numbers in, numbers out,
// so the whole rally can be simulated in tests.

export const COURT = { w: 960, h: 540 } as const;
export const PADDLE = { w: 14, h: 112, inset: 36 } as const;
export const BALL_R = 9;
export const WIN_SCORE = 7;

export type Side = 'you' | 'pete';

export type GameEvent =
  | { type: 'hit'; by: Side; smash: boolean; speed: number }
  | { type: 'wall' }
  | { type: 'point'; to: Side }
  | { type: 'gameover'; winner: Side };

export interface Paddle {
  y: number; // centre
  vy: number;
}

export interface GameState {
  you: Paddle;
  pete: Paddle;
  ball: { x: number; y: number; vx: number; vy: number };
  score: { you: number; pete: number };
  rally: number;
  longestRally: number;
  serveTimer: number; // seconds until the ball moves
  servingTo: Side;
  over: boolean;
  // Pete's slightly wrong idea of where the ball is going.
  peteError: number;
  rng: () => number;
}

export interface PlayerInput {
  /** 0 (top) .. 1 (bottom), or null when you are not making a sound. */
  target: number | null;
  /** True while you are belting. The next return becomes a smash. */
  loud: boolean;
}

export const BASE_SPEED = 380;
export const MAX_SPEED = 920;
const PADDLE_MAX_SPEED = 1500;
const SILENCE_SINK = 70; // px/s. Silence has consequences.

/** Mulberry32: tiny seeded RNG so tests are repeatable. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newGame(rng: () => number = Math.random): GameState {
  const s: GameState = {
    you: { y: COURT.h / 2, vy: 0 },
    pete: { y: COURT.h / 2, vy: 0 },
    ball: { x: COURT.w / 2, y: COURT.h / 2, vx: 0, vy: 0 },
    score: { you: 0, pete: 0 },
    rally: 0,
    longestRally: 0,
    serveTimer: 1.2,
    servingTo: 'you',
    over: false,
    peteError: 0,
    rng,
  };
  return s;
}

/**
 * Pete gets better as the game goes on, worse when he's winning (smug), and
 * worse the longer a rally lasts (he gets bored of your tune).
 */
export function peteSkill(s: GameState): { speed: number; sloppiness: number } {
  const total = s.score.you + s.score.pete;
  const smug = Math.max(0, s.score.pete - s.score.you);
  return {
    speed: 330 + total * 22 - smug * 25,
    sloppiness: Math.max(10, 50 - total * 3 + smug * 12) + s.rally * 5,
  };
}

function serve(s: GameState) {
  const dir = s.servingTo === 'you' ? -1 : 1;
  const angle = (s.rng() - 0.5) * 0.7;
  s.ball.x = COURT.w / 2;
  s.ball.y = COURT.h / 2 + (s.rng() - 0.5) * 160;
  s.ball.vx = Math.cos(angle) * BASE_SPEED * dir;
  s.ball.vy = Math.sin(angle) * BASE_SPEED;
  s.rally = 0;
  s.peteError = (s.rng() - 0.5) * 2 * peteSkill(s).sloppiness;
}

function clampPaddle(p: Paddle) {
  const half = PADDLE.h / 2;
  if (p.y < half) {
    p.y = half;
    p.vy = 0;
  }
  if (p.y > COURT.h - half) {
    p.y = COURT.h - half;
    p.vy = 0;
  }
}

function movePaddleToward(p: Paddle, targetY: number, maxSpeed: number, dt: number) {
  const diff = targetY - p.y;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), maxSpeed * dt);
  p.vy = step / dt;
  p.y += step;
  clampPaddle(p);
}

/** Where on the paddle did it hit? -1 (top edge) .. 1 (bottom edge). */
export function contactOffset(paddleY: number, ballY: number): number {
  return Math.max(-1, Math.min(1, (ballY - paddleY) / (PADDLE.h / 2 + BALL_R)));
}

export function step(s: GameState, input: PlayerInput, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.over) return events;

  // Your paddle: follows your voice, sinks when you go quiet.
  if (input.target !== null) {
    const half = PADDLE.h / 2;
    const targetY = half + input.target * (COURT.h - PADDLE.h);
    movePaddleToward(s.you, targetY, PADDLE_MAX_SPEED, dt);
  } else {
    s.you.vy = SILENCE_SINK;
    s.you.y += SILENCE_SINK * dt;
    clampPaddle(s.you);
  }

  // Pete: tracks the ball when it's coming his way, drifts to centre otherwise.
  const skill = peteSkill(s);
  const peteTarget = s.ball.vx > 0 ? s.ball.y + s.peteError : COURT.h / 2;
  movePaddleToward(s.pete, peteTarget, Math.max(220, skill.speed), dt);

  if (s.serveTimer > 0) {
    s.serveTimer -= dt;
    if (s.serveTimer <= 0) serve(s);
    return events;
  }

  const b = s.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Walls.
  if (b.y < BALL_R) {
    b.y = BALL_R;
    b.vy = Math.abs(b.vy);
    events.push({ type: 'wall' });
  } else if (b.y > COURT.h - BALL_R) {
    b.y = COURT.h - BALL_R;
    b.vy = -Math.abs(b.vy);
    events.push({ type: 'wall' });
  }

  const youFace = PADDLE.inset + PADDLE.w;
  const peteFace = COURT.w - PADDLE.inset - PADDLE.w;

  // Your paddle.
  if (b.vx < 0 && b.x - BALL_R <= youFace && b.x - BALL_R >= PADDLE.inset - 12) {
    if (Math.abs(b.y - s.you.y) <= PADDLE.h / 2 + BALL_R) {
      const smash = input.loud;
      bounce(s, 1, contactOffset(s.you.y, b.y), smash);
      b.x = youFace + BALL_R;
      events.push({ type: 'hit', by: 'you', smash, speed: Math.hypot(b.vx, b.vy) });
    }
  }

  // Pete's paddle.
  if (b.vx > 0 && b.x + BALL_R >= peteFace && b.x + BALL_R <= peteFace + PADDLE.w + 12) {
    if (Math.abs(b.y - s.pete.y) <= PADDLE.h / 2 + BALL_R) {
      bounce(s, -1, contactOffset(s.pete.y, b.y), false);
      b.x = peteFace - BALL_R;
      s.peteError = (s.rng() - 0.5) * 2 * peteSkill(s).sloppiness;
      events.push({ type: 'hit', by: 'pete', smash: false, speed: Math.hypot(b.vx, b.vy) });
    }
  }

  // Points.
  if (b.x < -BALL_R * 2 || b.x > COURT.w + BALL_R * 2) {
    const to: Side = b.x < 0 ? 'pete' : 'you';
    s.score[to] += 1;
    s.longestRally = Math.max(s.longestRally, s.rally);
    events.push({ type: 'point', to });
    if (s.score[to] >= WIN_SCORE) {
      s.over = true;
      events.push({ type: 'gameover', winner: to });
    } else {
      s.servingTo = to === 'you' ? 'pete' : 'you';
      s.serveTimer = 1.1;
      b.vx = 0;
      b.vy = 0;
      b.x = COURT.w / 2;
      b.y = COURT.h / 2;
    }
  }

  return events;
}

function bounce(s: GameState, dir: 1 | -1, offset: number, smash: boolean) {
  const b = s.ball;
  s.rally += 1;
  s.longestRally = Math.max(s.longestRally, s.rally);
  let speed = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * 1.05 + 6);
  if (smash) speed = Math.min(MAX_SPEED * 1.15, speed * 1.4);
  const angle = offset * 1.0; // up to ~57 degrees off the edge of the paddle
  b.vx = Math.cos(angle) * speed * dir;
  b.vy = Math.sin(angle) * speed;
}
