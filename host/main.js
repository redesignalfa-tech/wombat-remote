/**
 * Wombat Remote — Electron host, main process.
 *
 * The renderer handles WebRTC (screen capture + data channel). Input events
 * arrive in the renderer over the data channel and are forwarded here via IPC,
 * where nut.js injects them into the operating system.
 */

const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
} = require('electron');

const {
  mouse,
  keyboard,
  Button,
  Point,
  Key,
  screen: nutScreen,
} = require('@nut-tree-fork/nut-js');

// Make input injection as immediate as possible.
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 420,
    resizable: false,
    title: 'Wombat Remote — Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // Auto-answer getDisplayMedia() in the renderer with the primary screen,
  // so no OS picker dialog is shown.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0] }))
      .catch(() => callback({}));
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ---------------------------------------------------------------------------
 * Input injection
 * ------------------------------------------------------------------------- */

// nut.js works in physical screen pixels; the client sends normalized
// coordinates (0..1) relative to the shared video, so we scale here.
let screenW = 0;
let screenH = 0;

async function ensureScreenSize() {
  if (!screenW) {
    screenW = await nutScreen.width();
    screenH = await nutScreen.height();
  }
}

function clamp(v, max) {
  return Math.max(0, Math.min(max, Math.round(v)));
}

function toButton(n) {
  if (n === 1) return Button.MIDDLE;
  if (n === 2) return Button.RIGHT;
  return Button.LEFT;
}

// Maps a browser KeyboardEvent.code to a nut.js Key.
const KEY_MAP = buildKeyMap();

function buildKeyMap() {
  const map = {};
  // Letters: KeyA -> Key.A
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    map[`Key${ch}`] = Key[ch];
  }
  // Digits (top row): Digit1 -> Key.Num1
  for (let d = 0; d <= 9; d++) {
    map[`Digit${d}`] = Key[`Num${d}`];
  }
  // Numpad: Numpad1 -> Key.NumPad1
  for (let d = 0; d <= 9; d++) {
    map[`Numpad${d}`] = Key[`NumPad${d}`];
  }
  // Function keys
  for (let f = 1; f <= 12; f++) {
    map[`F${f}`] = Key[`F${f}`];
  }
  Object.assign(map, {
    Space: Key.Space,
    Enter: Key.Enter,
    NumpadEnter: Key.Enter,
    Tab: Key.Tab,
    Escape: Key.Escape,
    Backspace: Key.Backspace,
    Delete: Key.Delete,
    Insert: Key.Insert,
    Home: Key.Home,
    End: Key.End,
    PageUp: Key.PageUp,
    PageDown: Key.PageDown,
    ArrowLeft: Key.Left,
    ArrowRight: Key.Right,
    ArrowUp: Key.Up,
    ArrowDown: Key.Down,
    ShiftLeft: Key.LeftShift,
    ShiftRight: Key.RightShift,
    ControlLeft: Key.LeftControl,
    ControlRight: Key.RightControl,
    AltLeft: Key.LeftAlt,
    AltRight: Key.RightAlt,
    MetaLeft: Key.LeftSuper,
    MetaRight: Key.RightSuper,
    CapsLock: Key.CapsLock,
    Minus: Key.Minus,
    Equal: Key.Equal,
    BracketLeft: Key.LeftBracket,
    BracketRight: Key.RightBracket,
    Backslash: Key.Backslash,
    Semicolon: Key.Semicolon,
    Quote: Key.Quote,
    Backquote: Key.Grave,
    Comma: Key.Comma,
    Period: Key.Period,
    Slash: Key.Slash,
    NumpadAdd: Key.Add,
    NumpadSubtract: Key.Subtract,
    NumpadMultiply: Key.Multiply,
    NumpadDivide: Key.Divide,
    NumpadDecimal: Key.Decimal,
  });
  return map;
}

async function handleInput(ev) {
  try {
    await ensureScreenSize();
    switch (ev.t) {
      case 'move':
        await mouse.setPosition(
          new Point(clamp(ev.x * screenW, screenW), clamp(ev.y * screenH, screenH))
        );
        break;

      case 'down':
        await mouse.setPosition(
          new Point(clamp(ev.x * screenW, screenW), clamp(ev.y * screenH, screenH))
        );
        await mouse.pressButton(toButton(ev.button));
        break;

      case 'up':
        await mouse.releaseButton(toButton(ev.button));
        break;

      case 'scroll': {
        // Browser wheel deltas are large; scale to a sane scroll amount.
        const amount = Math.max(1, Math.round(Math.abs(ev.dy) / 40));
        if (ev.dy > 0) await mouse.scrollDown(amount);
        else if (ev.dy < 0) await mouse.scrollUp(amount);
        break;
      }

      case 'key': {
        const key = KEY_MAP[ev.code];
        if (key === undefined) break;
        if (ev.down) await keyboard.pressKey(key);
        else await keyboard.releaseKey(key);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // Injection failures (e.g. missing Accessibility permission) shouldn't crash.
    console.error('input error:', err.message);
  }
}

ipcMain.on('input', (_event, ev) => {
  handleInput(ev);
});
