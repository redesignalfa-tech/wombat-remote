/**
 * Wombat Remote — Electron host, renderer process.
 *
 * Connects to the signaling server, registers as a host to obtain an access
 * code, then (once a client joins) captures the screen and streams it over
 * WebRTC. Input events received on the data channel are forwarded to the main
 * process for OS-level injection.
 */

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

let serverUrl = '';

// Fetch ICE (STUN/TURN) config from the signaling server over http(s),
// derived from the ws(s) URL the host connected to. Falls back to STUN.
async function getIceServers() {
  try {
    const httpBase = serverUrl.replace(/^ws/, 'http').replace(/\/+$/, '');
    const res = await fetch(`${httpBase}/config`);
    const data = await res.json();
    return data.iceServers || DEFAULT_ICE;
  } catch {
    return DEFAULT_ICE;
  }
}

const $ = (id) => document.getElementById(id);
const serverInput = $('server');
const startBtn = $('start');
const stopBtn = $('stop');
const codeBox = $('code');
const codeValue = $('codeValue');
const statusEl = $('status');
const dotEl = $('dot');

let ws;
let pc;
let stream;
let manualStop = false;

function setStatus(text, connected = false) {
  statusEl.textContent = text;
  dotEl.classList.toggle('on', connected);
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

startBtn.addEventListener('click', () => {
  manualStop = false;
  startBtn.disabled = true;
  serverInput.disabled = true;
  stopBtn.style.display = 'block';
  connect(serverInput.value.trim());
});

stopBtn.addEventListener('click', stopSharing);

function connect(url) {
  serverUrl = url;
  setStatus('Connecting to server…');
  ws = new WebSocket(url);

  ws.onopen = () => {
    setStatus('Registering…');
    wsSend({ type: 'register-host' });
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'registered':
        showCode(msg.code);
        setStatus('Waiting for a client to connect…');
        break;

      case 'peer-joined':
        setStatus('Client joining — starting screen share…');
        await startSharing();
        break;

      case 'signal':
        await onSignal(msg.signal);
        break;

      case 'peer-left':
        setStatus('Client disconnected. Waiting again…');
        teardownPeer();
        break;
    }
  };

  ws.onclose = () => resetUI(manualStop ? 'Idle' : 'Disconnected from server');

  ws.onerror = () => setStatus('Server connection error');
}

function showCode(code) {
  codeValue.textContent = `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}`;
  codeBox.style.display = 'block';
}

async function startSharing() {
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
  });

  pc = new RTCPeerConnection({ iceServers: await getIceServers() });

  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  // The host owns the input data channel.
  const channel = pc.createDataChannel('input');
  channel.onmessage = (e) => {
    try {
      window.wombat.sendInput(JSON.parse(e.data));
    } catch {
      /* ignore malformed input */
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'signal', signal: { cand: e.candidate } });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') setStatus('Client connected', true);
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      setStatus('Connection lost. Waiting again…');
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  wsSend({ type: 'signal', signal: { desc: pc.localDescription } });
}

async function onSignal(signal) {
  if (!pc) return;
  if (signal.desc) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.desc));
  } else if (signal.cand) {
    try {
      await pc.addIceCandidate(signal.cand);
    } catch {
      /* candidate may arrive before remote description; ignore */
    }
  }
}

// Stop the active session (screen capture + peer), but stay registered so a
// new client can still connect with the same access code.
function teardownPeer() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// Full stop: end the session and disconnect from the signaling server.
function stopSharing() {
  manualStop = true;
  teardownPeer();
  if (ws) {
    ws.close();
    ws = null;
  }
  resetUI('Idle');
}

function resetUI(statusText) {
  codeBox.style.display = 'none';
  stopBtn.style.display = 'none';
  startBtn.disabled = false;
  serverInput.disabled = false;
  setStatus(statusText, false);
}
