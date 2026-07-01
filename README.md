# Wombat Remote

A self-hosted **remote desktop** — screen streaming plus full mouse & keyboard
control — in the spirit of Chrome Remote Desktop, built on **Electron + WebRTC +
[nut.js](https://github.com/nut-tree/nut.js)**.

- **Host** (Electron app) shares its screen and injects incoming input into the OS.
- **Client** (any browser) enters a 9-digit access code, sees the remote screen,
  and drives the mouse & keyboard.
- **Signaling server** (Node) pairs the two peers and relays WebRTC negotiation.
  Screen frames and input travel **peer-to-peer** — they never pass through the server.

```
 ┌────────────┐   access code    ┌──────────────────┐   access code   ┌────────────┐
 │  Client    │ ───────────────► │ Signaling server │ ◄────────────── │   Host     │
 │ (browser)  │                  │   (Node + ws)    │                 │ (Electron) │
 └─────┬──────┘                  └──────────────────┘                 └─────┬──────┘
       │                                                                    │
       └──────────────── WebRTC: screen ▲ / input ▼ (peer-to-peer) ─────────┘
```

## Requirements

- Node.js 18+
- macOS, Windows, or Linux for the host
- On **macOS**, the host needs two permissions (System Settings → Privacy & Security):
  - **Screen Recording** — to capture the screen
  - **Accessibility** — for nut.js to inject mouse/keyboard events

## Install

```bash
npm install
```

`postinstall` runs `electron-rebuild` so nut.js's native module matches your
Electron ABI. If input injection ever fails after upgrading Electron, run it
again manually:

```bash
npm run rebuild
```

## Run (local test)

Open two terminals:

```bash
# 1. Signaling server + web client
npm run server        # → http://localhost:8080

# 2. Host app
npm run host
```

1. In the host window, click **Start sharing** — an access code appears.
2. Open **http://localhost:8080** in a browser, enter the code, click **Connect**.
3. You now see and control the host's screen.

## Install on Windows

The host runs on Windows too — nut.js ships Windows prebuilds, and Windows shows
no extra screen-capture/input permission prompts. Two options:

**A. Run from source (quickest):**

1. Install [Node.js](https://nodejs.org) (LTS) and [Git](https://git-scm.com/download/win).
2. In PowerShell:
   ```powershell
   git clone https://github.com/redesignalfa-tech/wombat-remote.git
   cd wombat-remote
   npm install
   npm run host
   ```
3. In the host window, set **Signaling server** to your server URL (e.g. your
   `wss://…` tunnel or deployment) and click **Start sharing**.
   To also run the signaling server on this machine: `npm run server`.

**B. Build a real installer (.exe):**

On the Windows machine (build on Windows so the native module matches):
```powershell
npm install
npm run dist:win
```
electron-builder writes an NSIS installer to `dist/`
(e.g. `Wombat Remote Setup 0.1.0.exe`) — double-click to install like any app.

## Use over the internet

Only the **signaling server + web client** go online; the Electron host stays on
your machine and connects out to that server. Deploy the included
[`Dockerfile`](Dockerfile) to any platform that supports **persistent WebSockets**
— **Railway**, **Render**, **Fly.io**, or a VM. (Vercel/Netlify **won't work**:
serverless functions can't hold a WebSocket open.)

**Deploy (Railway/Render, no CLI needed):**

1. Push this repo to GitHub (already done if you cloned from there).
2. Create a new project → **Deploy from GitHub repo** → pick this repo.
   Both Railway and Render auto-detect the `Dockerfile`.
3. After it builds, you get a public URL like `https://your-app.up.railway.app`.
4. In the Electron host, set **Signaling server** to
   `wss://your-app.up.railway.app` (note: `wss`, no port).
5. Open `https://your-app.up.railway.app` in a browser to use the client.

**TURN (for NAT traversal):** most home/mobile networks need a TURN relay — STUN
alone can't traverse symmetric NATs. ICE config is served from `GET /config` and
built from environment variables, so set these on your deployment (no code
changes, no secrets in git):

| Variable          | Example                                 |
| ----------------- | --------------------------------------- |
| `TURN_URL`        | `turn:relay.example.com:3478` (comma-separate multiple) |
| `TURN_USERNAME`   | `your-username`                         |
| `TURN_CREDENTIAL` | `your-credential`                       |

Get free/cheap TURN credentials from [Metered Open Relay](https://www.metered.ca/tools/openrelay/)
or self-host [coturn](https://github.com/coturn/coturn). Without TURN, connections
still work when at least one peer has a permissive NAT.

## Project layout

| Path                 | Role                                                        |
| -------------------- | ----------------------------------------------------------- |
| `server/index.js`    | Signaling + static hosting of the web client                |
| `host/main.js`       | Electron main — nut.js input injection, screen-source pick  |
| `host/renderer.js`   | Host WebRTC: capture screen, create offer, data channel     |
| `host/preload.js`    | Safe IPC bridge (`window.wombat.sendInput`)                 |
| `client/`            | Browser client: view screen, capture & send input           |
| `Dockerfile`         | Lean image for deploying the signaling server + client      |

## Security notes

This is a learning/MVP project. Before any real use, consider:

- The access code is the only gate — add authentication and rate-limiting.
- Serve the client over **HTTPS/WSS** so credentials and signaling are encrypted.
- WebRTC media/data is DTLS-encrypted end-to-end by default.
- Anyone with the code gets full control of the host — treat it accordingly.

## License

MIT — see [LICENSE](LICENSE).
