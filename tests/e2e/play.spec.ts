import { expect, test } from '@playwright/test';

type Tdt = {
  screen: string;
  range: { lowHz: number; highHz: number };
  game: { you: { y: number }; rally: number; score: { you: number; pete: number } } | null;
  stats: { notes: number[]; humSeconds: number } | null;
};
const state = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __tdt: Tdt }).__tdt);

test('title screen explains the remix in one line', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Tone Deaf');
  await expect(page.getByText('you play it by humming')).toBeVisible();
  await page.screenshot({ path: 'docs/screens/title.png' });
});

/**
 * Stand-in microphone: getUserMedia returns a real MediaStream carrying a recorded hum
 * (tests/fixtures/hum.wav), so the app's own mic path (MediaStreamSource -> analyser ->
 * YIN) is what gets tested. Chrome's built-in fake-audio flag was too choppy in headless.
 */
async function fakeMic(page: import('@playwright/test').Page) {
  await page.route('**/__hum.wav', (route) => route.fulfill({ path: 'tests/fixtures/hum.wav', contentType: 'audio/wav' }));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const data = await (await fetch('/__hum.wav')).arrayBuffer();
      const src = ac.createBufferSource();
      src.buffer = await ac.decodeAudioData(data);
      src.loop = true;
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      return dest.stream;
    };
  });
}

test('voice mode: a hummed low and high note calibrate the court, then the hum drives the paddle', async ({ page }) => {
  await fakeMic(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Use my voice' }).click();
  await expect(page.locator('#screen-calibrate')).toBeVisible();
  // The fake mic plays C3 for 3 s then E4 for 3 s.
  await expect(page.locator('#screen-ready')).toBeVisible({ timeout: 20_000 });
  const s = await state(page);
  const semis = 12 * Math.log2(s.range.highHz / s.range.lowHz);
  console.log('calibrated range Hz', s.range, 'semitones', semis.toFixed(1));
  expect(s.range.lowHz).toBeGreaterThan(110);
  expect(s.range.lowHz).toBeLessThan(160);
  expect(s.range.highHz).toBeGreaterThan(290);
  expect(s.range.highHz).toBeLessThan(370);
  await page.screenshot({ path: 'docs/screens/calibrated.png' });

  await page.getByRole('button', { name: 'Serve' }).click();
  const ys: number[] = [];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    ys.push((await state(page)).game!.you.y);
  }
  const spread = Math.max(...ys) - Math.min(...ys);
  console.log('paddle travel while the fake voice glides:', spread.toFixed(0), 'px');
  expect(spread).toBeGreaterThan(80);
  await expect(page.locator('#note-name')).not.toHaveText('—');
  await page.screenshot({ path: 'docs/screens/voice-play.png' });
});

test('robot demo: the robot hums through the real detector and rallies with Pete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch the robot hum' }).click();
  await page.getByRole('button', { name: 'Serve' }).click();
  await page.waitForTimeout(15_000);
  const s = await state(page);
  console.log('robot after 15 s: hits', s.stats!.notes.length, 'score', s.game!.score, 'hummed', s.stats!.humSeconds.toFixed(1), 's');
  expect(s.stats!.notes.length).toBeGreaterThan(2);
  expect(s.stats!.humSeconds).toBeGreaterThan(5);
  await page.screenshot({ path: 'docs/screens/robot-play.png' });
});

test('coward mode works with the mouse and shows a certificate at the end', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coward mode (mouse)' }).click();
  await page.getByRole('button', { name: 'Serve' }).click();
  // Leave the mouse parked at the top: Pete wins 7-0 in under a minute or so.
  await expect(page.locator('#screen-over')).toBeVisible({ timeout: 80_000 });
  await expect(page.locator('#over-title')).toContainText('Pete');
  await page.screenshot({ path: 'docs/screens/certificate.png' });
});
