# almaed-recorder

Joins an AlmaEd class on Google Meet as a guest ("AlmaEd class recording", admitted once by the
host) and streams it to the class's unlisted
YouTube broadcast, so teachers don't have to record anything. Runs on GitHub Actions; this repo is
public only so the minutes are free. Nothing private is in it: the Meet link, the stream URL and the
recorder's login cookies come from repository secrets and are never printed.

It joins as a guest because a Google login made on another computer is rejected on GitHub's
runners (`login.mjs` is kept for running it on a fixed machine instead).

Secrets: `TEST_MEET_URL`, `TEST_RTMP_URL` (optional, `rtmps://.../<key>`).
