// The always-on recorder service on the AlmaEd Oracle server (systemd: almaed-recorder). Every
// minute it asks the site for classes about to start (/api/recorder/jobs), and runs record.mjs for
// each one on its own virtual screen and sound sink, with its own copy of the recorder Gmail's
// signed-in browser profile (two Chromes can't share one profile).
//
// Env (/etc/almaed-recorder.env): SITE_URL, RECORDER_SECRET, PROFILE_DIR (the signed-in profile
// login.sh made). Logs go to journald: job ids only, never Meet links or stream keys.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const SECRET = process.env.RECORDER_SECRET ?? '';
const PROFILE_DIR = process.env.PROFILE_DIR ?? '';
if (!SITE_URL || !SECRET || !PROFILE_DIR) throw new Error('SITE_URL, RECORDER_SECRET and PROFILE_DIR must be set.');

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const running = new Map(); // job id -> child process
let nextDisplay = 100;

async function poll() {
  const res = await fetch(`${SITE_URL}/api/recorder/jobs`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`jobs: HTTP ${res.status}`);
  const { jobs } = await res.json();
  for (const job of jobs) if (!running.has(job.id)) start(job);
}

function start(job) {
  const display = nextDisplay++;
  const sink = `rec_${display}`;
  // Its own sound sink, so two classes recorded at once never mix their audio.
  const module = execFileSync('pactl', ['load-module', 'module-null-sink', `sink_name=${sink}`]).toString().trim();
  // Its own copy of the signed-in profile (lock files left behind by the original are skipped).
  const profile = join(tmpdir(), `almaed-job-${job.id}`);
  cpSync(PROFILE_DIR, profile, { recursive: true, filter: (src) => !/Singleton(Lock|Socket|Cookie)$/.test(src) });

  // Stay until 15 minutes after the end at most (record.mjs leaves earlier once everyone has gone).
  const minutes = Math.ceil((new Date(job.endsAt).getTime() + 15 * 60e3 - Date.now()) / 60e3);
  const child = spawn(
    'xvfb-run',
    ['-n', String(display), '-s', '-screen 0 1280x720x24', 'node', 'record.mjs'],
    {
      cwd: new URL('.', import.meta.url).pathname,
      env: {
        ...process.env,
        MEET_URL: job.meetUrl,
        RTMP_URL: job.rtmpUrl,
        START_AT: job.startsAt,
        ENDS_AT: job.endsAt,
        MINUTES: String(Math.max(5, minutes)),
        PROFILE_DIR: profile,
        SINK: sink,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  running.set(job.id, child);
  log(`job ${job.id}: started on display ${display}`);
  child.on('exit', (code) => {
    running.delete(job.id);
    rmSync(profile, { recursive: true, force: true });
    try {
      execFileSync('pactl', ['unload-module', module]);
    } catch {}
    log(`job ${job.id}: finished (exit ${code})`);
  });
}

log('recorder agent started');
for (;;) {
  await poll().catch((err) => log('poll failed:', err.message));
  await new Promise((r) => setTimeout(r, 60_000));
}
