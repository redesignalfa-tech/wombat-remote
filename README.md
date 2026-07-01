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

## Use over the internet

The signaling server must be reachable by both peers. Deploy `server/` to any
host (e.g. a small VM) and point the host app's *Signaling server* field at it
(`ws://your-server:8080` or `wss://…` behind TLS). Because peers are usually
behind NAT, add a **TURN** server to `ICE_SERVERS` in both
[`host/renderer.js`](host/renderer.js) and [`client/client.js`](client/client.js)
— STUN alone won't traverse symmetric NATs. [coturn](https://github.com/coturn/coturn)
is a common self-hosted option.

## Project layout

| Path                 | Role                                                        |
| -------------------- | ----------------------------------------------------------- |
| `server/index.js`    | Signaling + static hosting of the web client                |
| `host/main.js`       | Electron main — nut.js input injection, screen-source pick  |
| `host/renderer.js`   | Host WebRTC: capture screen, create offer, data channel     |
| `host/preload.js`    | Safe IPC bridge (`window.wombat.sendInput`)                 |
| `client/`            | Browser client: view screen, capture & send input           |

## Security notes

This is a learning/MVP project. Before any real use, consider:

- The access code is the only gate — add authentication and rate-limiting.
- Serve the client over **HTTPS/WSS** so credentials and signaling are encrypted.
- WebRTC media/data is DTLS-encrypted end-to-end by default.
- Anyone with the code gets full control of the host — treat it accordingly.

## License

MIT — see [LICENSE](LICENSE).
