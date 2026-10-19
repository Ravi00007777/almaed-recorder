# almaed-recorder

Joins an AlmaEd class on Google Meet as a guest ("AlmaEd class recording", admitted once by the
host) and streams it to the class's unlisted
YouTube broadcast, so teachers don't have to record anything. Runs on GitHub Actions; this repo is
public only so the minutes are free. Nothing private is in it: the Meet link, the stream URL and the
recorder's login cookies come from repository secrets and are never printed.

It joins as a guest because a Google login made on another computer is rejected on GitHub's
runners (`login.mjs` is kept for running it on a fixed machine instead).

Secrets: `TEST_MEET_URL`, `TEST_RTMP_URL` (optional, `rtmps://.../<key>`).

## On the AlmaEd Oracle server (fully automatic)

`agent.mjs` runs as a systemd user service. Every minute it asks the site (`/api/recorder/jobs`,
`RECORDER_SECRET`) for classes of batches set to "Record automatically", and runs `record.mjs` for
each: signed in as the recorder Gmail (the Meet links' owner, so it is the host), it joins a few
minutes early, admits everyone, streams the class to its unlisted YouTube broadcast and leaves once
the class is over and everyone has gone. Nothing is saved on the server.

1. `scp setup.sh` to the server, then `SITE_URL=https://alma-ed-1.vercel.app RECORDER_SECRET=... bash setup.sh`.
2. Sign the recorder Gmail in once: see the top of `login.sh`.
3. `systemctl --user start almaed-recorder`; logs: `journalctl --user -u almaed-recorder -f`.
