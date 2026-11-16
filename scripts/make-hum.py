"""Writes tests/fixtures/hum.wav: a synthetic 'voice' used as a stand-in microphone in the e2e test.
3 s at C3 (low), 3 s at E4 (high), then slow glides between them, with vibrato and harmonics."""
import math, struct, wave

SR = 48000
segments = [(130.81, 130.81, 3.0), (329.63, 329.63, 3.0), (130.81, 329.63, 6.0), (329.63, 130.81, 6.0)]
frames, phase, t = [], 0.0, 0.0
for a, b, dur in segments:
    n = int(SR * dur)
    for i in range(n):
        f = a * (b / a) ** (i / n) * (1 + 0.004 * math.sin(2 * math.pi * 5.5 * t))
        phase += 2 * math.pi * f / SR  # integrate frequency so glides are real glides
        frames.append(0.3 * sum(math.sin(h * phase) / (h * h) for h in range(1, 6)))
        t += 1 / SR

with wave.open('tests/fixtures/hum.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in frames))
print('wrote', len(frames) / SR, 'seconds')
