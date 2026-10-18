// Joins a Google Meet as the recorder account, admits people who ask to join, and (when RTMP_URL
// is set) streams the call's screen and sound to YouTube with ffmpeg. Runs on a GitHub Actions
// runner under Xvfb (screen :99) and PulseAudio (sink "rec").
//
// The repo is public, so its logs are too: never print the Meet link, the stream URL or cookies.
// Env: MEET_URL, STORAGE_STATE (base64 of login.mjs's file), MINUTES (how long to stay, max 300),
// RTMP_URL (optional: rtmps://.../<stream key>).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const MEET_URL = process.env.MEET_URL ?? '';
const MINUTES = Math.min(300, Number(process.env.MINUTES || 5));
const RTMP_URL = process.env.RTMP_URL ?? '';
if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(MEET_URL)) throw new Error('MEET_URL is not a Google Meet link.');
if (!process.env.STORAGE_STATE) throw new Error('STORAGE_STATE is not set.');

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
  storageState: JSON.parse(Buffer.from(process.env.STORAGE_STATE, 'base64').toString()),
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
  await clickIf(/leave call/i);
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

  if (await page.getByText(/sign in|choose an account/i).first().isVisible().catch(() => false)) {
    log('FAILED: the recorder is not signed in (cookies expired or rejected). Run login.mjs again.');
    await finish(2);
  }
  if (await page.getByText(/you can't join this video call|not allowed to join/i).first().isVisible().catch(() => false)) {
    log('FAILED: Meet refused the recorder ("You can\'t join this video call").');
    await finish(3);
  }

  // Microphone and camera off before joining (Meet's own shortcuts as a fallback).
  if (!(await clickIf(/turn off microphone/i))) await page.keyboard.press('Control+d');
  if (!(await clickIf(/turn off camera/i))) await page.keyboard.press('Control+e');
  await sleep(1000);

  const joined = (await clickIf(/^join now$/i)) || (await clickIf(/^join$/i));
  const asked = !joined && (await clickIf(/ask to join/i));
  log(joined ? 'joining as host/invited' : asked ? 'asked to join, waiting to be admitted' : 'FAILED: no join button found');
  if (!joined && !asked) await finish(4);

  // In the call once the Leave button shows (up to 10 minutes if waiting to be admitted).
  const inCall = page.getByRole('button', { name: /leave call/i });
  await inCall.waitFor({ timeout: 10 * 60e3 }).catch(async () => {
    log('FAILED: never got into the call');
    await finish(5);
  });
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
    if (!(await inCall.isVisible().catch(() => false))) {
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
