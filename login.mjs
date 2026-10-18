// One-time, on your own computer: opens a normal Chrome window (not an automated one, so Google
// lets you sign in), you sign in to the recorder Gmail, and its login cookies are saved to the
// file given as the first argument. That file goes into the RECORDER_STORAGE_STATE GitHub secret.
// Never commit it: anyone holding it is signed in as the recorder.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2];
if (!out) throw new Error('Usage: node login.mjs <output file>');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'almaed-recorder-'));
// ATTACH=1: use the sign-in window that is already open on that port.
const chrome = process.env.ATTACH
  ? null
  : spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', 'https://accounts.google.com/'], { stdio: 'ignore' });

// Saved by itself once Google's sign-in cookie appears and Meet has been opened (up to 15 minutes).
// Chrome takes a few seconds to start listening.
let browser;
for (let i = 0; !browser; i++) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch((err) => {
    if (i >= 30) throw err;
    return new Promise((r) => setTimeout(r, 1000));
  });
}
const context = browser.contexts()[0];
console.log('Sign in to the recorder Gmail in the Chrome window that just opened.');
const deadline = Date.now() + 15 * 60e3;
while (!(await context.cookies('https://accounts.google.com')).some((c) => c.name === 'SID')) {
  if (Date.now() > deadline) throw new Error('Not signed in after 15 minutes.');
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('Signed in. Opening Meet once so its cookies are saved too.');
const page = await context.newPage();
await page.goto('https://meet.google.com/', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 8000));
await context.storageState({ path: out });
await browser.close();
chrome?.kill();
console.log(`Saved the login to ${out}`);
