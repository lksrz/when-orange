# Archived — 2026-10-29

This repository is retired and the service is not in use. The code and data
are retained; the documentation below is historical. Do not restore public
routing or deploy the Worker again without a new decision to reactivate it.

# Welcome to Orange Meets

Orange Meets is a demo application built using [Cloudflare Calls](https://developers.cloudflare.com/calls/). To build your own WebRTC application using Cloudflare Calls, get started in the [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/calls).

Simpler examples can be found [here](https://github.com/cloudflare/calls-examples).

[Try the demo here!](https://demo.orange.cloudflare.dev)

![A screenshot showing a room in Orange Meets](orange-meets.png)

## Architecture Diagram

![Diagram of Orange Meets architecture](architecture.png)

## Variables

Go to the [Cloudflare Calls dashboard](https://dash.cloudflare.com/?to=/:account/calls) and create an application.

Put these variables into `.dev.vars`

```
CALLS_APP_ID=<APP_ID_GOES_HERE>
CALLS_APP_SECRET=<SECRET_GOES_HERE>
```

### Optional variables

The following variables are optional:

- `MAX_WEBCAM_BITRATE` (default `1200000`): the maximum bitrate for each meeting participant's webcam.
- `MAX_WEBCAM_FRAMERATE` (default: `24`): the maximum number of frames per second for each meeting participant's webcam.
- `MAX_WEBCAM_QUALITY_LEVEL` (default `1080`): the maximum resolution for each meeting participant's webcam, based on the smallest dimension (i.e. the default is 1080p).

To customise these variables, place replacement values in `.dev.vars` (for development) and in the `[vars]` section of `wrangler.toml` (for the deployment).

### Cost guards

- `COST_KILL_SWITCH` (secret, set by the central cost guard on budget breach): when `"1"`, the Worker returns `503 {"error":"temporarily disabled by cost guard"}` with `Retry-After: 3600` before touching any binding, the queue handler calls `batch.retryAll({ delaySeconds: 300 })` so queued feedback cards are redelivered later instead of being acknowledged (they are dropped only once the queue's max retries are exhausted while the switch stays on), and the `ChatRoom` / `TranscriptionService` Durable Objects reject fetches (503), close WebSocket senders' sockets (1013; for `TranscriptionService` also the upstream Deepgram socket on its next message), make `ChatRoom` RPC-callable methods (`createMeeting`, `endMeeting`, `setName`, ...) throw, skip `TranscriptionService` storage initialization, and `ChatRoom` deletes its alarm without rescheduling. Clear with `wrangler secret delete COST_KILL_SWITCH` (or set it to `0`).
- Runaway breaker (`app/utils/costGuard.server.ts`): each Durable Object instance counts its ops in memory per fixed 60s window. Limits per minute (each >=20x the legitimate peak): `ChatRoom` 2,000 fetches/connects, 50,000 WebSocket messages, 200,000 guarded method calls (RPC + internal), 80 alarms, max 80 alarm re-arms; `TranscriptionService` 100,000 fetches, 20,000 Deepgram messages. Above a limit fetches get 429, WebSocket senders (and the Deepgram socket) are closed with 1008, guarded `ChatRoom` methods (including the inherited `broadcast`) throw, while the fire-and-forget broadcast helpers (`broadcastMessage`, `broadcastRoomState`, `userLeftNotification`) silently skip, and alarm work is skipped, with `ChatRoom` falling back to a 5-minute recovery alarm (also used once the re-arm cap is hit) so periodic cleanup resumes; one `console.warn` per window.

## Development

The legacy standard transcription token endpoint (`POST /api/transcription-token`)
returns HTTP 410 and never exposes the server's OpenAI credential. The
realtime transcription path remains separate. Transcription is disabled in the
default Worker configuration (`TRANSCRIPTION_ENABLED = "false"`).

```sh
npm install
npm run dev
```

Open up [http://127.0.0.1:8787](http://127.0.0.1:8787) and you should be ready to go!

## Deployment

This legacy `whenmeet-call` Worker is dormant. `wrangler.toml` keeps
`routes = []`, `workers_dev = false`, and `preview_urls = false`, so a standard
deploy updates the existing Worker without restoring `call.whenmeet.me`.
Transcription is disabled by default. Reopening a public route requires a
separate deployment decision.

1. Make sure you've installed `wrangler` and are logged in by running:

```sh
wrangler login
```

2. Update `CALLS_APP_ID` in `wrangler.toml` to use your own Calls App ID

3. You will also need to set the token as a secret by running:

```sh
wrangler secret put CALLS_APP_SECRET
```

or to programmatically set the secret, run:

```sh
echo REPLACE_WITH_YOUR_SECRET | wrangler secret put CALLS_APP_SECRET
```

4. Optionally, you can also use [Cloudflare's TURN Service](https://developers.cloudflare.com/calls/turn/) by setting the `TURN_SERVICE_ID` variable in `wrangler.toml` and `TURN_SERVICE_TOKEN` secret using `wrangler secret put TURN_SERVICE_TOKEN`

5. Also optionally, you can include `OPENAI_MODEL_ENDPOINT` and `OPENAI_API_TOKEN` to use OpenAI's [Realtime API with WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc) to [invite AI](https://www.youtube.com/watch?v=AzMpyAbZfZQ) to join your meeting.

6. Finally you can run the following to deploy:

```sh
npm run deploy
```

# When Orange

A secure, end-to-end encrypted video conferencing application built with Remix, WebRTC, and MLS (Message Layer Security).

## Features

- **End-to-End Encryption**: Uses MLS protocol for secure communication
- **Screen Sharing**: Share your screen with encrypted transmission
- **WebRTC**: Real-time video and audio communication
- **Cloudflare Workers**: Serverless deployment on the edge
- **Party Tracks**: Advanced track management and routing

## Recent Fixes

### Screen Share E2EE Fix (2024)

Fixed MLS ratchet errors during screen sharing that were causing:

- "Frame decryption failed: Cannot create decryption secrets from own sender ratchet..."
- "This is the wrong ratchet type" errors
- "Ciphertext generation out of bounds" errors

**Solution**: Implemented proper video sender transform management to ensure only one video encryption stream is active at a time, preventing sequence number conflicts in the MLS ratchet system.

See [screenshare-e2ee-fix.md](./screenshare-e2ee-fix.md) for detailed technical information.

## Architecture

- **Frontend**: React with Remix framework
- **Backend**: Cloudflare Workers with Durable Objects
- **Encryption**: Rust/WASM implementation of MLS protocol
- **Media**: WebRTC with custom transforms for E2EE
- **Database**: Cloudflare D1 (SQLite)

## Development

```bash
# Install dependencies
npm install

# Build E2EE worker (requires wasm-pack)
npm run build:e2ee-worker

# Start development server
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck
```

## E2EE Implementation

The application uses a sophisticated E2EE system:

1. **MLS Protocol**: Provides forward secrecy and post-compromise security
2. **Rust Worker**: WASM-based encryption/decryption processing
3. **Transform Management**: Careful handling of WebRTC sender/receiver transforms
4. **Track Lifecycle**: Proper management of video track changes during screen sharing

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## Contributing

Please ensure all tests pass and TypeScript compiles without errors:

```bash
npm run check
```

## Cloudflare preview URLs

`wrangler.toml` and `wrangler.production.toml` set `preview_urls = false` for their respective Workers, so future deploys keep version and preview URLs disabled. Existing call routes and `workers.dev` settings are unchanged.
