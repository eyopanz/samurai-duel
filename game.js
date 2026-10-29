// ================= ELEMEN UI =================
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');

const gameModeSelect = document.getElementById('game-mode');
const gameThemeSelect = document.getElementById('game-theme');
const joinInputGroup = document.getElementById('join-input-group');
const hostInfoGroup = document.getElementById('host-info-group');
const roomIdInput = document.getElementById('room-id-input');
const myRoomCode = document.getElementById('my-room-code');
const statusBox = document.getElementById('status-box');
const statusVal = document.getElementById('status-val');
const menuScreen = document.getElementById('menu-screen');
const pauseScreen = document.getElementById('pause-screen');
const levelupScreen = document.getElementById('levelup-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const toastMsg = document.getElementById('toast-msg');

const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnSound = document.getElementById('btn-sound');

const hpP1 = document.getElementById('hp-p1');
const hpP2 = document.getElementById('hp-p2');
const levelVal = document.getElementById('level-val');
const timeVal = document.getElementById('time-val');
const scoreVal = document.getElementById('score-val');
const p2Label = document.getElementById('p2-label');
const p2Controls = document.getElementById('p2-controls');

function resizeCanvas() {
  if (forceLandscapeActive) {
    // Dunia game dirender dalam orientasi landscape (lebar = sisi panjang layar),
    // lalu #game-container diputar 90° lewat CSS supaya tampil miring di layar HP.
    canvas.width = window.innerHeight;
    canvas.height = window.innerWidth;
  } else {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
}

// ================= DETEKSI PERANGKAT SENTUH & PAKSA LANDSCAPE =================
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
let forceLandscapeActive = false;

function isPortraitViewport() {
  return window.innerHeight > window.innerWidth;
}

function updateOrientationMode() {
  if (!isTouchDevice) { resizeCanvas(); return; }
  forceLandscapeActive = isPortraitViewport();
  document.body.classList.toggle('force-landscape', forceLandscapeActive);
  resizeCanvas();
}

async function attemptLockLandscape() {
  if (!isTouchDevice) return;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {
    // Browser tidak mendukung (mis. iOS Safari) -> fallback CSS rotate tetap aktif
  }
}

if (isTouchDevice) document.body.classList.add('touch-device');
window.addEventListener('resize', updateOrientationMode);
window.addEventListener('orientationchange', updateOrientationMode);
updateOrientationMode();

// ================= STATE GAME =================
let isRunning = false;
let isPaused = false;
let currentMode = 'vs-ai';
let selectedTheme = 'senja';
let currentLevel = 1;
let timeRemaining = 60;
let score = 0;
let lowTimeWarned = false;
let lastTimestamp = null;
let totalRounds = 3;
let winsP1 = 0;
let winsP2 = 0;
let roundsToWin = 2;

// --- STATE JARINGAN (PeerJS Online P2P) ---
let peer = null;
let conn = null;
let isHost = false;
let networkRole = null; // null | 'host' | 'client'
let remoteInput = { up: false, down: false, left: false, right: false };
let clientView = null; // state terakhir yang diterima client dari host
let lastToastId = 0;
let toastIdCounter = 0;
let gamePhase = 'menu'; // menu | playing | paused | levelup | gameover
let lastGameoverInfo = null;
let screenShake = 0;


// ================= SUARA (Web Audio API, tanpa file eksternal) =================
let audioCtx = null;
let soundEnabled = true;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, duration, type = 'sine', startGain = 0.18, freqEnd = null) {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (freqEnd !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), audioCtx.currentTime + duration);
  }
  gain.gain.setValueAtTime(startGain, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function sfxSwing() { tone(500, 0.12, 'sawtooth', 0.15, 180); }
function sfxThrow() { tone(900, 0.08, 'triangle', 0.12, 1400); }
function sfxHit() { tone(140, 0.15, 'square', 0.22, 60); }
function sfxLevelUp() {
  if (!soundEnabled || !audioCtx) return;
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.15), i * 100));
}
function sfxVictory() {
  if (!soundEnabled || !audioCtx) return;
  [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.16), i * 120));
}
function sfxDefeat() {
  if (!soundEnabled || !audioCtx) return;
  [400, 300, 200, 120].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.18), i * 140));
}
function sfxTick() { tone(1000, 0.06, 'square', 0.08); }
function sfxUlt() {
  if (!soundEnabled || !audioCtx) return;
  [200, 400, 800, 1200].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sawtooth', 0.2, f * 0.5), i * 50));
}

let _ultReadyToast = false;
function updateUltBars() {
  const el1 = document.getElementById('ult-p1');
  const el2 = document.getElementById('ult-p2');
  if (el1) {
    el1.style.width = Math.max(0, Math.min(100, player1.ultCharge)) + '%';
    el1.style.boxShadow = player1.ultCharge >= ULT_COST ? '0 0 8px #facc15' : '';
  }
  if (el2) el2.style.width = Math.max(0, Math.min(100, player2.ultCharge)) + '%';
  if (player1.ultCharge >= ULT_COST && !_ultReadyToast && isRunning) {
    _ultReadyToast = true;
    showToast('✦ Ulti siap! Tekan E / tombol ✦');
  }
  if (player1.ultCharge < ULT_COST) _ultReadyToast = false;
}

btnSound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnSound.innerText = soundEnabled ? '🔊' : '🔇';
});

// ================= NOTIFIKASI TOAST =================
let toastTimer = null;
function displayToast(message) {
  toastMsg.innerText = message;
  toastMsg.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastMsg.classList.add('hidden'), 2600);
}
function showToast(message) {
  displayToast(message);
  toastIdCounter++;
}

// ================= LEVEL CONFIG (kesulitan meningkat) =================
function getLevelConfig(level) {
  return {
    timeLimit: Math.max(35, 70 - level * 2),
    enemyHp: 70 + level * 12,
    enemySpeed: 1.8 + level * 0.25,
    enemyDamage: 6 + level * 1.0,
    enemyMeleeCooldown: Math.max(40, 80 - level * 5),
    enemyThrowChance: Math.min(0.012 + level * 0.003, 0.04)
  };
}

// ================= OBJEK PEMAIN =================
function newPlayer(x, y, bodyColor, accentColor, opts) {
  opts = opts || {};
  return {
    x, y, size: opts.size || 34,
    hp: opts.hp || 100, maxHp: opts.hp || 100,
    speed: opts.speed || 3.6,
    facing: { x: 1, y: 0 },
    meleeCooldown: 0,
    throwCooldown: 0,
    attackTimer: 0,
    attackHasHit: false,
    attackLunge: 0,
    hitRecoil: 0,
    walkPhase: 0,
    _clashDone: false,
    ultCharge: 0,
    ultActive: false,
    ultTimer: 0,
    // Kunoichi / smoke vanish
    kind: opts.kind || 'samurai',
    vanishTimer: 0,      // >0 = sedang vanish (invulnerable + semi-invisible)
    vanishPhase: 0,      // 0 none, 1 pre-smoke, 2 hidden, 3 appear
    vanishCD: 0,
    aiState: 'approach',
    aiTimer: 0,
    orbitDir: 1,
    bodyColor, accentColor
  };
}

let player1 = newPlayer(140, 320, '#1e3a8a', '#38bdf8');
let player2 = newPlayer(560, 320, '#7f1d1d', '#f87171');

const MELEE_RANGE = 70;
const MELEE_ARC_FRAMES = 14;
const MELEE_DAMAGE = 11;
const MELEE_COOLDOWN_FRAMES = 26;
const THROW_COOLDOWN_FRAMES = 55;
const SHURIKEN_SPEED = 8.5;
const SHURIKEN_DAMAGE = 7;
const SHURIKEN_SIZE = 8;
const ULT_DAMAGE = 28;
const ULT_DURATION = 22;
const ULT_RANGE = 110;
const ULT_COST = 70;

const keys = {};
const shurikens = [];
const hitSparks = [];
const slashTrails = []; // jejak tebasan visual
const impactFX = [];   // percikan saat kena
const bloodDrops = []; // efek darah
const metalSparks = [];
const dmgNumbers = [];
let hurtFlashP1 = 0;
let hurtFlashP2 = 0;


const smokePuffs = []; // partikel asap untuk Smoke Vanish
let enemyType = 'kunoichi'; // 'samurai' | 'kunoichi' | 'ninja'
let playerChar = 'samurai';

const CHAR_PRESETS = {
  samurai:  { kind: 'samurai',  body: '#1e3a8a', accent: '#38bdf8', hp: 100, speed: 3.6, size: 36 },
  kunoichi: { kind: 'kunoichi', body: '#4c1d95', accent: '#c084fc', hp: 80,  speed: 4.8, size: 32 },
  ninja:    { kind: 'ninja',    body: '#0f172a', accent: '#dc2626', hp: 85,  speed: 4.3, size: 34 }
};



// ================= TEMA / MAP ARENA =================
const THEMES = {
  senja: {
    name: 'Dojo Senja',
    sky: ['#4c0519', '#9a3412', '#ea580c', '#1c0a05'],
    sun: 'rgba(253, 224, 71, 0.9)',
    sunPos: 0.78,
    mountain1: 'rgba(50, 18, 12, 0.8)',
    mountain2: 'rgba(30, 10, 8, 0.92)',
    ground: '#2c1810',
    particleColor: 'rgba(251, 207, 232, 0.9)',
    particleType: 'petal',
    torii: false
  },
  bambu: {
    name: 'Hutan Bambu',
    sky: ['#052e16', '#166534', '#22c55e', '#0a1f12'],
    sun: 'rgba(190, 242, 100, 0.55)',
    sunPos: 0.72,
    mountain1: 'rgba(8, 40, 20, 0.8)',
    mountain2: 'rgba(4, 25, 12, 0.92)',
    ground: '#1a2e1c',
    particleColor: 'rgba(187, 247, 208, 0.8)',
    particleType: 'leaf',
    torii: false
  },
  malam: {
    name: 'Kuil Malam',
    sky: ['#020617', '#0f172a', '#1e3a5f', '#020617'],
    sun: 'rgba(241, 245, 249, 0.95)',
    sunPos: 0.8,
    mountain1: 'rgba(15, 18, 35, 0.85)',
    mountain2: 'rgba(8, 10, 22, 0.95)',
    ground: '#12121f',
    particleColor: 'rgba(186, 230, 253, 0.65)',
    particleType: 'petal',
    torii: true
  },
  salju: {
    name: 'Gunung Salju',
    sky: ['#0c1929', '#1e3a5f', '#60a5fa', '#0f172a'],
    sun: 'rgba(255, 255, 255, 0.85)',
    sunPos: 0.7,
    mountain1: 'rgba(226, 232, 240, 0.55)',
    mountain2: 'rgba(203, 213, 225, 0.8)',
    ground: '#334155',
    particleColor: 'rgba(255, 255, 255, 0.95)',
    particleType: 'snow',
    torii: false
  }
};

const petals = [];
function initPetals() {
  petals.length = 0;
  for (let i = 0; i < 45; i++) {
    petals.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: 3 + Math.random() * 4,
      speed: 0.6 + Math.random() * 1.2,
      sway: 0.5 + Math.random() * 1.5,
      swayOffset: Math.random() * Math.PI * 2
    });
  }
}
initPetals();
window.addEventListener('resize', initPetals);

function drawBackground(time) {
  const theme = THEMES[selectedTheme] || THEMES.senja;
  const w = canvas.width, h = canvas.height;
  const groundY = h * 0.62;

  // Langit gradient
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, theme.sky[0]);
  sky.addColorStop(0.4, theme.sky[1]);
  sky.addColorStop(0.65, theme.sky[2]);
  sky.addColorStop(1, theme.sky[3]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Glow matahari / bulan
  const sx = w * theme.sunPos, sy = h * 0.26;
  const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 120);
  glow.addColorStop(0, theme.sun);
  glow.addColorStop(0.4, theme.sun.replace(/[\d.]+(?=\))/, '0.25'));
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(sx - 120, sy - 120, 240, 240);
  ctx.fillStyle = theme.sun;
  ctx.beginPath();
  ctx.arc(sx, sy, 48, 0, Math.PI * 2);
  ctx.fill();

  // Bintang (tema malam)
  if (selectedTheme === 'malam') {
    for (let i = 0; i < 40; i++) {
      const bx = ((i * 97) % w);
      const by = ((i * 53) % (groundY * 0.7));
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * 0.002 + i));
      ctx.fillStyle = `rgba(226,232,240,${tw})`;
      ctx.beginPath();
      ctx.arc(bx, by, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Gunung jauh
  ctx.fillStyle = theme.mountain1;
  drawMountainRange(h * 0.52, 100, 0.15);
  ctx.fillStyle = theme.mountain2;
  drawMountainRange(h * 0.58, 70, 0.28);

  // Dekorasi tema di belakang arena
  drawThemeDecor(theme, w, h, groundY, time);

  // Tanah arena dengan pola
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  // Garis kayu / batu
  ctx.strokeStyle = selectedTheme === 'salju' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.5;
  for (let gx = -40; gx < w + 40; gx += 50) {
    ctx.beginPath(); ctx.moveTo(gx, groundY); ctx.lineTo(gx - 20, h); ctx.stroke();
  }
  for (let gy = groundY; gy < h; gy += 28) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
  // Garis tengah arena
  ctx.strokeStyle = 'rgba(250,204,21,0.15)';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(w * 0.5, groundY + 8);
  ctx.lineTo(w * 0.5, h - 10);
  ctx.stroke();
  ctx.setLineDash([]);

  // Partikel
  petals.forEach(p => {
    p.y += p.speed * (theme.particleType === 'snow' ? 0.75 : 1);
    p.x += Math.sin(time * 0.001 * p.sway + p.swayOffset) * (theme.particleType === 'snow' ? 0.35 : 0.55);
    if (p.y > h) { p.y = -10; p.x = Math.random() * w; }
    if (p.x < -20) p.x = w + 10;
    if (p.x > w + 20) p.x = -10;
    ctx.fillStyle = theme.particleColor;
    if (theme.particleType === 'snow') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.55, Math.PI / 5 + p.swayOffset, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawThemeDecor(theme, w, h, groundY, time) {
  if (selectedTheme === 'bambu') {
    // Batang bambu kiri & kanan
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 7; i++) {
        const bx = side === 0 ? 18 + i * 16 : w - 30 - i * 16;
        const bh = 90 + (i % 3) * 35 + Math.sin(i + time * 0.001) * 4;
        ctx.fillStyle = 'rgba(21, 90, 40, 0.75)';
        ctx.fillRect(bx, groundY - bh, 7, bh);
        ctx.strokeStyle = 'rgba(134, 239, 172, 0.35)';
        ctx.lineWidth = 1;
        for (let s = 12; s < bh; s += 18) {
          ctx.beginPath();
          ctx.moveTo(bx, groundY - s);
          ctx.lineTo(bx + 7, groundY - s);
          ctx.stroke();
        }
        // Daun
        ctx.fillStyle = 'rgba(74, 222, 128, 0.45)';
        ctx.beginPath();
        ctx.ellipse(bx + 4, groundY - bh + 8, 14, 5, side === 0 ? -0.5 : 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (selectedTheme === 'malam') {
    // Torii lebih detail
    const tx = w * 0.5, ty = groundY - 20;
    ctx.fillStyle = 'rgba(153, 27, 27, 0.7)';
    ctx.fillRect(tx - 95, ty - 100, 16, 100);
    ctx.fillRect(tx + 79, ty - 100, 16, 100);
    // Atap atas
    ctx.beginPath();
    ctx.moveTo(tx - 120, ty - 105);
    ctx.lineTo(tx, ty - 125);
    ctx.lineTo(tx + 120, ty - 105);
    ctx.lineTo(tx + 110, ty - 92);
    ctx.lineTo(tx - 110, ty - 92);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(tx - 100, ty - 88, 200, 12);
    // Lentera
    [[tx - 70, ty - 50], [tx + 70, ty - 50]].forEach(([lx, ly]) => {
      ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.fillRect(lx - 8, ly, 16, 22);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
      ctx.beginPath();
      ctx.arc(lx, ly + 11, 28, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (selectedTheme === 'senja') {
    // Pagoda siluet
    const px = w * 0.72;
    ctx.fillStyle = 'rgba(40, 15, 10, 0.65)';
    ctx.fillRect(px, groundY - 70, 50, 70);
    ctx.beginPath();
    ctx.moveTo(px - 15, groundY - 70);
    ctx.lineTo(px + 25, groundY - 95);
    ctx.lineTo(px + 65, groundY - 70);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(px + 8, groundY - 115, 34, 25);
    ctx.beginPath();
    ctx.moveTo(px - 5, groundY - 115);
    ctx.lineTo(px + 25, groundY - 135);
    ctx.lineTo(px + 55, groundY - 115);
    ctx.closePath();
    ctx.fill();
    // Lantern tiang kiri
    ctx.fillStyle = 'rgba(60, 20, 10, 0.6)';
    ctx.fillRect(w * 0.12, groundY - 55, 6, 55);
    ctx.fillStyle = 'rgba(251, 146, 60, 0.8)';
    ctx.beginPath();
    ctx.arc(w * 0.12 + 3, groundY - 60, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (selectedTheme === 'salju') {
    // Pohon pinus
    [[0.1, 95], [0.22, 70], [0.85, 90], [0.75, 65]].forEach(([fx, fh]) => {
      const px = w * fx;
      ctx.fillStyle = 'rgba(30, 50, 40, 0.7)';
      ctx.fillRect(px - 4, groundY - 20, 8, 20);
      ctx.fillStyle = 'rgba(20, 60, 45, 0.75)';
      for (let t = 0; t < 3; t++) {
        const top = groundY - 20 - fh + t * 22;
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px - 22 + t * 4, top + 30);
        ctx.lineTo(px + 22 - t * 4, top + 30);
        ctx.closePath();
        ctx.fill();
      }
      // Salju di puncak
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(px, groundY - 20 - fh);
      ctx.lineTo(px - 10, groundY - 20 - fh + 14);
      ctx.lineTo(px + 10, groundY - 20 - fh + 14);
      ctx.closePath();
      ctx.fill();
    });
  }
}

function drawMountainRange(baseY, height, seedOffset) {
  const w = canvas.width;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  const step = 80;
  for (let x = 0; x <= w + step; x += step) {
    const y = baseY - height * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.01 + seedOffset * 10)));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, baseY + height);
  ctx.lineTo(0, baseY + height);
  ctx.closePath();
  ctx.fill();
}

// ================= GAMBAR KARAKTER (humanoid, bukan bulat) =================
function drawSamurai(p) {
  if (typeof isVanished === "function" && isVanished(p)) return;
  const kind = p.kind || "samurai";
  const angle = Math.atan2(p.facing.y, p.facing.x);
  const cx = p.x + p.size / 2;
  const cy = p.y + p.size / 2;
  const S = p.size;
  ctx.save();
  ctx.translate(cx, cy);
  if (p.vanishTimer > 0 && p.vanishPhase !== 2) {
    const fade = p.vanishPhase === 1 ? Math.max(0.15, p.vanishTimer / 36) : Math.max(0.15, 1 - p.vanishTimer / 12);
    ctx.globalAlpha = fade;
  }
  if (p.ultActive) {
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.95 + Math.sin(Date.now() / 80) * 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(250, 204, 21, 0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, S * 0.52, S * 0.38, S * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flash merah di tubuh saat kena damage
  const hf = (p === player1) ? hurtFlashP1 : hurtFlashP2;
  if (hf > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(220, 38, 38, " + (0.35 * hf) + ")";
    ctx.fill();
  }

  ctx.rotate(angle);

  // Condong badan + step saat menyerang
  if (p.attackTimer > 0) {
    const arcFrames = p.ultActive ? ULT_DURATION : MELEE_ARC_FRAMES;
    const progress = 1 - (p.attackTimer / arcFrames);
    const lean = Math.sin(progress * Math.PI) * 0.2;
    ctx.rotate(lean);
    ctx.translate(Math.sin(progress * Math.PI) * 5, 0);
  }

  const skin = "#e8b896";
  const skinShadow = "#c4896a";
  const body = p.bodyColor;
  const accent = p.accentColor;
  const breath = Math.sin(Date.now() / 350) * 0.8;
  const recoil = (p.hitRecoil || 0) * -4;
  ctx.translate(recoil, breath * 0.3);
  const wp = p.walkPhase || 0;
  const legSwing = Math.sin(wp) * S * 0.08;
  ctx.strokeStyle = body;
  ctx.lineWidth = S * 0.14;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-S * 0.08, S * 0.12); ctx.lineTo(-S * 0.18 - legSwing, S * 0.42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S * 0.06, S * 0.12); ctx.lineTo(S * 0.14 + legSwing, S * 0.42); ctx.stroke();
  ctx.fillStyle = kind === "ninja" ? "#0f172a" : "#1c1917";
  ctx.beginPath(); ctx.ellipse(-S * 0.18 - legSwing, S * 0.44, S * 0.1, S * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(S * 0.14 + legSwing, S * 0.44, S * 0.1, S * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  if (kind === "kunoichi") {
    ctx.moveTo(-S * 0.22, -S * 0.28); ctx.lineTo(S * 0.22, -S * 0.28); ctx.lineTo(S * 0.18, S * 0.18); ctx.lineTo(-S * 0.18, S * 0.18);
  } else if (kind === "ninja") {
    ctx.moveTo(-S * 0.24, -S * 0.28); ctx.lineTo(S * 0.24, -S * 0.28); ctx.lineTo(S * 0.2, S * 0.2); ctx.lineTo(-S * 0.2, S * 0.2);
  } else {
    ctx.moveTo(-S * 0.28, -S * 0.28); ctx.lineTo(S * 0.28, -S * 0.28); ctx.lineTo(S * 0.22, S * 0.2); ctx.lineTo(-S * 0.22, S * 0.2);
  }
  ctx.closePath(); ctx.fill();

  if (kind === "samurai") {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(-S * 0.3, -S * 0.3); ctx.lineTo(-S * 0.08, -S * 0.18); ctx.lineTo(-S * 0.22, -S * 0.12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(S * 0.3, -S * 0.3); ctx.lineTo(S * 0.08, -S * 0.18); ctx.lineTo(S * 0.22, -S * 0.12); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = accent; ctx.fillRect(-S * 0.2, S * 0.02, S * 0.4, S * 0.08);
  ctx.fillStyle = "#fef3c7"; ctx.fillRect(-S * 0.04, S * 0.03, S * 0.08, S * 0.06);
  ctx.strokeStyle = body; ctx.lineWidth = S * 0.12;
  ctx.beginPath(); ctx.moveTo(-S * 0.18, -S * 0.18); ctx.lineTo(-S * 0.38, S * 0.05); ctx.stroke();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(-S * 0.4, S * 0.08, S * 0.07, 0, Math.PI * 2); ctx.fill();
  let armAngle = 0.15;
  if (p.attackTimer > 0) {
    const arcFrames = p.ultActive ? ULT_DURATION : MELEE_ARC_FRAMES;
    const progress = 1 - (p.attackTimer / arcFrames);
    armAngle = p.ultActive ? -Math.PI + progress * Math.PI * 2 : -0.9 + progress * 1.8;
  }
  ctx.save();
  ctx.translate(S * 0.16, -S * 0.16);
  ctx.rotate(armAngle);
  ctx.strokeStyle = body; ctx.lineWidth = S * 0.12;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(S * 0.28, 0); ctx.stroke();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(S * 0.3, 0, S * 0.07, 0, Math.PI * 2); ctx.fill();
  const isNinja = kind === "ninja" || kind === "kunoichi";
  const bladeLen = p.ultActive ? S * 0.95 : (isNinja ? S * 0.55 : S * 0.75);
  if (p.attackTimer > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(S * 0.28, 0); ctx.lineTo(S * 0.28 + bladeLen, 0); ctx.stroke();
  }
  ctx.strokeStyle = p.ultActive ? "#facc15" : "#e5e7eb";
  ctx.lineWidth = p.ultActive ? 4 : 2.8;
  ctx.beginPath(); ctx.moveTo(S * 0.28, 0); ctx.lineTo(S * 0.28 + bladeLen, 0); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(S * 0.32, -1.2); ctx.lineTo(S * 0.28 + bladeLen * 0.85, -1.2); ctx.stroke();
  if (p.ultActive) {
    ctx.strokeStyle = "rgba(250,204,21,0.35)"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(S * 0.28, 0); ctx.lineTo(S * 0.28 + bladeLen, 0); ctx.stroke();
  }
  if (p.attackTimer > 0) {
    const arcFrames = p.ultActive ? ULT_DURATION : MELEE_ARC_FRAMES;
    const pr = 1 - (p.attackTimer / arcFrames);
    if (pr > 0.3 && pr < 0.7) {
      ctx.beginPath();
      ctx.arc(S * 0.28 + bladeLen, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    }
  }
  ctx.strokeStyle = kind === "ninja" ? "#111827" : "#78350f"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(S * 0.22, 0); ctx.lineTo(S * 0.32, 0); ctx.stroke();
  if (kind === "samurai") { ctx.fillStyle = "#a8a29e"; ctx.fillRect(S * 0.3, -S * 0.06, S * 0.04, S * 0.12); }
  ctx.restore();
  ctx.fillStyle = skin; ctx.fillRect(S * 0.02, -S * 0.36, S * 0.1, S * 0.1);
  ctx.beginPath(); ctx.arc(S * 0.12, -S * 0.42, S * 0.2, 0, Math.PI * 2); ctx.fill();
  const prevA = ctx.globalAlpha;
  ctx.fillStyle = skinShadow; ctx.globalAlpha = prevA * 0.35;
  ctx.beginPath(); ctx.ellipse(S * 0.18, -S * 0.38, S * 0.08, S * 0.1, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = prevA;

  if (kind === "kunoichi") {
    ctx.fillStyle = "#1c1917";
    ctx.beginPath(); ctx.ellipse(S * 0.05, -S * 0.48, S * 0.2, S * 0.16, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-S * 0.05, -S * 0.4); ctx.quadraticCurveTo(-S * 0.25, -S * 0.1, -S * 0.15, S * 0.15); ctx.quadraticCurveTo(-S * 0.05, -S * 0.05, S * 0.05, -S * 0.35); ctx.fill();
    ctx.fillStyle = "#312e81"; ctx.fillRect(S * 0.02, -S * 0.44, S * 0.22, S * 0.12);
    ctx.fillStyle = "#fef3c7"; ctx.beginPath(); ctx.arc(S * 0.18, -S * 0.4, S * 0.035, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent; ctx.globalAlpha = prevA * 0.9;
    ctx.beginPath(); ctx.moveTo(-S * 0.1, -S * 0.2); ctx.quadraticCurveTo(-S * 0.35, S * 0.05, -S * 0.2, S * 0.25); ctx.quadraticCurveTo(-S * 0.05, S * 0.1, S * 0.05, -S * 0.15); ctx.fill();
    ctx.globalAlpha = prevA;
  } else if (kind === "ninja") {
    ctx.fillStyle = "#0f172a";
    ctx.beginPath(); ctx.arc(S * 0.12, -S * 0.42, S * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-S * 0.05, -S * 0.5); ctx.lineTo(-S * 0.28, -S * 0.35); ctx.lineTo(S * 0.05, -S * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(S * 0.08, -S * 0.46, S * 0.16, S * 0.05);
    ctx.fillStyle = "#0ea5e9"; ctx.fillRect(S * 0.1, -S * 0.45, S * 0.05, S * 0.03); ctx.fillRect(S * 0.18, -S * 0.45, S * 0.05, S * 0.03);
  } else {
    ctx.fillStyle = "#1c1917";
    ctx.beginPath(); ctx.ellipse(S * 0.1, -S * 0.52, S * 0.18, S * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(S * 0.08, -S * 0.62, S * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(0, -S * 0.5, S * 0.24, S * 0.06);
    ctx.fillStyle = "#1c1917"; ctx.beginPath(); ctx.ellipse(S * 0.18, -S * 0.42, S * 0.04, S * 0.03, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#9a6b4f"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(S * 0.2, -S * 0.34); ctx.lineTo(S * 0.28, -S * 0.34); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}


function drawShuriken(s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((Date.now() % 360) * Math.PI / 180 * 4);
  ctx.fillStyle = '#d1d5db';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * SHURIKEN_SIZE, Math.sin(a) * SHURIKEN_SIZE);
    ctx.lineTo(Math.cos(a + 0.3) * SHURIKEN_SIZE * 0.35, Math.sin(a + 0.3) * SHURIKEN_SIZE * 0.35);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ================= LOGIKA MENU & MODE =================
function updateModeUI() {
  currentMode = gameModeSelect.value;
  joinInputGroup.classList.add('hidden');
  hostInfoGroup.classList.add('hidden');

  if (currentMode === '2-player') {
    p2Label.innerText = '⚔ PLAYER 2';
    p2Controls.innerHTML = '<b>Player 2:</b> Panah Gerak • Enter Tebas • Shift Lempar Shuriken';
    btnPause.style.display = '';
  } else if (currentMode === 'online-host') {
    p2Label.innerText = '⚔ LAWAN (ONLINE)';
    p2Controls.innerHTML = '<b>Kamu:</b> WASD Gerak • Spasi Tebas • F Lempar Shuriken';
    hostInfoGroup.classList.remove('hidden');
    btnPause.style.display = '';
    initHostPeer();
  } else if (currentMode === 'online-join') {
    p2Label.innerText = '⚔ HOST (ONLINE)';
    p2Controls.innerHTML = '<b>Kamu:</b> WASD Gerak • Spasi Tebas • F Lempar Shuriken';
    joinInputGroup.classList.remove('hidden');
    btnPause.style.display = 'none';
  } else {
    const et = (document.getElementById('enemy-type') || {}).value || 'kunoichi';
    if (et === 'kunoichi') {
      p2Label.innerText = '🥷 KUNOICHI (AI)';
      p2Controls.innerHTML = '<b>Kunoichi:</b> Cepat, shuriken kipas, Smoke Vanish';
    } else if (et === 'ninja') {
      p2Label.innerText = '🌑 NINJA (AI)';
      p2Controls.innerHTML = '<b>Ninja:</b> Hood hitam, kunai, agresif';
    } else {
      p2Label.innerText = '⚔ SAMURAI (AI)';
      p2Controls.innerHTML = '<b>Samurai:</b> Dikendalikan Komputer (AI)';
    }
    btnPause.style.display = '';
  }
}
gameModeSelect.addEventListener('change', updateModeUI);
updateModeUI();

gameThemeSelect.addEventListener('change', () => { selectedTheme = gameThemeSelect.value; });
selectedTheme = gameThemeSelect.value;

const enemyTypeSelect = document.getElementById('enemy-type');
if (enemyTypeSelect) {
  enemyTypeSelect.addEventListener('change', () => {
    enemyType = enemyTypeSelect.value;
    updateModeUI();
  });
  enemyType = enemyTypeSelect.value;
}

// ================= JARINGAN ONLINE (PeerJS P2P) =================
// TURN server ditambahkan supaya koneksi tetap tembus walau salah satu
// pemain ada di belakang NAT ketat (jaringan seluler/4G, WiFi kantor/kampus, dsb).
// Tanpa TURN, koneksi P2P sering gagal diam-diam ("Menghubungkan..." macet)
// meskipun kode room-nya sudah benar.
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

let connectTimeoutId = null;

function normalizeRoomCode(code) {
  return code.trim().toUpperCase();
}

function clearConnectTimeout() {
  if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
}

function initHostPeer() {
  const randomCode = normalizeRoomCode('ROOM-' + Math.floor(1000 + Math.random() * 9000));
  myRoomCode.value = 'Membuat room...';

  if (typeof Peer === 'undefined') {
    myRoomCode.value = randomCode;
    showToast('Gagal memuat library online, cek koneksi internet.');
    return;
  }
  if (peer) peer.destroy();

  try {
    peer = new Peer(randomCode, { config: ICE_CONFIG, debug: 1 });
    peer.on('open', (id) => {
      myRoomCode.value = id;
      showToast('Room siap! Bagikan kode ke lawan, duel otomatis mulai saat lawan bergabung.');
    });
    peer.on('connection', (connection) => {
      conn = connection;
      isHost = true;
      networkRole = 'host';
      setupConnection();
      // Begitu lawan bergabung, duel otomatis dimulai (host tidak perlu klik "Mulai Duel" lagi)
      if (!isRunning) startLocalMatch();
    });
    peer.on('error', (err) => {
      console.warn('PeerJS Error:', err);
      if (err && err.type === 'unavailable-id') {
        showToast('Kode room bentrok, membuat kode baru...');
        setTimeout(initHostPeer, 300);
        return;
      }
      myRoomCode.value = randomCode;
      showToast('Gagal konek ke server online. Cek internet kamu.');
    });
    peer.on('disconnected', () => {
      showToast('Koneksi ke server sinyal terputus, mencoba lagi...');
      if (peer && !peer.destroyed) peer.reconnect();
    });
  } catch (e) {
    myRoomCode.value = randomCode;
  }
}

function connectToHost(hostId) {
  if (typeof Peer === 'undefined') {
    showToast('Library online belum siap, coba lagi.');
    return;
  }
  const targetId = normalizeRoomCode(hostId);
  peer = new Peer({ config: ICE_CONFIG, debug: 1 });

  peer.on('open', () => {
    conn = peer.connect(targetId, { reliable: true });

    clearConnectTimeout();
    connectTimeoutId = setTimeout(() => {
      if (!conn || !conn.open) {
        showToast('Gagal terhubung: room tidak ditemukan / host offline / jaringan memblokir koneksi.');
        menuScreen.classList.remove('hidden');
      }
    }, 15000);

    conn.on('error', (err) => {
      console.warn('Connection error:', err);
      clearConnectTimeout();
      showToast('Koneksi ke room gagal. Pastikan kode benar & host masih membuka room.');
      menuScreen.classList.remove('hidden');
    });

    isHost = false;
    networkRole = 'client';
    setupConnection();
  });

  peer.on('error', (err) => {
    console.warn('PeerJS Error (client):', err);
    clearConnectTimeout();
    if (err && err.type === 'peer-unavailable') {
      showToast('Kode room tidak ditemukan. Cek lagi kode dari host.');
    } else {
      showToast('Gagal terhubung ke server online. Cek koneksi internet kamu.');
    }
    menuScreen.classList.remove('hidden');
  });
}

function setupConnection() {
  statusBox.style.display = 'flex';
  conn.on('open', () => {
    clearConnectTimeout();
    statusVal.innerText = 'Terhubung';
    showToast('Koneksi online berhasil! Duel dimulai.');
  });

  conn.on('data', (data) => {
    if (networkRole === 'host') {
      if (data.type === 'input') {
        remoteInput = data.state;
      } else if (data.type === 'action') {
        if (data.action === 'melee') triggerMelee('p2');
        if (data.action === 'throw') triggerThrow('p2');
        if (data.action === 'ult') triggerUlt('p2');
      }
    } else if (networkRole === 'client') {
      if (data.type === 'state') clientView = data;
    }
  });

  conn.on('close', () => {
    clearConnectTimeout();
    statusVal.innerText = 'Terputus';
    showToast('Koneksi lawan terputus.');
  });
}

function broadcastState() {
  if (!conn || !conn.open) return;
  conn.send({
    type: 'state',
    phase: gamePhase,
    p1: { x: player1.x, y: player1.y, facing: player1.facing, hp: player1.hp, maxHp: player1.maxHp, attackTimer: player1.attackTimer, ultCharge: player1.ultCharge, ultActive: player1.ultActive },
    p2: { x: player2.x, y: player2.y, facing: player2.facing, hp: player2.hp, maxHp: player2.maxHp, attackTimer: player2.attackTimer, ultCharge: player2.ultCharge, ultActive: player2.ultActive },
    winsP1, winsP2, totalRounds,
    shurikens: shurikens.map(s => ({ x: s.x, y: s.y, owner: s.owner })),
    level: currentLevel,
    time: timeRemaining,
    score: score,
    theme: selectedTheme,
    toastText: toastMsg.innerText,
    toastId: toastIdCounter,
    gameoverInfo: lastGameoverInfo
  });
}

function sendClientInput() {
  if (!conn || !conn.open) return;
  conn.send({
    type: 'input',
    state: {
      up: !!keys['KeyW'], down: !!keys['KeyS'],
      left: !!keys['KeyA'], right: !!keys['KeyD'],
      ax: joyVecX, ay: joyVecY
    }
  });
}

// ================= RESET / MULAI LEVEL =================
function resetForLevel(level) {
  const cfg = getLevelConfig(level);
  timeRemaining = cfg.timeLimit;
  lowTimeWarned = false;

  const gy = canvas.height * 0.58 + 40;
  const pcSel = document.getElementById('player-char');
  playerChar = (pcSel && pcSel.value) || playerChar || 'samurai';
  const pc = CHAR_PRESETS[playerChar] || CHAR_PRESETS.samurai;
  player1 = newPlayer(Math.max(40, canvas.width * 0.18), gy, pc.body, pc.accent, {
    kind: pc.kind, hp: pc.hp, speed: pc.speed, size: pc.size
  });

  const et = (document.getElementById('enemy-type') || {}).value || enemyType || 'kunoichi';
  enemyType = et;
  const ec = CHAR_PRESETS[enemyType] || CHAR_PRESETS.samurai;
  if (currentMode === 'vs-ai') {
    const eHp = enemyType === 'samurai' ? cfg.enemyHp : Math.floor(cfg.enemyHp * (enemyType === 'kunoichi' ? 0.75 : 0.85));
    const eSp = enemyType === 'samurai' ? Math.min(4.5, cfg.enemySpeed * 0.85) : (ec.speed * 0.95);
    player2 = newPlayer(
      Math.min(canvas.width - 80, canvas.width * 0.78), gy,
      enemyType === 'samurai' ? '#7f1d1d' : ec.body,
      enemyType === 'samurai' ? '#f87171' : ec.accent,
      { kind: ec.kind, hp: eHp, speed: eSp, size: ec.size }
    );
    player2.orbitDir = Math.random() < 0.5 ? 1 : -1;
  } else {
    // P2 human / online: samurai merah default, atau ikut preset ninja-style lawan
    player2 = newPlayer(Math.min(canvas.width - 80, canvas.width * 0.78), gy, '#7f1d1d', '#f87171', { kind: 'samurai', size: 36 });
  }

  shurikens.length = 0;
  hitSparks.length = 0;
  smokePuffs.length = 0;
  slashTrails.length = 0;
  impactFX.length = 0;
  bloodDrops.length = 0;
  metalSparks.length = 0;
  dmgNumbers.length = 0;
  hurtFlashP1 = 0;
  hurtFlashP2 = 0;

  updateWinsUI();
  timeVal.innerText = Math.ceil(timeRemaining);
  updateHpBars();
  updateUltBars();
}

function updateHpBars() {
  hpP1.style.width = Math.max(0, (player1.hp / player1.maxHp) * 100) + '%';
  hpP2.style.width = Math.max(0, (player2.hp / player2.maxHp) * 100) + '%';
}

// ================= INPUT =================
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'Enter', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;

  if (networkRole === 'client') {
    if (e.code === 'Space') sendAction('melee');
    if (e.code === 'KeyF') sendAction('throw');
    if (e.code === 'KeyE') sendAction('ult');
    return;
  }

  if (e.code === 'Space') triggerMelee('p1');
  if (e.code === 'KeyF') triggerThrow('p1');
  if (e.code === 'KeyE') triggerUlt('p1');
  if (currentMode === '2-player') {
    if (e.code === 'Enter') triggerMelee('p2');
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') triggerThrow('p2');
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') triggerUlt('p2');
  }
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

// ================= KONTROL SENTUH (HP / TABLET) =================
if (isTouchDevice) {
  document.getElementById('touch-controls').classList.remove('hidden');
}

const joyZone = document.getElementById('joystick-zone');
const joyStick = document.getElementById('joystick-stick');
const joyBase = document.getElementById('joystick-base');
const btnMeleeTouch = document.getElementById('btn-melee-touch');
const btnThrowTouch = document.getElementById('btn-throw-touch');

// Analog asli: besar dorongan stick = besar kecepatan gerak (bukan on/off),
// jadi respons langsung terasa dari gerakan sekecil apa pun (deadzone kecil).
const JOY_MAX_DIST = 34;
const JOY_DEADZONE_RATIO = 0.10; // ambang minimal super kecil hanya untuk cegah jitter di tengah
let joyVecX = 0, joyVecY = 0; // -1..1, dipakai langsung sebagai pengali kecepatan
let joyPointerId = null;
let joyCenterX = 0, joyCenterY = 0;

function updateJoystickFromDelta(dx, dy) {
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, JOY_MAX_DIST);
  const angle = Math.atan2(dy, dx);
  const stickX = Math.cos(angle) * clamped;
  const stickY = Math.sin(angle) * clamped;
  joyStick.style.transform = `translate(${stickX}px, ${stickY}px)`;

  const ratio = clamped / JOY_MAX_DIST;
  if (ratio > JOY_DEADZONE_RATIO) {
    joyVecX = (stickX / JOY_MAX_DIST);
    joyVecY = (stickY / JOY_MAX_DIST);
  } else {
    joyVecX = 0; joyVecY = 0;
  }
}

if (joyZone) {
  joyZone.addEventListener('pointerdown', (e) => {
    ensureAudio();
    joyPointerId = e.pointerId;
    joyZone.setPointerCapture(e.pointerId);
    joyBase.classList.add('active');
    const rect = joyZone.getBoundingClientRect();
    joyCenterX = rect.left + rect.width / 2;
    joyCenterY = rect.top + rect.height / 2;
    updateJoystickFromDelta(e.clientX - joyCenterX, e.clientY - joyCenterY);
    e.preventDefault();
  }, { passive: false });
  joyZone.addEventListener('pointermove', (e) => {
    if (joyPointerId !== e.pointerId) return;
    updateJoystickFromDelta(e.clientX - joyCenterX, e.clientY - joyCenterY);
    e.preventDefault();
  }, { passive: false });
  const endJoystick = (e) => {
    if (joyPointerId !== e.pointerId) return;
    joyPointerId = null;
    joyBase.classList.remove('active');
    joyStick.style.transform = 'translate(0px, 0px)';
    joyVecX = 0; joyVecY = 0;
  };
  joyZone.addEventListener('pointerup', endJoystick);
  joyZone.addEventListener('pointercancel', endJoystick);
}

function bindTouchActionButton(el, action) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    el.classList.add('pressed');
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 180);
    // Getaran ringan jika browser support
    if (navigator.vibrate) {
      try { navigator.vibrate(action === 'ult' ? 40 : 18); } catch (_) {}
    }
    if (networkRole === 'client') {
      sendAction(action);
    } else {
      if (action === 'melee') triggerMelee('p1');
      if (action === 'throw') triggerThrow('p1');
      if (action === 'ult') triggerUlt('p1');
    }
  }, { passive: false });
  const release = () => el.classList.remove('pressed');
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}
bindTouchActionButton(btnMeleeTouch, 'melee');
bindTouchActionButton(btnThrowTouch, 'throw');
bindTouchActionButton(document.getElementById('btn-ult-touch'), 'ult');

function sendAction(action) {
  if (!conn || !conn.open) return;
  conn.send({ type: 'action', action });
}

function triggerMelee(who) {
  if (!isRunning || isPaused) return;
  const p = who === 'p1' ? player1 : player2;
  if (isVanished(p) || (p.vanishTimer > 0 && p.vanishPhase === 2)) return;
  if (p.meleeCooldown > 0 || p.attackTimer > 0) return;
  p.attackTimer = MELEE_ARC_FRAMES;
  p.attackHasHit = false;
  p.meleeCooldown = MELEE_COOLDOWN_FRAMES;
  p.attackLunge = 1; // 1 = maju, akan di-decay
  // Lunge sedikit ke arah hadap
  const fl = Math.hypot(p.facing.x, p.facing.y) || 1;
  p.x += (p.facing.x / fl) * 10;
  p.y += (p.facing.y / fl) * 6;
  clampToArena(p);
  // Jejak tebasan
  spawnSlashTrail(p);
  ensureAudio();
  sfxSwing();
}

function spawnSlashTrail(p) {
  const cx = p.x + p.size / 2;
  const cy = p.y + p.size / 2;
  const ang = Math.atan2(p.facing.y, p.facing.x);
  const kind = p.kind || 'samurai';
  const col = p.ultActive ? 'rgba(250,204,21,' :
    (kind === 'kunoichi' ? 'rgba(192,132,252,' :
    (kind === 'ninja' ? 'rgba(248,113,113,' : 'rgba(147,197,253,'));
  // Di HP: jejak lebih tebal & lebih lama supaya kelihatan jelas
  const touchBoost = isTouchDevice ? 1.25 : 1;
  slashTrails.push({
    x: cx, y: cy, ang,
    life: isTouchDevice ? 18 : 14,
    maxLife: isTouchDevice ? 18 : 14,
    radius: (p.ultActive ? ULT_RANGE * 0.85 : MELEE_RANGE * 0.9) * touchBoost,
    color: col,
    wide: (p.ultActive ? 1.4 : 1) * touchBoost,
    kind,
    thick: isTouchDevice ? 1.4 : 1
  });
}

function spawnImpact(x, y, color) {
  screenShake = Math.max(screenShake, isTouchDevice ? 7 : 5);
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3.5;
    impactFX.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 10 + Math.random() * 8,
      maxLife: 16,
      size: 2 + Math.random() * 3,
      color: color || 'rgba(254,243,199,'
    });
  }
  // ring flash
  hitSparks.push({ x, y, life: 10, maxLife: 10, radius: 28 });
}

function spawnMetalSparks(x, y, dirX, dirY, heavy) {
  const n = heavy ? 14 : 9;
  const fl = Math.hypot(dirX, dirY) || 1;
  const base = Math.atan2(dirY / fl, dirX / fl);
  for (let i = 0; i < n; i++) {
    const a = base + (Math.random() - 0.5) * Math.PI * 1.2;
    const sp = 2.5 + Math.random() * (heavy ? 6 : 4);
    metalSparks.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - Math.random() * 2,
      life: 12 + Math.random() * 10,
      maxLife: 22,
      size: 1.2 + Math.random() * 2.5,
      bright: Math.random() < 0.4
    });
  }
  hitSparks.push({ x, y, life: 8, maxLife: 8, radius: heavy ? 36 : 22, metal: true });
  screenShake = Math.max(screenShake, heavy ? 8 : 4);
}

function spawnDmgNumber(x, y, amount, crit) {
  dmgNumbers.push({
    x: x + (Math.random() - 0.5) * 16,
    y: y - 10,
    vy: -1.8 - Math.random() * 0.8,
    life: 40, maxLife: 40,
    text: String(Math.round(amount)),
    crit: !!crit
  });
}

function sfxClash() {
  if (!soundEnabled || !audioCtx) return;
  tone(900, 0.06, 'square', 0.1, 400);
  tone(1400, 0.04, 'sawtooth', 0.08, 600);
}

function spawnBlood(x, y, dirX, dirY, amount) {
  amount = amount || 12;
  const fl = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / fl, ny = dirY / fl;
  for (let i = 0; i < amount; i++) {
    // Semprot berlawanan arah penyerang + acak
    const spread = (Math.random() - 0.5) * 1.4;
    const ang = Math.atan2(ny, nx) + Math.PI + spread;
    const sp = 2 + Math.random() * 5.5;
    bloodDrops.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - Math.random() * 1.5,
      life: 22 + Math.random() * 18,
      maxLife: 40,
      size: 2.5 + Math.random() * 4.5,
      drip: Math.random() < 0.35, // tetesan yang jatuh lebih lama
      color: Math.random() < 0.3 ? 'rgba(127, 29, 29,' : 'rgba(185, 28, 28,'
    });
  }
  // pool kecil di tanah
  bloodDrops.push({
    x: x, y: y + 14,
    vx: 0, vy: 0,
    life: 45, maxLife: 45,
    size: 10 + Math.random() * 6,
    drip: false,
    pool: true,
    color: 'rgba(127, 29, 29,'
  });
}

function triggerThrow(who) {
  if (!isRunning || isPaused) return;
  const p = who === 'p1' ? player1 : player2;
  if (p.throwCooldown > 0) return;
  p.throwCooldown = THROW_COOLDOWN_FRAMES;
  const fl = Math.hypot(p.facing.x, p.facing.y) || 1;
  shurikens.push({
    x: p.x + p.size / 2, y: p.y + p.size / 2,
    dx: p.facing.x / fl, dy: p.facing.y / fl, owner: who
  });
  ensureAudio();
  sfxThrow();
}

function triggerUlt(who) {
  if (!isRunning || isPaused) return;
  const p = who === 'p1' ? player1 : player2;
  if (p.ultCharge < ULT_COST || p.ultActive) return;
  p.ultCharge = 0;
  p.ultActive = true;
  p.ultTimer = ULT_DURATION;
  p.attackTimer = ULT_DURATION;
  p.attackHasHit = true; // damage langsung di bawah, bukan lewat checkMeleeHit
  p.meleeCooldown = MELEE_COOLDOWN_FRAMES + 12;
  ensureAudio();
  sfxUlt();
  showToast(who === 'p1' ? '✦ JURUS RAHASIA!' : '✦ LAWAN MENGGUNAKAN JURUS!');

  // Damage AOE instan ke lawan dalam jangkauan
  const target = who === 'p1' ? player2 : player1;
  const acx = p.x + p.size / 2, acy = p.y + p.size / 2;
  const tcx = target.x + target.size / 2, tcy = target.y + target.size / 2;
  const dist = Math.hypot(tcx - acx, tcy - acy);
  if (dist <= ULT_RANGE) {
    target.hp = Math.max(0, target.hp - ULT_DAMAGE);
    if (who === 'p1') score += 25;
    ensureAudio(); sfxHit();
    spawnBlood(tcx, tcy, tcx - acx, tcy - acy, 20);
    if (target === player1) hurtFlashP1 = 1;
    else hurtFlashP2 = 1;
    // Knockback ringan
    const nx = (tcx - acx) / (dist || 1);
    const ny = (tcy - acy) / (dist || 1);
    target.x += nx * 28;
    target.y += ny * 12;
    clampToArena(target);
    updateHpBars();
    checkRoundEnd(getLevelConfig(currentLevel));
  }
  // Efek visual gelombang
  hitSparks.push({ x: acx, y: acy, life: 18, maxLife: 18, radius: ULT_RANGE });
  spawnSlashTrail(p);
  spawnImpact(acx, acy, 'rgba(250,204,21,');
  updateUltBars();
}

function updateUltEffects(fs) {
  [player1, player2].forEach(p => {
    if (p.ultActive) {
      p.ultTimer -= fs;
      if (p.ultTimer <= 0) {
        p.ultActive = false;
        p.ultTimer = 0;
      }
    }
    if (p.vanishCD > 0) p.vanishCD = Math.max(0, p.vanishCD - fs);
  });
  for (let i = hitSparks.length - 1; i >= 0; i--) {
    hitSparks[i].life -= fs;
    if (hitSparks[i].life <= 0) hitSparks.splice(i, 1);
  }
  for (let i = slashTrails.length - 1; i >= 0; i--) {
    slashTrails[i].life -= fs;
    if (slashTrails[i].life <= 0) slashTrails.splice(i, 1);
  }
  for (let i = impactFX.length - 1; i >= 0; i--) {
    const fx = impactFX[i];
    fx.x += fx.vx * fs;
    fx.y += fx.vy * fs;
    fx.vx *= 0.92;
    fx.vy *= 0.92;
    fx.life -= fs;
    if (fx.life <= 0) impactFX.splice(i, 1);
  }
  for (let i = bloodDrops.length - 1; i >= 0; i--) {
    const b = bloodDrops[i];
    if (!b.pool) {
      b.x += b.vx * fs;
      b.y += b.vy * fs;
      b.vy += 0.18 * fs; // gravitasi
      b.vx *= 0.98;
      if (b.drip && b.vy > 0) b.size = Math.min(b.size + 0.05 * fs, 7);
    } else {
      b.size += 0.08 * fs; // pool melebar pelan
    }
    b.life -= fs;
    if (b.life <= 0) bloodDrops.splice(i, 1);
  }
  if (hurtFlashP1 > 0) hurtFlashP1 = Math.max(0, hurtFlashP1 - fs * 0.12);
  if (hurtFlashP2 > 0) hurtFlashP2 = Math.max(0, hurtFlashP2 - fs * 0.12);
  for (let i = metalSparks.length - 1; i >= 0; i--) {
    const m = metalSparks[i];
    m.x += m.vx * fs; m.y += m.vy * fs;
    m.vy += 0.25 * fs; m.vx *= 0.96;
    m.life -= fs;
    if (m.life <= 0) metalSparks.splice(i, 1);
  }
  for (let i = dmgNumbers.length - 1; i >= 0; i--) {
    const d = dmgNumbers[i];
    d.y += d.vy * fs; d.vy *= 0.98; d.life -= fs;
    if (d.life <= 0) dmgNumbers.splice(i, 1);
  }
  if (player1.attackTimer > 0 && player2.attackTimer > 0) {
    const dx = (player1.x + player1.size/2) - (player2.x + player2.size/2);
    const dy = (player1.y + player1.size/2) - (player2.y + player2.size/2);
    if (Math.hypot(dx, dy) < MELEE_RANGE * 1.3 && !player1._clashDone) {
      player1._clashDone = true; player2._clashDone = true;
      const mx = (player1.x + player2.x) / 2 + player1.size / 2;
      const my = (player1.y + player2.y) / 2 + player1.size / 2;
      spawnMetalSparks(mx, my, dx, dy, true);
      sfxClash();
      const dist = Math.hypot(dx, dy) || 1;
      player1.x += (dx / dist) * 12; player2.x -= (dx / dist) * 12;
      clampToArena(player1); clampToArena(player2);
    }
  } else {
    if (player1.attackTimer <= 0) player1._clashDone = false;
    if (player2.attackTimer <= 0) player2._clashDone = false;
  }
  [player1, player2].forEach(p => {
    if (p.attackLunge > 0) p.attackLunge = Math.max(0, p.attackLunge - fs * 0.15);
    if (p.hitRecoil > 0) p.hitRecoil = Math.max(0, p.hitRecoil - fs * 0.12);
  });
  if (screenShake > 0) screenShake = Math.max(0, screenShake - fs * 1.2);
  updateSmoke(fs);
  updateVanish(player2, fs);
}

function spawnSmoke(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 0.4 + Math.random() * 1.8;
    smokePuffs.push({
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 16,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 0.6,
      life: 18 + Math.random() * 16,
      maxLife: 28,
      size: 10 + Math.random() * 18,
      color: color || 'rgba(120, 100, 140,'
    });
  }
}

function updateSmoke(fs) {
  for (let i = smokePuffs.length - 1; i >= 0; i--) {
    const p = smokePuffs[i];
    p.x += p.vx * fs;
    p.y += p.vy * fs;
    p.vx *= 0.96;
    p.vy -= 0.04 * fs; // naik pelan
    p.life -= fs;
    p.size += 0.35 * fs;
    if (p.life <= 0) smokePuffs.splice(i, 1);
  }
}

function drawSmoke() {
  smokePuffs.forEach(p => {
    const t = Math.max(0, p.life / p.maxLife);
    const alpha = t * 0.55;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1.2 - t * 0.3), 0, Math.PI * 2);
    ctx.fillStyle = p.color + alpha + ')';
    ctx.fill();
  });
}

/** Smoke Vanish: hilang → pindah posisi → muncul lagi */
function triggerSmokeVanish(p, targetX, targetY) {
  if (!p || p.vanishTimer > 0 || p.vanishCD > 0) return false;
  // Fase 1: asap di posisi lama
  spawnSmoke(p.x + p.size / 2, p.y + p.size / 2, 14, 'rgba(90, 70, 120,');
  spawnSmoke(p.x + p.size / 2, p.y + p.size / 2, 8, 'rgba(160, 150, 180,');
  p.vanishPhase = 1;
  p.vanishTimer = 36; // total frames ~0.6s
  p._vanishTargetX = targetX;
  p._vanishTargetY = targetY;
  p.vanishCD = 180; // cooldown ~3 detik
  ensureAudio();
  tone(180, 0.15, 'triangle', 0.12, 60);
  tone(90, 0.2, 'sawtooth', 0.08, 40);
  showToast('💨 Smoke Vanish!');
  return true;
}

function updateVanish(p, fs) {
  if (!p || p.vanishTimer <= 0) {
    if (p) p.vanishPhase = 0;
    return;
  }
  p.vanishTimer -= fs;
  // Fase timeline: 36→24 pre-smoke, 24→12 hidden+teleport, 12→0 appear
  if (p.vanishTimer <= 24 && p.vanishPhase === 1) {
    // teleport saat tersembunyi
    p.x = p._vanishTargetX;
    p.y = p._vanishTargetY;
    clampToArena(p);
    p.vanishPhase = 2;
  }
  if (p.vanishTimer <= 12 && p.vanishPhase === 2) {
    // asap muncul di lokasi baru
    spawnSmoke(p.x + p.size / 2, p.y + p.size / 2, 12, 'rgba(90, 70, 120,');
    spawnSmoke(p.x + p.size / 2, p.y + p.size / 2, 6, 'rgba(180, 160, 200,');
    p.vanishPhase = 3;
    // orientasi ke player1
    const dx = player1.x - p.x, dy = player1.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    p.facing = { x: dx / d, y: dy / d };
  }
  if (p.vanishTimer <= 0) {
    p.vanishTimer = 0;
    p.vanishPhase = 0;
  }
}

function isVanished(p) {
  // Fase 2 (hidden) tidak bisa di-hit & tidak digambar penuh
  return p && p.vanishPhase === 2;
}

function isVanishInvuln(p) {
  return p && p.vanishTimer > 0 && p.vanishPhase >= 1 && p.vanishPhase <= 2;
}

// ================= AI MUSUH =================
function updateAI(cfg, fs) {
  fs = fs || 1;
  const prevX = player2.x, prevY = player2.y;
  if (player2.kind === 'kunoichi' || enemyType === 'kunoichi') {
    updateKunoichiAI(cfg, fs);
  } else if (player2.kind === 'ninja' || enemyType === 'ninja') {
    updateNinjaAI(cfg, fs);
  } else {
    updateSamuraiAI(cfg, fs);
  }
  clampToArena(player2);
  if (Math.hypot(player2.x - prevX, player2.y - prevY) > 0.3) {
    player2.walkPhase = (player2.walkPhase || 0) + 0.35 * fs;
  } else {
    player2.walkPhase = 0;
  }
}

function updateSamuraiAI(cfg, fs) {
  if (isVanished(player2)) return;
  const dx = player1.x - player2.x;
  const dy = player1.y - player2.y;
  const dist = Math.hypot(dx, dy);

  if (dist > 1) {
    const nx = dx / dist, ny = dy / dist;
    if (dist > MELEE_RANGE * 0.75) {
      player2.x += nx * player2.speed * fs;
      player2.y += ny * player2.speed * fs;
    }
    player2.facing = { x: nx, y: ny };
  }

  if (dist <= MELEE_RANGE * 1.05 && player2.meleeCooldown <= 0 && player2.attackTimer <= 0) {
    triggerMelee('p2');
    player2.meleeCooldown = Math.max(cfg.enemyMeleeCooldown, 45);
  } else if (dist > MELEE_RANGE && dist < 380 && player2.throwCooldown <= 0 && Math.random() < cfg.enemyThrowChance * 0.7 * fs) {
    triggerThrow('p2');
  }

  if (player2.ultCharge >= ULT_COST && dist < ULT_RANGE && Math.random() < 0.02 * fs) {
    triggerUlt('p2');
  }
}

function updateNinjaAI(cfg, fs) {
  if (isVanished(player2) || player2.vanishTimer > 0) return;
  const dx = player1.x - player2.x;
  const dy = player1.y - player2.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  player2.facing = { x: nx, y: ny };

  // Stalk from side
  const side = player2.orbitDir || 1;
  if (dist > 200) {
    player2.x += (nx * 0.75 + (-ny) * side * 0.55) * player2.speed * fs;
    player2.y += (ny * 0.75 + nx * side * 0.55) * player2.speed * fs;
  } else if (dist < 90) {
    if (player2.meleeCooldown <= 0 && player2.attackTimer <= 0) {
      triggerMelee('p2');
      player2.meleeCooldown = 40;
    } else {
      player2.x -= nx * player2.speed * fs;
      player2.y -= ny * player2.speed * 0.5 * fs;
    }
  } else {
    player2.x += (nx * 0.4 + (-ny) * side * 0.9) * player2.speed * fs;
    player2.y += (ny * 0.4 + nx * side * 0.9) * player2.speed * fs;
  }

  if (dist > 120 && dist < 340 && player2.throwCooldown <= 0 && Math.random() < 0.02 * fs) {
    triggerThrow('p2');
  }

  // Ambush vanish behind player
  if (dist > 100 && dist < 260 && player2.vanishCD <= 0 && Math.random() < 0.01 * fs) {
    const tx = player1.x - nx * 70;
    const ty = player1.y - ny * 20;
    if (triggerSmokeVanish(player2, tx, ty)) {
      player2.orbitDir = -side;
    }
  }

  if (player2.ultCharge >= ULT_COST && dist < ULT_RANGE && Math.random() < 0.015 * fs) {
    triggerUlt('p2');
  }
}

function throwFanShuriken(who) {
  const p = who === 'p1' ? player1 : player2;
  if (p.throwCooldown > 0 || isVanished(p)) return;
  p.throwCooldown = THROW_COOLDOWN_FRAMES * 0.75;
  const fl = Math.hypot(p.facing.x, p.facing.y) || 1;
  const baseAng = Math.atan2(p.facing.y / fl, p.facing.x / fl);
  [-0.28, 0, 0.28].forEach(off => {
    const a = baseAng + off;
    shurikens.push({
      x: p.x + p.size / 2,
      y: p.y + p.size / 2,
      dx: Math.cos(a),
      dy: Math.sin(a),
      owner: who
    });
  });
  ensureAudio();
  sfxThrow();
}

function updateKunoichiAI(cfg, fs) {
  if (player2.vanishTimer > 0) return; // tidak gerak saat vanish animasi

  const dx = player1.x - player2.x;
  const dy = player1.y - player2.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  player2.facing = { x: nx, y: ny };
  player2.aiTimer = (player2.aiTimer || 0) + fs;

  // --- RETREAT jika HP rendah ---
  if (player2.hp < player2.maxHp * 0.35) {
    player2.x -= nx * player2.speed * 1.15 * fs;
    player2.y -= ny * player2.speed * 0.6 * fs;
    if (player2.throwCooldown <= 0 && Math.random() < 0.03 * fs) throwFanShuriken('p2');
    // Smoke kabur ke sudut
    if (player2.vanishCD <= 0 && Math.random() < 0.015 * fs) {
      const tx = nx > 0 ? 40 : canvas.width - 80;
      const ty = canvas.height * 0.7;
      triggerSmokeVanish(player2, tx, ty);
    }
    return;
  }

  // --- FLANK/DODGE jika pemain sedang menebas dekat ---
  if (player1.attackTimer > 0 && dist < 100 && player2.vanishCD <= 0 && Math.random() < 0.08 * fs) {
    const side = player2.orbitDir || 1;
    const fx = player1.x + (-ny) * side * 120;
    const fy = player1.y + nx * side * 40;
    if (triggerSmokeVanish(player2, fx, fy)) {
      player2.orbitDir = -side;
      return;
    }
  }

  // --- MELEE BURST jarang ---
  if (dist < 60 && player2.meleeCooldown <= 0 && player2.attackTimer <= 0 && Math.random() < 0.02 * fs) {
    // dash masuk singkat
    player2.x += nx * 18;
    player2.y += ny * 10;
    clampToArena(player2);
    triggerMelee('p2');
    player2.meleeCooldown = 50;
    return;
  }

  // --- HARASS: orbit + fan shuriken ---
  if (dist > 280) {
    // approach tapi tidak lurus
    const side = player2.orbitDir || 1;
    player2.x += (nx * 0.7 + (-ny) * side * 0.5) * player2.speed * fs;
    player2.y += (ny * 0.7 + nx * side * 0.5) * player2.speed * fs;
  } else if (dist < 130) {
    // terlalu dekat → mundur sambil orbit
    const side = player2.orbitDir || 1;
    player2.x += (-nx * 0.9 + (-ny) * side * 0.7) * player2.speed * fs;
    player2.y += (-ny * 0.9 + nx * side * 0.7) * player2.speed * fs;
  } else {
    // orbit di jarak ideal 180–240
    const side = player2.orbitDir || 1;
    player2.x += (-ny) * side * player2.speed * 1.05 * fs;
    player2.y += nx * side * player2.speed * 0.7 * fs;
    // kadang balik arah orbit
    if (player2.aiTimer > 90) {
      player2.orbitDir = Math.random() < 0.5 ? 1 : -1;
      player2.aiTimer = 0;
    }
  }

  // Lempar fan shuriken
  if (dist > 100 && dist < 320 && player2.throwCooldown <= 0 && Math.random() < 0.025 * fs) {
    throwFanShuriken('p2');
  }

  // Smoke vanish flank ofensif
  if (dist > 150 && dist < 280 && player2.vanishCD <= 0 && Math.random() < 0.008 * fs) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const tx = player1.x + (-ny) * side * 90;
    const ty = player1.y + nx * side * 30;
    triggerSmokeVanish(player2, tx, ty);
  }

  // Ult tetap bisa
  if (player2.ultCharge >= ULT_COST && dist < ULT_RANGE && Math.random() < 0.015 * fs) {
    triggerUlt('p2');
  }
}

function clampToArena(p) {
  // Batas arena ketat: selalu di dalam layar, tidak bisa hilang ke belakang/samping
  const pad = 8;
  const groundY = canvas.height * 0.58;
  const minY = groundY;
  const maxY = canvas.height - p.size - pad;
  p.x = Math.max(pad, Math.min(canvas.width - p.size - pad, p.x));
  p.y = Math.max(minY, Math.min(maxY, p.y));
}

// ================= UPDATE =================
function updateMovement(fs) {
  fs = fs || 1;
  const joyMag = Math.hypot(joyVecX, joyVecY);
  if (joyMag > 0.001) {
    player1.x += joyVecX * player1.speed * fs;
    player1.y += joyVecY * player1.speed * fs;
    player1.facing = { x: joyVecX / joyMag, y: joyVecY / joyMag };
  } else {
    let mx = 0, my = 0;
    if (keys['KeyW']) my -= 1;
    if (keys['KeyS']) my += 1;
    if (keys['KeyA']) mx -= 1;
    if (keys['KeyD']) mx += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my) || 1;
      player1.x += (mx / len) * player1.speed * fs;
      player1.y += (my / len) * player1.speed * fs;
      player1.facing = { x: mx / len, y: my / len };
    }
  }
  clampToArena(player1);
  const moving1 = Math.hypot(joyVecX, joyVecY) > 0.05 || keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
  if (moving1) player1.walkPhase = (player1.walkPhase || 0) + 0.35 * (fs || 1);
  else player1.walkPhase = 0;

  if (currentMode === '2-player') {
    let mx = 0, my = 0;
    if (keys['ArrowUp']) my -= 1;
    if (keys['ArrowDown']) my += 1;
    if (keys['ArrowLeft']) mx -= 1;
    if (keys['ArrowRight']) mx += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my) || 1;
      player2.x += (mx / len) * player2.speed * fs;
      player2.y += (my / len) * player2.speed * fs;
      player2.facing = { x: mx / len, y: my / len };
    }
    clampToArena(player2);
  } else if (currentMode === 'online-host') {
    const rax = remoteInput.ax || 0, ray = remoteInput.ay || 0;
    const rmag = Math.hypot(rax, ray);
    if (rmag > 0.001) {
      player2.x += rax * player2.speed * fs;
      player2.y += ray * player2.speed * fs;
      player2.facing = { x: rax / rmag, y: ray / rmag };
    } else {
      let mx = 0, my = 0;
      if (remoteInput.up) my -= 1;
      if (remoteInput.down) my += 1;
      if (remoteInput.left) mx -= 1;
      if (remoteInput.right) mx += 1;
      if (mx || my) {
        const len = Math.hypot(mx, my) || 1;
        player2.x += (mx / len) * player2.speed * fs;
        player2.y += (my / len) * player2.speed * fs;
        player2.facing = { x: mx / len, y: my / len };
      }
    }
    clampToArena(player2);
  }
}

function updateCombat(cfg, fs) {
  fs = fs || 1;
  [player1, player2].forEach(p => {
    if (p.meleeCooldown > 0) p.meleeCooldown = Math.max(0, p.meleeCooldown - fs);
    if (p.throwCooldown > 0) p.throwCooldown = Math.max(0, p.throwCooldown - fs);
    if (p.attackTimer > 0) p.attackTimer = Math.max(0, p.attackTimer - fs);
  });

  // Cek hit tebasan (sekali per ayunan) — dipanggil setiap frame dalam jendela hit
  checkMeleeHit(player1, player2);
  checkMeleeHit(player2, player1);

  // Update shuriken
  for (let i = shurikens.length - 1; i >= 0; i--) {
    const s = shurikens[i];
    s.x += s.dx * SHURIKEN_SPEED * fs;
    s.y += s.dy * SHURIKEN_SPEED * fs;
    if (s.x < -20 || s.x > canvas.width + 20 || s.y < -20 || s.y > canvas.height + 20) {
      shurikens.splice(i, 1);
      continue;
    }
    const target = s.owner === 'p1' ? player2 : player1;
    const tcx = target.x + target.size / 2, tcy = target.y + target.size / 2;
    if (isVanishInvuln(target) || isVanished(target)) continue;
    if (Math.hypot(s.x - tcx, s.y - tcy) < target.size / 2 + 4) {
      target.hp = Math.max(0, target.hp - SHURIKEN_DAMAGE);
      spawnImpact(s.x, s.y, 'rgba(200,200,220,');
      spawnBlood(s.x, s.y, s.dx, s.dy, 8);
      spawnMetalSparks(s.x, s.y, s.dx, s.dy, false);
      spawnDmgNumber(s.x, s.y - 8, SHURIKEN_DAMAGE, false);
      if (target === player1) hurtFlashP1 = 1; else hurtFlashP2 = 1;
      target.hitRecoil = 0.7;
      shurikens.splice(i, 1);
      ensureAudio(); sfxHit();
      if (s.owner === 'p1') {
        score += 5;
        player1.ultCharge = Math.min(100, player1.ultCharge + 16);
      } else {
        player2.ultCharge = Math.min(100, player2.ultCharge + 16);
      }
      updateHpBars();
      updateUltBars();
      checkRoundEnd(cfg);
    }
  }
}

function checkMeleeHit(attacker, defender) {
  if (attacker.attackTimer <= 0 || attacker.attackHasHit) return;
  if (isVanishInvuln(defender) || isVanished(defender)) return;
  if (isVanished(attacker)) return;
  // Jendela hit lebih lebar (bukan 1 frame saja) supaya tidak miss saat FPS drop
  const arcMax = attacker.ultActive ? ULT_DURATION : MELEE_ARC_FRAMES;
  const progress = 1 - (attacker.attackTimer / arcMax);
  if (progress < 0.2 || progress > 0.85) return;

  const acx = attacker.x + attacker.size / 2, acy = attacker.y + attacker.size / 2;
  const dcx = defender.x + defender.size / 2, dcy = defender.y + defender.size / 2;
  const dx = dcx - acx, dy = dcy - acy;
  const dist = Math.hypot(dx, dy);
  const range = attacker.ultActive ? ULT_RANGE : MELEE_RANGE * 1.15;
  if (dist > range) return;

  const facingLen = Math.hypot(attacker.facing.x, attacker.facing.y) || 1;
  const dot = (attacker.facing.x * dx + attacker.facing.y * dy) / (facingLen * dist || 1);
  if (dot < 0.2) return; // kerucut lebih longgar ~78 derajat

  attacker.attackHasHit = true;
  const tcx2 = defender.x + defender.size / 2, tcy2 = defender.y + defender.size / 2;
  spawnImpact(tcx2, tcy2, attacker.ultActive ? 'rgba(250,204,21,' : 'rgba(254,243,199,');
  spawnBlood(tcx2, tcy2, attacker.facing.x, attacker.facing.y, attacker.ultActive ? 18 : 12);
  spawnMetalSparks(tcx2, tcy2, attacker.facing.x, attacker.facing.y, !!attacker.ultActive);
  if (defender === player1) hurtFlashP1 = 1; else hurtFlashP2 = 1;
  let dmg = attacker.ultActive ? ULT_DAMAGE : MELEE_DAMAGE;
  if (attacker === player2 && currentMode === 'vs-ai' && !attacker.ultActive) {
    dmg = Math.max(5, Math.floor(MELEE_DAMAGE * 0.7));
  }
  defender.hp = Math.max(0, defender.hp - dmg);
  spawnDmgNumber(tcx2, tcy2 - 8, dmg, !!attacker.ultActive);
  defender.hitRecoil = 1;
  const rfl = Math.hypot(attacker.facing.x, attacker.facing.y) || 1;
  defender.x += (attacker.facing.x / rfl) * 8;
  defender.y += (attacker.facing.y / rfl) * 4;
  clampToArena(defender);
  if (attacker === player1) {
    score += attacker.ultActive ? 25 : 10;
    player1.ultCharge = Math.min(100, player1.ultCharge + (attacker.ultActive ? 0 : 28));
  } else if (attacker === player2 && currentMode === 'vs-ai') {
    player2.ultCharge = Math.min(100, player2.ultCharge + 20);
  } else if (attacker === player2) {
    player2.ultCharge = Math.min(100, player2.ultCharge + 28);
  }
  ensureAudio(); sfxHit();
  updateHpBars();
  updateUltBars();
  checkRoundEnd(getLevelConfig(currentLevel));
}

function isHumanP2() {
  return currentMode === '2-player' || currentMode === 'online-host';
}

function checkRoundEnd(cfg) {
  if (player2.hp <= 0) {
    onLevelCleared();
  } else if (player1.hp <= 0) {
    onRoundWin(false);
  }
}

function updateWinsUI() {
  const el = document.getElementById('wins-val');
  if (el) el.innerText = winsP1 + '-' + winsP2;
  if (levelVal) levelVal.innerText = currentLevel + '/' + totalRounds;
}

function onRoundWin(winnerIsP1) {
  isRunning = false;
  gamePhase = 'levelup';
  if (winnerIsP1) {
    winsP1++;
    score += 50 * currentLevel;
  } else {
    winsP2++;
  }
  scoreVal.innerText = score;
  updateWinsUI();

  const need = roundsToWin;
  if (winsP1 >= need || winsP2 >= need) {
    const name = winsP1 >= need ? 'Player 1' : (isHumanP2() ? 'Player 2' : 'Komputer (AI)');
    setTimeout(() => onGameOver(name), 400);
    return;
  }

  ensureAudio(); sfxLevelUp();
  const wname = winnerIsP1 ? 'Player 1' : (isHumanP2() ? 'Player 2' : 'AI');
  document.getElementById('levelup-text').innerText =
    `Ronde ${currentLevel}: ${wname} menang! (${winsP1}-${winsP2})`;
  levelupScreen.classList.remove('hidden');
  showToast(`Ronde ${currentLevel} selesai! Skor ronde: ${winsP1}-${winsP2}`);

  setTimeout(() => {
    levelupScreen.classList.add('hidden');
    currentLevel++;
    resetForLevel(currentLevel);
    isRunning = true;
    gamePhase = 'playing';
    updateWinsUI();
    showToast(`Ronde ${currentLevel} dimulai!`);
  }, 1800);
}

function onLevelCleared() {
  // Player 1 mengalahkan lawan di ronde ini
  onRoundWin(true);
}

function onGameOver(winnerName) {
  isRunning = false;
  gamePhase = 'gameover';
  ensureAudio();
  if (winnerName === 'Player 1') sfxVictory(); else sfxDefeat();
  const title = winnerName === 'Player 1'
    ? ((currentMode === '2-player' || currentMode === 'online-host' || currentMode === 'online-join') ? 'PLAYER 1 MENANG!' : 'KEMENANGAN!')
    : 'GAME OVER';
  document.getElementById('winner-name').innerText = winnerName;
  document.getElementById('final-level').innerText = currentLevel;
  document.getElementById('final-score').innerText = score;
  document.getElementById('gameover-title').innerText = title;
  gameoverScreen.classList.remove('hidden');
  lastGameoverInfo = { winnerName, level: currentLevel, score, title };
}

function updateTimer(deltaSeconds, cfg) {
  if (!isRunning || isPaused) return;
  timeRemaining -= deltaSeconds;
  if (timeRemaining <= 10 && !lowTimeWarned) {
    lowTimeWarned = true;
    showToast('⏰ Waktu hampir habis!');
    ensureAudio(); sfxTick();
  }
  if (timeRemaining <= 0) {
    timeRemaining = 0;
    if (player1.hp === player2.hp) {
      // Seri ronde: tidak ada yang dapat poin, lanjut ronde berikutnya jika masih ada
      showToast('Seri! Tidak ada yang menang ronde ini.');
      isRunning = false;
      gamePhase = 'levelup';
      levelupScreen.classList.remove('hidden');
      document.getElementById('levelup-text').innerText = 'Seri! Lanjut ronde berikutnya...';
      setTimeout(() => {
        levelupScreen.classList.add('hidden');
        currentLevel++;
        if (currentLevel > totalRounds) {
          if (winsP1 > winsP2) onGameOver('Player 1');
          else if (winsP2 > winsP1) onGameOver(isHumanP2() ? 'Player 2' : 'Komputer (AI)');
          else onGameOver('Seri');
        } else {
          resetForLevel(currentLevel);
          isRunning = true;
          gamePhase = 'playing';
          updateWinsUI();
        }
      }, 1600);
    } else if (player1.hp > player2.hp) {
      onRoundWin(true);
    } else {
      onRoundWin(false);
    }
  }
  timeVal.innerText = Math.ceil(timeRemaining);
}

// ================= LOOP UTAMA =================
function update(deltaSeconds, cfg) {
  if (!isRunning || isPaused) return;
  // Normalisasi ke ~60fps supaya gerak & combat stabil (kurangi patah-patah)
  const frameScale = Math.min(deltaSeconds, 0.05) * 60;
  updateMovement(frameScale);
  if (currentMode === 'vs-ai') updateAI(cfg, frameScale);
  updateCombat(cfg, frameScale);
  updateTimer(deltaSeconds, cfg);
  updateUltEffects(frameScale);
}

function drawHitSparks() {
  hitSparks.forEach(sp => {
    const t = sp.life / sp.maxLife;
    const r = (sp.radius || 40) * (1.1 - t * 0.3);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.55 * t})`;
    ctx.lineWidth = 4 * t + 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * t})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawSlashTrails() {
  slashTrails.forEach(tr => {
    const t = tr.life / tr.maxLife;
    const progress = 1 - t;
    ctx.save();
    ctx.translate(tr.x, tr.y);
    ctx.rotate(tr.ang);
    const startA = -1.15 * tr.wide;
    const endA = startA + progress * 2.3 * tr.wide;
    const thick = tr.thick || 1;
    ctx.beginPath();
    ctx.arc(0, 0, tr.radius * (0.72 + progress * 0.28), startA, endA);
    ctx.strokeStyle = tr.color + (0.35 * t) + ')';
    ctx.lineWidth = (10 * t + 3) * thick;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, tr.radius * (0.7 + progress * 0.3), startA, endA);
    ctx.strokeStyle = tr.color + (0.85 * t) + ')';
    ctx.lineWidth = (5 * t + 2) * thick;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, tr.radius * (0.58 + progress * 0.22), startA + 0.08, endA);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * t) + ')';
    ctx.lineWidth = 2 * thick;
    ctx.stroke();
    if (progress > 0.3 && progress < 0.95) {
      const tipR = tr.radius * (0.7 + progress * 0.3);
      ctx.beginPath();
      ctx.arc(Math.cos(endA) * tipR, Math.sin(endA) * tipR, 3 + 4 * t, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * t) + ')';
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawMetalSparks() {
  metalSparks.forEach(m => {
    const t = m.life / m.maxLife;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size * t, 0, Math.PI * 2);
    ctx.fillStyle = m.bright ? 'rgba(255,255,220,' + (0.95 * t) + ')' : 'rgba(251,191,36,' + (0.85 * t) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * 1.2, m.y - m.vy * 1.2);
    ctx.strokeStyle = 'rgba(253,224,71,' + (0.5 * t) + ')';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
}

function drawDmgNumbers() {
  dmgNumbers.forEach(d => {
    const t = d.life / d.maxLife;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.5);
    ctx.font = d.crit ? 'bold 22px Segoe UI, sans-serif' : 'bold 16px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(d.text, d.x, d.y);
    ctx.fillStyle = d.crit ? '#facc15' : '#fecaca';
    ctx.fillText(d.text, d.x, d.y);
    ctx.restore();
  });
}

function drawImpactFX() {
  impactFX.forEach(fx => {
    const t = fx.life / fx.maxLife;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.size * t, 0, Math.PI * 2);
    ctx.fillStyle = fx.color + (0.9 * t) + ')';
    ctx.fill();
  });
}

function drawBlood() {
  bloodDrops.forEach(b => {
    const t = Math.max(0, b.life / b.maxLife);
    if (b.pool) {
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.size * 0.9, b.size * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = b.color + (0.4 * t) + ')';
      ctx.fill();
    } else {
      ctx.beginPath();
      // tetesan oval mengikuti arah gerak
      const ang = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(ang);
      ctx.ellipse(0, 0, b.size * (0.7 + (1 - t) * 0.3), b.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = b.color + (0.85 * t) + ')';
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawHurtFlash() {
  // Flash merah tipis di tepi layar saat player1 kena
  if (hurtFlashP1 > 0) {
    const a = hurtFlashP1 * 0.35;
    const g = ctx.createRadialGradient(
      canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.2,
      canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.75
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(180, 20, 20, ${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function render(time) {
  ctx.save();
  if (screenShake > 0) {
    const mag = screenShake;
    ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
  }
  drawBackground(time);
  drawBlood();
  drawSlashTrails();
  drawHitSparks();
  drawImpactFX();
  drawMetalSparks();
  drawSmoke();
  shurikens.forEach(drawShuriken);
  drawSamurai(player1);
  drawSamurai(player2);
  drawDmgNumbers();
  drawHurtFlash();
  ctx.restore();
}

function gameLoop(timestamp) {
  if (lastTimestamp === null) lastTimestamp = timestamp;
  const deltaSeconds = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  if (networkRole === 'client') {
    sendClientInput();
    renderClientView(timestamp);
  } else {
    const cfg = getLevelConfig(currentLevel);
    update(Math.min(deltaSeconds, 0.1), cfg);
    render(timestamp);
    if (networkRole === 'host') broadcastState();
  }

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function renderClientView(timestamp) {
  if (!clientView) { drawBackground(timestamp); return; }

  selectedTheme = clientView.theme || selectedTheme;
  drawBackground(timestamp);

  const remoteP1 = Object.assign(newPlayer(0, 0, '#1e3a8a', '#38bdf8'), clientView.p1);
  const remoteP2 = Object.assign(newPlayer(0, 0, '#7f1d1d', '#f87171'), clientView.p2);
  (clientView.shurikens || []).forEach(drawShuriken);
  drawSamurai(remoteP1);
  drawSamurai(remoteP2);

  levelVal.innerText = clientView.level;
  timeVal.innerText = Math.ceil(clientView.time);
  scoreVal.innerText = clientView.score;
  hpP1.style.width = Math.max(0, (clientView.p1.hp / clientView.p1.maxHp) * 100) + '%';
  hpP2.style.width = Math.max(0, (clientView.p2.hp / clientView.p2.maxHp) * 100) + '%';
  const u1 = document.getElementById('ult-p1');
  const u2 = document.getElementById('ult-p2');
  if (u1) u1.style.width = Math.max(0, clientView.p1.ultCharge || 0) + '%';
  if (u2) u2.style.width = Math.max(0, clientView.p2.ultCharge || 0) + '%';
  if (clientView.winsP1 !== undefined) {
    const wv = document.getElementById('wins-val');
    if (wv) wv.innerText = (clientView.winsP1||0) + '-' + (clientView.winsP2||0);
    levelVal.innerText = clientView.level + '/' + (clientView.totalRounds || 3);
  }

  if (clientView.toastId && clientView.toastId !== lastToastId) {
    lastToastId = clientView.toastId;
    displayToast(clientView.toastText);
  }

  if (clientView.phase === 'gameover') {
    const info = clientView.gameoverInfo || {};
    document.getElementById('winner-name').innerText = info.winnerName || '-';
    document.getElementById('final-level').innerText = info.level || clientView.level;
    document.getElementById('final-score').innerText = info.score || clientView.score;
    document.getElementById('gameover-title').innerText = info.title || 'GAME OVER';
    gameoverScreen.classList.remove('hidden');
  } else {
    gameoverScreen.classList.add('hidden');
  }

  if (clientView.phase === 'levelup') {
    levelupScreen.classList.remove('hidden');
  } else {
    levelupScreen.classList.add('hidden');
  }
}

// ================= TOMBOL NAVIGASI =================
btnStart.addEventListener('click', () => {
  ensureAudio();

  if (currentMode === 'online-join') {
    const targetRoom = roomIdInput.value.trim();
    if (!targetRoom) { showToast('Harap masukkan kode room!'); return; }
    connectToHost(targetRoom);
    menuScreen.classList.add('hidden');
    showToast('Menghubungkan ke room...');
    attemptLockLandscape();
    return; // Klien menunggu data dari host, tidak menjalankan simulasi sendiri
  }

  if (currentMode === 'online-host') {
    if (conn && conn.open) {
      // Lawan sudah lebih dulu bergabung -> langsung mulai
      startLocalMatch();
    } else {
      // Belum ada lawan: jangan mulai timer dulu, tunggu sampai ada yang gabung.
      // Duel akan otomatis dimulai begitu lawan connect (lihat initHostPeer).
      showToast('Menunggu lawan bergabung... Bagikan kode room kamu.');
    }
    return;
  }

  startLocalMatch();
});

function startLocalMatch() {
  const roundsEl = document.getElementById('game-rounds');
  totalRounds = roundsEl ? parseInt(roundsEl.value, 10) || 3 : 3;
  roundsToWin = Math.ceil(totalRounds / 2);
  currentLevel = 1;
  winsP1 = 0;
  winsP2 = 0;
  score = 0;
  scoreVal.innerText = score;
  updateWinsUI();
  resetForLevel(currentLevel);
  menuScreen.classList.add('hidden');
  isRunning = true;
  gamePhase = 'playing';
  attemptLockLandscape();
  showToast(currentMode === 'online-host'
    ? 'Lawan bergabung! Duel dimulai.'
    : `Duel dimulai! Best of ${totalRounds}`);
}

btnPause.addEventListener('click', () => {
  if (!isRunning || networkRole === 'client') return;
  isPaused = true;
  gamePhase = 'paused';
  pauseScreen.classList.remove('hidden');
});
btnResume.addEventListener('click', () => {
  isPaused = false;
  gamePhase = 'playing';
  pauseScreen.classList.add('hidden');
});
btnRestart.addEventListener('click', () => location.reload());
btnPlayAgain.addEventListener('click', () => location.reload());
