// Joins a Google Meet as a guest named "AlmaEd class recording" (the host admits it once), and
// (when RTMP_URL is set) streams the call's screen and sound to YouTube with ffmpeg. A Google login
// can't be used here: Google ties it to the computer it was made on, and every runner is new. Runs on a GitHub Actions
// runner under Xvfb (screen :99) and PulseAudio (sink "rec").
//
// The repo is public, so its logs are too: never print the Meet link, the stream URL or cookies.
// Env: MEET_URL, MINUTES (how long to stay, max 300), RTMP_URL (optional: rtmps://.../<stream key>),
// GUEST_NAME (optional).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const MEET_URL = process.env.MEET_URL ?? '';
const MINUTES = Math.min(300, Number(process.env.MINUTES || 5));
const RTMP_URL = process.env.RTMP_URL ?? '';
if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(MEET_URL)) throw new Error('MEET_URL is not a Google Meet link.');
const GUEST_NAME = process.env.GUEST_NAME || 'AlmaEd class recording';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false, // a real window on the virtual screen: Meet treats headless Chrome as a bot
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--disable-blink-features=AutomationControlled',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--start-fullscreen',
    '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: null,
  permissions: ['microphone', 'camera', 'notifications'],
});
const page = await context.newPage();

// The first visible button whose text or label matches.
async function clickIf(pattern) {
  const button = page.getByRole('button', { name: pattern }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => {});
    return true;
  }
  return false;
}

let ffmpeg;
async function finish(code) {
  log('leaving');
  await page.locator('[aria-label*="leave call" i]').first().click({ timeout: 3000 }).catch(() => {});
  if (ffmpeg) {
    ffmpeg.kill('SIGINT'); // lets ffmpeg close the stream cleanly, so YouTube ends the broadcast
    await sleep(5000);
  }
  await browser.close().catch(() => {});
  process.exit(code);
}

try {
  await page.goto(MEET_URL, { waitUntil: 'domcontentloaded' });
  await sleep(8000);

  // What the recorder sees, without the link: the site, the tab title, and which join controls show.
  const seen = async (re) => page.getByText(re).first().isVisible().catch(() => false);
  log(`page: ${new URL(page.url()).hostname}`); // never the title: it holds the meeting code
  log(`seen: ready-to-join=${await seen(/ready to join/i)} join-now=${await seen(/join now/i)} ask-to-join=${await seen(/ask to join/i)} your-name=${await seen(/what.s your name/i)} sign-in-button=${await page.getByRole('link', { name: /^sign in$/i }).first().isVisible().catch(() => false)}`);

  // As a guest, Meet asks for a name first.
  const nameBox = page.getByRole('textbox', { name: /your name/i }).first();
  if (await nameBox.isVisible().catch(() => false)) await nameBox.fill(GUEST_NAME);

  // Microphone and camera off before joining (Meet's own shortcuts as a fallback).
  if (!(await clickIf(/turn off microphone/i))) await page.keyboard.press('Control+d');
  if (!(await clickIf(/turn off camera/i))) await page.keyboard.press('Control+e');
  await sleep(1000);

  const joined = (await clickIf(/^join now$/i)) || (await clickIf(/^join$/i));
  const asked = !joined && (await clickIf(/ask to join/i));
  log(joined ? 'joining' : asked ? 'asked to join, waiting for the host to admit' : 'FAILED: no join button found');
  if (!joined && !asked) await finish(4);

  // In the call: the leave button shows (Meet's label varies, so match it loosely), or the
  // waiting screen is gone and the call's controls (mic, camera, people) are showing.
  const leaveButton = page.locator('[aria-label*="leave call" i], [data-tooltip*="leave call" i]').first();
  const waiting = () => seen(/asking to be let in|ask to join|someone will let you in/i);
  const inCall = async () =>
    (await leaveButton.isVisible().catch(() => false)) ||
    (!(await waiting()) && (await page.locator('[aria-label*="microphone" i]').count()) > 0 && (await page.locator('[aria-label*="people" i], [aria-label*="participants" i]').count()) > 0);
  const admitBy = Date.now() + 15 * 60e3;
  while (!(await inCall())) {
    // Only Meet's own refusal messages (looser words also appear on the normal waiting screen).
    const refused = (await seen(/denied your request/i)) ? 'denied' : (await seen(/you can.t join this (video )?call/i)) ? 'cant-join' : (await seen(/you.ve been removed/i)) ? 'removed' : '';
    if (Date.now() > admitBy || refused === 'denied' || refused === 'removed') {
      log(`FAILED: never got into the call (${refused || 'not admitted within 15 minutes'})`);
      await finish(5);
    }
    // "You can't join" also shows while nobody (no host) is in the call yet: ask again shortly.
    if (refused === 'cant-join') {
      log('nobody to let it in yet, asking again in 30 s');
      await sleep(30_000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(6000);
      const box = page.getByRole('textbox', { name: /your name/i }).first();
      if (await box.isVisible().catch(() => false)) await box.fill(GUEST_NAME);
      await clickIf(/ask to join/i);
    }
    await sleep(3000);
  }
  log('in the call');

  if (RTMP_URL) {
    ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-f', 'x11grab', '-video_size', '1280x720', '-framerate', '30', '-i', process.env.DISPLAY || ':99',
      '-f', 'pulse', '-i', 'rec.monitor',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv', RTMP_URL,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    // ffmpeg errors can contain the URL (and so the key): print only that it failed.
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('exit', (code) => log(`stream stopped (ffmpeg exit ${code})`));
    log('streaming to YouTube');
  }

  const until = Date.now() + MINUTES * 60e3;
  let admitted = 0;
  while (Date.now() < until) {
    // People asking to join: Meet shows "Admit" (one) or "View all" then "Admit all" (several).
    if (await clickIf(/^admit( all)?$/i)) {
      admitted++;
      log(`admitted someone (${admitted})`);
      await clickIf(/^admit all$/i); // confirm dialog when admitting several
    } else if (await clickIf(/^view all$/i)) {
      await sleep(1000);
      if (await clickIf(/^admit all$/i)) log('admitted everyone waiting');
    }
    if (!(await inCall())) {
      log('the call ended or the recorder was removed');
      break;
    }
    await sleep(5000);
  }
  await finish(0);
} catch (err) {
  log('FAILED:', err instanceof Error ? err.message.split('\n')[0].replace(/https?:\/\/\S+/g, '<url>') : 'error');
  await finish(1);
}
