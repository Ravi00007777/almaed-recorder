# almaed-recorder

Joins an AlmaEd class on Google Meet as the recorder Gmail and streams it to the class's unlisted
YouTube broadcast, so teachers don't have to record anything. Runs on GitHub Actions; this repo is
public only so the minutes are free. Nothing private is in it: the Meet link, the stream URL and the
recorder's login cookies come from repository secrets and are never printed.

Secrets: `RECORDER_STORAGE_STATE` (base64 of the file `node login.mjs <file>` saves),
`TEST_MEET_URL`, `TEST_RTMP_URL` (optional, `rtmps://.../<key>`).
