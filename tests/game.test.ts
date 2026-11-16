import { describe, expect, it } from 'vitest';
import { COURT, PADDLE, BALL_R, MAX_SPEED, WIN_SCORE, newGame, seededRng, step, type GameEvent } from '../src/game';

const DT = 1 / 120;

function run(s: ReturnType<typeof newGame>, seconds: number, input: (s: ReturnType<typeof newGame>) => { target: number | null; loud: boolean }) {
  const events: GameEvent[] = [];
  for (let i = 0; i < seconds / DT && !s.over; i++) events.push(...step(s, input(s), DT));
  return events;
}

/** A perfect hummer: always sings the note that puts the paddle on the ball. */
const perfect = (s: ReturnType<typeof newGame>) => ({
  target: Math.min(1, Math.max(0, (s.ball.y - PADDLE.h / 2) / (COURT.h - PADDLE.h))),
  loud: false,
});

describe('game', () => {
  it('waits for the serve, then moves the ball', () => {
    const s = newGame(seededRng(1));
    step(s, { target: 0.5, loud: false }, 0.5);
    expect(s.ball.vx).toBe(0);
    run(s, 1, () => ({ target: 0.5, loud: false }));
    expect(Math.abs(s.ball.vx)).toBeGreaterThan(0);
  });

  it('humming high sends your paddle to the top, low to the bottom', () => {
    const s = newGame(seededRng(1));
    run(s, 1, () => ({ target: 0, loud: false }));
    expect(s.you.y).toBeCloseTo(PADDLE.h / 2);
    run(s, 1, () => ({ target: 1, loud: false }));
    expect(s.you.y).toBeCloseTo(COURT.h - PADDLE.h / 2);
  });

  it('silence makes the paddle sink', () => {
    const s = newGame(seededRng(1));
    const y0 = s.you.y;
    run(s, 1, () => ({ target: null, loud: false }));
    expect(s.you.y).toBeGreaterThan(y0 + 50);
  });

  it('keeps the ball inside the court vertically', () => {
    const s = newGame(seededRng(3));
    for (let i = 0; i < 120 * 30 && !s.over; i++) {
      step(s, perfect(s), DT);
      expect(s.ball.y).toBeGreaterThanOrEqual(BALL_R - 0.001);
      expect(s.ball.y).toBeLessThanOrEqual(COURT.h - BALL_R + 0.001);
    }
  });

  it('a perfect hummer never concedes a point in 60 seconds', () => {
    const s = newGame(seededRng(42));
    const events = run(s, 60, perfect);
    expect(events.filter((e) => e.type === 'point' && e.to === 'pete')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'hit' && e.by === 'you').length).toBeGreaterThan(10);
  });

  it('a silent player loses 0-7 and the game ends', () => {
    const s = newGame(seededRng(5));
    const events = run(s, 600, () => ({ target: null, loud: false }));
    expect(s.over).toBe(true);
    expect(s.score.pete).toBe(WIN_SCORE);
    expect(events.at(-1)).toEqual({ type: 'gameover', winner: 'pete' });
  });

  it('Pete is beatable: a perfect hummer who angles shots wins most seeded matches in under 5 minutes', () => {
    const angled = (s: ReturnType<typeof newGame>) => {
      const y = s.ball.y + (s.ball.y < COURT.h / 2 ? 30 : -30);
      return { target: Math.min(1, Math.max(0, (y - PADDLE.h / 2) / (COURT.h - PADDLE.h))), loud: false };
    };
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = newGame(seededRng(seed));
      run(s, 300, angled);
      if (s.score.you === WIN_SCORE) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(15);
  });

  it('belting turns a return into a faster smash', () => {
    const speedAfterHit = (loud: boolean) => {
      const s = newGame(seededRng(9));
      let speed = 0;
      for (let i = 0; i < 120 * 20 && !speed; i++) {
        for (const e of step(s, { ...perfect(s), loud }, DT)) if (e.type === 'hit' && e.by === 'you') speed = e.speed;
      }
      return speed;
    };
    expect(speedAfterHit(true)).toBeGreaterThan(speedAfterHit(false) * 1.3);
  });

  it('never goes faster than the speed cap', () => {
    const s = newGame(seededRng(11));
    let max = 0;
    for (let i = 0; i < 120 * 120 && !s.over; i++) {
      for (const e of step(s, { ...perfect(s), loud: true }, DT)) if (e.type === 'hit') max = Math.max(max, e.speed);
    }
    expect(max).toBeLessThanOrEqual(MAX_SPEED * 1.15 + 1);
  });
});
