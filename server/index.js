/**
 * Wombat Remote — signaling server.
 *
 * Responsibilities:
 *   1. Serve the web client (static files in ../client).
 *   2. Pair a HOST with a CLIENT using a short access code.
 *   3. Relay WebRTC signaling (SDP + ICE) between the paired peers.
 *
 * The server never sees screen frames or input — those travel peer-to-peer
 * over WebRTC once the connection is established.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));

/**
 * WebRTC ICE configuration, delivered to both peers at runtime.
 * STUN is always included; a TURN relay is added when env vars are set:
 *   TURN_URL         e.g. "turn:relay.example.com:3478" (comma-separate for many)
 *   TURN_USERNAME
 *   TURN_CREDENTIAL
 * Keeping TURN credentials here (not in client code) avoids committing secrets.
 */
app.get('/config', (_req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/**
 * rooms: code -> { host: ws, client: ws|null }
 * Each connected socket also carries `ws.code` and `ws.role` for cleanup.
 */
const rooms = new Map();

function makeCode() {
  // 9-digit access code, grouped like Chrome Remote Desktop (e.g. 123 456 789).
  let code;
  do {
    code = String(Math.floor(100000000 + Math.random() * 900000000));
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.code = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'register-host': {
        const code = makeCode();
        rooms.set(code, { host: ws, client: null });
        ws.role = 'host';
        ws.code = code;
        send(ws, { type: 'registered', code });
        break;
      }

      case 'join': {
        const room = rooms.get(msg.code);
        if (!room) {
          send(ws, { type: 'error', reason: 'invalid-code' });
          return;
        }
        if (room.client) {
          send(ws, { type: 'error', reason: 'busy' });
          return;
        }
        room.client = ws;
        ws.role = 'client';
        ws.code = msg.code;
        send(ws, { type: 'joined' });
        send(room.host, { type: 'peer-joined' });
        break;
      }

      case 'signal': {
        // Relay SDP/ICE to the other peer in the room.
        const room = rooms.get(ws.code);
        if (!room) return;
        const target = ws.role === 'host' ? room.client : room.host;
        send(target, { type: 'signal', signal: msg.signal });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.code);
    if (!room) return;

    if (ws.role === 'host') {
      // Host left: tear the room down and notify the client.
      send(room.client, { type: 'peer-left' });
      rooms.delete(ws.code);
    } else if (ws.role === 'client') {
      // Client left: keep the room alive so a new client can reconnect.
      room.client = null;
      send(room.host, { type: 'peer-left' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Wombat signaling server listening on http://localhost:${PORT}`);
  console.log(`Open the client in a browser at  http://localhost:${PORT}`);
});
