// Perfect Pitch Pete's commentary. He is not a nice man.

export const QUIPS = {
  serve: ['Pete: Ready when you are. I was born ready. In C major.', 'Pete: Hum away.', 'Pete: I can hear you breathing.'],
  youScore: [
    'Pete: That was flat. Still counts, apparently.',
    'Pete: Lucky. Musically, and in general.',
    'Pete: I let that one go. For the vibe.',
    'Pete: Fine. Write it down.',
  ],
  peteScore: [
    'Pete: Perfect pitch. As usual.',
    'Pete: You went sharp. The ball went past.',
    'Pete: Have you tried humming better?',
    'Pete: That note does not exist.',
    'Pete: Lovely. Was that meant to be a B?',
  ],
  smash: ['SMASH. The neighbours heard that.', 'SMASH. Somewhere, a dog is concerned.', 'SMASH. That counted as singing.'],
  silent: ['Your paddle is sinking. Hum something.', 'Silence has consequences.'],
  longRally: ['Rally of {n}. This is now technically a song.', 'Rally of {n}. Pete is sweating, quietly, in tune.'],
  youWin: ['Pete: I demand a retune.', 'Pete: The ball was flat.'],
  peteWins: ['Pete: Good game. For you, I mean. You got some points.', 'Pete: Same time next week? Bring a tuning fork.'],
} as const;

export function pick<T>(arr: readonly T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** What your hummed range says about you. Purely scientific. */
export function verdict(semitones: number): string {
  if (semitones < 4) return 'Monotone Menace';
  if (semitones < 8) return 'Shower Soloist';
  if (semitones < 13) return 'Kitchen Tenor';
  if (semitones < 19) return 'Certified Hummer';
  if (semitones < 25) return 'Two-Octave Terror';
  return 'Whale Song Enjoyer';
}
