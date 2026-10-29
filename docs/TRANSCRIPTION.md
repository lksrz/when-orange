# Transcription in the legacy Calls app

The standard Whisper client used to request the server's OpenAI API key from
`POST /api/transcription-token`. That endpoint is retired and returns HTTP 410
without a credential. The legacy `openai` provider cannot transcribe audio.

The Worker configuration sets `TRANSCRIPTION_ENABLED = "false"` by default.
The room loader passes this flag to the UI, which does not mount the
transcription service while it is disabled. This is a source-level safeguard
for a dormant Worker; it does not publish any Worker route or domain.

The existing realtime code path remains in the repository:
`POST /api/transcription-token/realtime` and
`POST /api/transcription-token?type=realtime` forward to the
`TranscriptionService` Durable Object for an ephemeral token. It is not
enabled by the default configuration. Re-enabling transcription requires a
separate decision about access control, costs, credentials and deployment.

The test page at `/api/transcription-test` is historical and should not be
used to validate a live standard Whisper path. Local backend tests cover the
410 response and the realtime route dispatch with a stub Durable Object;
they do not call OpenAI.
