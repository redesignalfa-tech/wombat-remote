/**
 * Wombat Remote — web client.
 *
 * Joins a host by access code, receives the screen stream over WebRTC, and
 * sends mouse/keyboard events back over the data channel. Coordinates are sent
 * normalized (0..1) relative to the video element so the host can map them to
 * its own screen resolution.
 */

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

// Fetch ICE (STUN/TURN) config from the signaling server, falling back to STUN.
async function getIceServers() {
  try {
    const res = await fetch('/config');
    const data = await res.json();
    return data.iceServers || DEFAULT_ICE;
  } catch {
    return DEFAULT_ICE;
  }
}

const $ = (id) => document.getElementById(id);
const connectPanel = $('connect');
const sessionPanel = $('session');
const codeInput = $('code');
const joinBtn = $('join');
const errorEl = $('error');
const video = $('screen');
const statusEl = $('status');
const dotEl = $('dot');

let ws;
let pc;
let ctrlChannel; // reliable/ordered: clicks, keys, scroll, reset
let moveChannel; // unreliable/unordered: mouse moves
let inputAttached = false;
const pressedKeys = new Set();
let pendingMove = null;
let moveScheduled = false;

/* --- Access-code formatting (123 456 789) --------------------------------- */
codeInput.addEventListener('input', () => {
  const digits = codeInput.value.replace(/\D/g, '').slice(0, 9);
  codeInput.value = digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
});

joinBtn.addEventListener('click', join);
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

function setStatus(text, connected = false) {
  statusEl.textContent = text;
  dotEl.classList.toggle('on', connected);
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function join() {
  const code = codeInput.value.replace(/\D/g, '');
  if (code.length !== 9) {
    errorEl.textContent = 'Enter the full 9-digit code.';
    return;
  }
  errorEl.textContent = '';
  joinBtn.disabled = true;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => wsSend({ type: 'join', code });

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        showSession();
        await setupPeer();
        break;
      case 'error':
        joinBtn.disabled = false;
        errorEl.textContent =
          msg.reason === 'busy'
            ? 'That host already has a client connected.'
            : 'Invalid access code.';
        ws.close();
        break;
      case 'signal':
        await onSignal(msg.signal);
        break;
      case 'peer-left':
        setStatus('Host disconnected');
        break;
    }
  };

  ws.onerror = () => {
    joinBtn.disabled = false;
    errorEl.textContent = 'Could not reach the server.';
  };
}

function showSession() {
  connectPanel.classList.add('hidden');
  sessionPanel.classList.remove('hidden');
}

async function setupPeer() {
  pc = new RTCPeerConnection({ iceServers: await getIceServers() });

  pc.ontrack = (e) => {
    video.srcObject = e.streams[0];
  };

  // Host creates two channels; we receive them here.
  pc.ondatachannel = (e) => {
    const ch = e.channel;
    if (ch.label === 'move') {
      moveChannel = ch;
    } else {
      ctrlChannel = ch;
      ch.onopen = () => setStatus('Connected — you have control', true);
    }
    if (!inputAttached) {
      inputAttached = true;
      attachInput();
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'signal', signal: { cand: e.candidate } });
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      setStatus('Connection lost');
    }
  };
}

async function onSignal(signal) {
  if (!pc) return;
  if (signal.desc) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.desc));
    if (signal.desc.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend({ type: 'signal', signal: { desc: pc.localDescription } });
    }
  } else if (signal.cand) {
    try {
      await pc.addIceCandidate(signal.cand);
    } catch {
      /* ignore */
    }
  }
}

/* --- Input capture -------------------------------------------------------- */

function sendCtrl(ev) {
  if (ctrlChannel && ctrlChannel.readyState === 'open') {
    ctrlChannel.send(JSON.stringify(ev));
  }
}

function sendMove(ev) {
  const ch =
    moveChannel && moveChannel.readyState === 'open' ? moveChannel : ctrlChannel;
  if (ch && ch.readyState === 'open') ch.send(JSON.stringify(ev));
}

// Force-release every key/button on the host. Used when we lose focus or leave,
// so a missed keyup can't leave a modifier stuck down on the remote machine.
function releaseAll() {
  for (const code of pressedKeys) sendCtrl({ t: 'key', code, down: false });
  pressedKeys.clear();
  sendCtrl({ t: 'reset' });
}

// Normalize pointer position to 0..1 within the *visible* video content.
// The video uses object-fit: contain, so we account for letterboxing.
function normalize(e) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || rect.width;
  const vh = video.videoHeight || rect.height;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (rect.width - dispW) / 2;
  const offY = (rect.height - dispH) / 2;
  const x = (e.clientX - rect.left - offX) / dispW;
  const y = (e.clientY - rect.top - offY) / dispH;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function attachInput() {
  // Coalesce moves: keep only the newest position per animation frame so a
  // burst of mousemove events can't build a backlog and make the cursor lag.
  video.addEventListener('mousemove', (e) => {
    pendingMove = normalize(e);
    if (moveScheduled) return;
    moveScheduled = true;
    requestAnimationFrame(() => {
      moveScheduled = false;
      if (pendingMove) {
        sendMove({ t: 'move', ...pendingMove });
        pendingMove = null;
      }
    });
  });

  video.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sendCtrl({ t: 'down', button: e.button, ...normalize(e) });
  });

  window.addEventListener('mouseup', (e) => sendCtrl({ t: 'up', button: e.button }));

  video.addEventListener('contextmenu', (e) => e.preventDefault());

  video.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      sendCtrl({ t: 'scroll', dx: e.deltaX, dy: e.deltaY });
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (sessionPanel.classList.contains('hidden')) return;
    // Local-only escape hatch — never forwarded to the host.
    if (e.ctrlKey && e.altKey && e.code === 'KeyQ') {
      e.preventDefault();
      disconnect();
      return;
    }
    e.preventDefault();
    pressedKeys.add(e.code);
    sendCtrl({ t: 'key', code: e.code, down: true });
  });

  window.addEventListener('keyup', (e) => {
    if (sessionPanel.classList.contains('hidden')) return;
    e.preventDefault();
    pressedKeys.delete(e.code);
    sendCtrl({ t: 'key', code: e.code, down: false });
  });

  // Losing focus (e.g. an OS shortcut like Spotlight steals it) means keyups may
  // never arrive — release everything so nothing stays stuck on the host.
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}

/* --- Session controls ----------------------------------------------------- */
$('fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) sessionPanel.requestFullscreen();
  else document.exitFullscreen();
});

function disconnect() {
  releaseAll();
  if (pc) pc.close();
  if (ws) ws.close();
  location.reload();
}

$('disconnect').addEventListener('click', disconnect);
