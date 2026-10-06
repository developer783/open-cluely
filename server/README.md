# Open-Cluely Team Server

A small server that holds your team's **Gemini** and **AssemblyAI** keys, so people using Open-Cluely can use them **without ever seeing them**.

- **AI answers:** the app sends Gemini requests here, and the server adds the key and forwards them to Google.
- **Transcription:** the app asks the server for a short-lived AssemblyAI token, valid for about 60 seconds, and connects with that. The real key never leaves the server.
- **Access:** every request needs a team **access code**, and anything without a valid code is rejected.
- **Limits:** only listed Gemini models are allowed, requests are rate-limited per access code, and request bodies are size-limited.

The server needs only Node.js 18 or newer and has no dependencies.

> Never put the real keys in git, the app, or this folder's committed files. They belong only in the server's environment variables, or in a local `server/.env`, which is git-ignored.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `GEMINI_API_KEYS` | yes | One or more Gemini keys, comma-separated. The server fails over between them. |
| `ASSEMBLYAI_API_KEY` | yes (for transcription) | AssemblyAI key used to create short-lived tokens. |
| `ACCESS_CODES` | yes | Access codes your team enters in the app, comma-separated. The server refuses to start without at least one. |
| `ALLOWED_MODELS` | no | Gemini models allowed through the server. Defaults to the Flash and Flash-Lite models listed in the app. |
| `RATE_LIMIT_PER_MINUTE` | no | Requests per minute per access code (default 30). |
| `MAX_BODY_MB` | no | Maximum request size; screenshots are sent as images (default 25). |
| `PORT` | no | Port to listen on (default 8787; hosting platforms set this). |

**Access codes:** use long random values, ideally one per person, so you can revoke one by removing it and restarting. To generate one:

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

## Run locally (for testing)

```bash
cd server
cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
# edit .env and fill in the keys and ACCESS_CODES
npm start
```

Check it at <http://localhost:8787/health>, which should return `{"ok":true,...}`.

## Deploy (Render, free tier)

1. Push this repo to GitHub (already done).
2. On <https://render.com>, go to **New → Blueprint** and select the repo. Render reads `render.yaml` from the repo root.
3. Enter `GEMINI_API_KEYS`, `ASSEMBLYAI_API_KEY` and `ACCESS_CODES` when prompted.
4. Once it's live, copy the URL (for example `https://open-cluely-team-server.onrender.com`).

Render's free tier sleeps after about 15 minutes without use, so the first request after a break can take up to a minute. Use a paid instance if that's a problem. The server also runs unchanged on any Node host, such as Railway, Fly.io or a VPS, with `node index.js`.

## Point the app at the server

Pick one:

- **For the whole team (recommended):** set `DEFAULT_TEAM_SERVER_URL` in `src/config.js` to the server URL and push. Everyone who pulls gets it pre-filled.
- **Per person:** paste the URL into **Settings → Team Server URL**.

Each person then enters their access code in **Settings → Team Access Code** and clicks **Save**. Anyone who enters their own API keys in Settings uses those instead of the team's.

## Security notes

- The URL is not secret and can live in the public repo. The **access codes are secret**, so share them privately.
- If an access code leaks, remove it from `ACCESS_CODES` and restart the server.
- If a key leaks, create a new one with Google or AssemblyAI and update the server's environment. The app needs no changes.
- For a public website download later, replace shared access codes with per-user sign-in on this server, so you can control and meter who uses your keys.
