/* Procedural placeholder character art.
   Every figure is baked once into a small offscreen canvas at load time and
   blitted thereafter, so the per-body cost on screen stays a plain drawImage
   no matter how detailed the art gets. Swap bakeBiped() for real sprite
   sheets later and nothing else in the renderer has to change. */
'use strict';

const SPRITE_SS = 2;        // supersample, keeps billboards crisp on hidpi
const WALK_FRAMES = 6;

/* Draws one humanoid billboard, feet at the bottom edge, facing the camera.
   `phase` walks the legs and arms through a stride; `pose` changes the
   silhouette enough that the four enemy types read apart in a crowd. */
function bakeBiped(o) {
  const w = o.width, h = o.height;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SPRITE_SS);
  c.height = Math.ceil(h * SPRITE_SS);
  const g = c.getContext('2d');
  g.scale(SPRITE_SS, SPRITE_SS);

  const Y = (up) => h - up;            // sprite space is y-up, canvas is y-down
  const cx = w / 2;
  const dir = o.flip ? -1 : 1;
  const swing = Math.sin(o.phase * TAU);
  const bob = Math.abs(Math.cos(o.phase * TAU)) * h * 0.022;

  const body = o.flash ? '#fff4f4' : o.color;
  const dark = o.flash ? '#ffd9d9' : o.dark;
  const skin = o.flash ? '#ffffff' : o.skin;

  const legTop = h * 0.36 + bob;
  const shoulder = h * 0.74 + bob;
  const headY = h * 0.86 + bob;
  const headR = h * 0.12;

  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Legs
  g.strokeStyle = dark;
  g.lineWidth = w * 0.17;
  const stride = w * 0.26 * (o.pose === 'heavy' ? 0.55 : 1);
  for (const s of [1, -1]) {
    const foot = swing * stride * s;
    g.beginPath();
    g.moveTo(cx, Y(legTop));
    g.lineTo(cx + foot, Y(Math.max(0, -swing * s) * h * 0.05));
    g.stroke();
  }

  // Torso
  g.fillStyle = body;
  const tw = w * (o.pose === 'heavy' ? 0.62 : 0.46);
  g.beginPath();
  if (o.pose === 'heavy') {
    // Wide skirted mass - reads as bulk even at brute scale.
    g.moveTo(cx - tw / 2, Y(legTop - h * 0.04));
    g.lineTo(cx + tw / 2, Y(legTop - h * 0.04));
    g.lineTo(cx + tw * 0.38, Y(shoulder));
    g.lineTo(cx - tw * 0.38, Y(shoulder));
  } else {
    g.moveTo(cx - tw / 2, Y(legTop));
    g.lineTo(cx + tw / 2, Y(legTop));
    g.lineTo(cx + tw * 0.44, Y(shoulder));
    g.lineTo(cx - tw * 0.44, Y(shoulder));
  }
  g.closePath();
  g.fill();

  // Arms
  g.strokeStyle = body;
  g.lineWidth = w * 0.15;
  const armLen = h * 0.2;
  if (o.pose === 'shamble') {
    // Both arms out toward the camera: the classic shuffling silhouette.
    for (const s of [1, -1]) {
      g.beginPath();
      g.moveTo(cx + s * tw * 0.42, Y(shoulder));
      g.lineTo(cx + s * tw * 0.58, Y(shoulder - armLen * 0.85 + swing * s * h * 0.02));
      g.stroke();
    }
    g.fillStyle = skin;
    for (const s of [1, -1]) {
      g.beginPath();
      g.arc(cx + s * tw * 0.58, Y(shoulder - armLen * 0.85), w * 0.08, 0, TAU);
      g.fill();
    }
  } else {
    for (const s of [1, -1]) {
      const sw = -swing * s * (o.pose === 'heavy' ? 0.5 : 1);
      g.beginPath();
      g.moveTo(cx + s * tw * 0.44, Y(shoulder));
      g.lineTo(cx + s * tw * 0.5 + sw * w * 0.2, Y(shoulder - armLen));
      g.stroke();
    }
  }

  // Head
  g.fillStyle = skin;
  g.beginPath();
  g.arc(cx, Y(headY), headR, 0, TAU);
  g.fill();

  if (o.hat) {
    g.fillStyle = dark;
    g.beginPath();
    g.arc(cx, Y(headY + headR * 0.28), headR * 0.98, Math.PI, TAU);
    g.fill();
    g.fillRect(cx - headR * 1.15, Y(headY + headR * 0.3), headR * 2.3, headR * 0.28);
  }

  // A facing cue so flipped sprites read as turning.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(cx + dir * headR * 0.42, Y(headY + headR * 0.06), headR * 0.17, 0, TAU);
  g.fill();

  return { canvas: c, w, h };
}

/* type -> [facing][frame] plus a matching flash set, built once up front. */
const characterSprites = {};

function buildCharacterSprites() {
  const looks = {
    grunt:  { width: 20, height: 30, color: '#7e9a5a', dark: '#4c6135', skin: '#b9c98f', pose: 'shamble' },
    runner: { width: 19, height: 29, color: '#d2703f', dark: '#8a4220', skin: '#e8a271', pose: 'run' },
    tank:   { width: 27, height: 40, color: '#6f7fae', dark: '#3d4a72', skin: '#9fadd4', pose: 'heavy' },
    brute:  { width: 56, height: 78, color: '#c8496a', dark: '#7d2340', skin: '#e79ab0', pose: 'heavy', hat: true },
    player: { width: 24, height: 36, color: '#2ad4c8', dark: '#0f3b42', skin: '#eafdff', pose: 'run', hat: true },
    ally:   { width: 40, height: 60, color: '#8a9a6b', dark: '#2f3a2a', skin: '#d9c9a8', pose: 'heavy', hat: true }
  };

  for (const type in looks) {
    const look = looks[type];
    const set = { normal: [[], []], flash: [[], []] };
    for (let flip = 0; flip < 2; flip++) {
      for (let f = 0; f < WALK_FRAMES; f++) {
        const base = Object.assign({}, look, { phase: f / WALK_FRAMES, flip: !!flip });
        set.normal[flip].push(bakeBiped(base));
        set.flash[flip].push(bakeBiped(Object.assign({}, base, { flash: true })));
      }
    }
    characterSprites[type] = set;
  }
}

/* Rendered frames carry their ground anchor (ox, oy in drawn pixels) and
   a drawn size scaled so the body stands the same height the placeholder
   did, which keeps hitboxes and bars where they were. Placeholders anchor
   at bottom-centre. Every draw site uses ox/oy, so both look the same to
   the renderer. */
const CHAR_HEIGHT_PX = { player: 40, grunt: 33, runner: 32, tank: 45, brute: 86, ally: 68 };
const charFrameCache = {};

function characterFrame(type, frame, flip, flash) {
  const set = typeof Assets !== 'undefined' && Assets.chars[type];
  if (set) {
    const idx = frame % set.frames.length;
    const key = type + ':' + idx + ':' + (flip ? 1 : 0) + (flash ? 1 : 0);
    let f = charFrameCache[key];
    if (f) return f;
    const meta = set.meta;
    const cosElev = Math.sqrt(1 - TILT * TILT);
    const bodyPx = meta.bodyUnits * cosElev * set.unitPx * set.ss;
    const k = CHAR_HEIGHT_PX[type] / bodyPx;
    const w = meta.w * k, h = meta.h * k;
    const ax = flip ? 1 - meta.anchorX : meta.anchorX;
    f = { canvas: set.frames[idx][(flip ? 1 : 0) + (flash ? 2 : 0)], w, h, ox: ax * w, oy: meta.anchorY * h, rendered: true };
    charFrameCache[key] = f;
    return f;
  }
  const bank = flash ? characterSprites[type].flash : characterSprites[type].normal;
  const p = bank[flip ? 1 : 0][frame % WALK_FRAMES];
  if (p.ox === undefined) { p.ox = p.w / 2; p.oy = p.h; }
  return p;
}
