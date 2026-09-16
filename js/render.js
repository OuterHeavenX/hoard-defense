/* 2.5D renderer.

   The simulation stays a flat top-down plane; only drawing is projected.
   Screen Y is world Y * TILT minus the body's height, which tilts the ground
   away from the camera and stands characters upright on it. Everything that
   touches the floor is then drawn back-to-front so near bodies overlap far
   ones - with a thousand of them, that ordering is what sells the depth. */
'use strict';

const VIEW_MARGIN = 90;
const TOWER_SCALE = 0.75;           // rendered tower sprites, relative to native
const ROW_HEIGHT = 20;              // depth-sort bucket granularity, world units
const ROW_COUNT = Math.ceil(MAX_WORLD_H / ROW_HEIGHT) + 2;

Game.prototype.draw = function () {
  const ctx = this.ctx;
  const { w, h } = this.view;
  const screen = this.screen;
  const dpr = this.dpr;
  const zoom = dpr * this.scale;

  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  ctx.fillStyle = '#15170f';
  ctx.fillRect(0, 0, w, h);

  const shake = this.shakeEnabled ? this.shake : 0;
  const shakeX = shake ? rand(-shake, shake) : 0;
  const shakeY = shake ? rand(-shake, shake) : 0;
  const camX = this.camera.x - w / 2 + shakeX;
  const camPY = this.camera.y * TILT - h / 2 + shakeY;
  this._camX = camX;
  this._camPY = camPY;

  ctx.save();
  ctx.translate(-camX, -camPY);

  this.drawGround(ctx);
  this.drawStairs(ctx);
  this.drawDecals(ctx);
  this.drawNodePads(ctx);
  this.drawShadows(ctx, camX, camPY, w, h);
  this.drawSortedBodies(ctx, camX, camPY, w, h);
  this.drawBullets(ctx);
  this.drawParticles(ctx);
  this.drawNova(ctx);
  this.drawMuzzle(ctx);
  this.drawNumbers(ctx);

  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.drawVignette(ctx, screen.w, screen.h);
  this.drawBanner(ctx, screen.w, screen.h);
  this.drawMinimap(ctx, screen.w, screen.h);
  this.drawBossBar(ctx, screen.w, screen.h);
  this.drawNodeMarkers(ctx, screen.w, screen.h);
  this.drawTouchStick(ctx);
};

/* The floor is the one thing drawn in squashed space, so its texture
   foreshortens with the plane instead of sliding across it. */
Game.prototype.drawGround = function (ctx) {
  ctx.save();
  ctx.scale(1, TILT);
  ctx.fillStyle = this.ground;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = 'rgba(120,130,96,0.06)';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();

  // Border drawn unsquashed so the line keeps an even weight all the way round.
  ctx.strokeStyle = this.arena.border;
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H * TILT);
};

Game.prototype.drawNodePads = function (ctx) {
  for (const node of this.nodes) {
    const active = this.activeNode === node;
    const py = node.y * TILT;
    const rx = node.padRadius, ry = node.padRadius * TILT;

    ctx.fillStyle = node.level > 0 ? 'rgba(80,170,210,0.13)' : 'rgba(255,214,122,0.10)';
    ctx.beginPath();
    ctx.ellipse(node.x, py, rx, ry, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = active ? '#ffe9a8'
      : node.level > 0 ? 'rgba(143,216,255,0.6)' : 'rgba(255,214,122,0.45)';
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.ellipse(node.x, py, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!node.maxed && node.invested > 0) {
      ctx.strokeStyle = '#ffd67a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(node.x, py, rx - 7, (rx - 7) * TILT, 0,
        -Math.PI / 2, -Math.PI / 2 + TAU * (node.invested / node.nextCost));
      ctx.stroke();
    }

    if (node.pulse > 0) {
      const grow = (1 - node.pulse) * 90;
      ctx.strokeStyle = `rgba(143,216,255,${node.pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(node.x, py, rx + grow, (rx + grow) * TILT, 0, 0, TAU);
      ctx.stroke();
    }
  }
};

/* One flat pass for every ground shadow, before any body is drawn, so a
   shadow can never land on top of the figure standing in front of it. */
Game.prototype.drawShadows = function (ctx, camX, camPY, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();

  const list = this.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const py = e.y * TILT;
    if (e.x < camX - VIEW_MARGIN || e.x > camX + w + VIEW_MARGIN ||
        py < camPY - VIEW_MARGIN || py > camPY + h + VIEW_MARGIN) continue;
    const r = e.radius * e.scale * 1.15;
    ctx.moveTo(e.x + r, py);
    ctx.ellipse(e.x, py, r, r * 0.5, 0, 0, TAU);
  }

  if (!this.attract) {
    const p = this.player;
    ctx.moveTo(p.x + p.radius, p.y * TILT);
    ctx.ellipse(p.x, p.y * TILT, p.radius, p.radius * 0.42, 0, 0, TAU);
    const a = this.ally;
    if (a) {
      ctx.moveTo(a.x + a.radius * 1.2, a.y * TILT);
      ctx.ellipse(a.x, a.y * TILT, a.radius * 1.2, a.radius * 0.5, 0, 0, TAU);
    }
  }
  ctx.fill();
};

/* Bucket sort by world Y, then walk the buckets back to front. A comparison
   sort would work too, but bucketing stays linear as the crowd grows. */
Game.prototype.drawSortedBodies = function (ctx, camX, camPY, w, h) {
  let rows = this._rows;
  if (!rows) {
    rows = this._rows = new Array(ROW_COUNT);
    for (let i = 0; i < ROW_COUNT; i++) rows[i] = [];
  }
  for (let i = 0; i < ROW_COUNT; i++) if (rows[i].length) rows[i].length = 0;

  const put = (item) => {
    const py = item.y * TILT;
    if (item.x < camX - VIEW_MARGIN || item.x > camX + w + VIEW_MARGIN ||
        py < camPY - VIEW_MARGIN * 1.6 || py > camPY + h + VIEW_MARGIN) return;
    rows[clamp((item.y / ROW_HEIGHT) | 0, 0, ROW_COUNT - 1)].push(item);
  };

  const enemies = this.enemies;
  for (let i = 0; i < enemies.length; i++) put(enemies[i]);
  for (const node of this.nodes) put(node);
  for (let i = 0; i < this.coins.length; i++) put(this.coins[i]);
  if (!this.attract) put(this.player);
  if (this.ally && !this.attract) put(this.ally);

  for (let r = 0; r < ROW_COUNT; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      const item = row[i];
      switch (item.kind) {
        case 'enemy': this.drawEnemy(ctx, item); break;
        case 'node':  this.drawTurret(ctx, item); break;
        case 'coin':  this.drawCoin(ctx, item); break;
        case 'player': this.drawPlayer(ctx, item); break;
        case 'ally': this.drawAlly(ctx, item); break;
      }
    }
  }
};

Game.prototype.drawEnemy = function (ctx, e) {
  if (e.type === 'boss') return this.drawBoss(ctx, e);
  const frame = characterFrame(e.type, e.anim | 0, e.flip, e.flash > 0.35);
  const k = e.scale;
  const fw = frame.w * k, fh = frame.h * k;
  const py = e.y * TILT - e.z;
  ctx.drawImage(frame.canvas, e.x - fw / 2, py - fh, fw, fh);

  if (e.type === 'brute') {
    const pct = clamp(e.hp / e.maxHp, 0, 1);
    const barW = fw * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(e.x - barW / 2, py - fh - 9, barW, 5);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(e.x - barW / 2, py - fh - 9, barW * pct, 5);
  }
};

Game.prototype.drawBoss = function (ctx, b) {
  const py = b.y * TILT;
  const r = b.radius;
  const height = r * 2.4;

  // Telegraph ring: the wind-up before a slam or a charge.
  if (b.telegraph > 0) {
    const t = b.telegraph / 0.7;
    ctx.strokeStyle = `rgba(255,120,90,${0.35 + t * 0.5})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(b.x, py, 200 * (1.1 - t * 0.3), 200 * (1.1 - t * 0.3) * TILT, 0, 0, TAU);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(b.x, py, r * 1.1, r * 0.5, 0, 0, TAU);
  ctx.fill();

  // The boss is under fire nonstop, so a colour-swap flash would leave it a
  // featureless white slab. A translucent overlay reads as damage instead.
  const body = b.def.color;
  const dark = b.def.dark;
  const bob = Math.sin(b.anim * 0.6) * r * 0.05;

  const torso = () => {
    ctx.beginPath();
    ctx.moveTo(b.x - r, py);
    ctx.lineTo(b.x + r, py);
    ctx.lineTo(b.x + r * 0.62, py - height * 0.72 + bob);
    ctx.lineTo(b.x - r * 0.62, py - height * 0.72 + bob);
    ctx.closePath();
  };

  ctx.fillStyle = body;
  torso();
  ctx.fill();

  // Plating stripes, so the silhouette is not one flat block.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 1; i < 4; i++) {
    const yy = py - height * 0.72 * (i / 4) + bob * (i / 4);
    ctx.fillRect(b.x - r * (1 - i * 0.09), yy - 3, r * 2 * (1 - i * 0.09), 5);
  }

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(b.x, py - height * 0.85 + bob, r * 0.34, 0, TAU);
  ctx.fill();

  ctx.fillStyle = b.def.skin;
  ctx.beginPath();
  ctx.arc(b.x, py - height * 0.86 + bob, r * 0.26, 0, TAU);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(b.x + s * r * 0.11, py - height * 0.88 + bob, r * 0.05, 0, TAU);
    ctx.fill();
  }

  if (b.flash > 0) {
    ctx.globalAlpha = Math.min(0.4, b.flash * 0.4);
    ctx.fillStyle = '#ffffff';
    torso();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
};

/* Staircases cut into the corridor walls, descending from a dark doorway
   to the floor. They live inside the corridor, not beyond it: at desktop
   zoom the view is barely wider than the walls, so anything drawn outside
   them is never seen. */
const STAIR_STEPS = 5, STAIR_TREAD = 58, STAIR_RISE = 13, STAIR_DEPTH = 30;
const STAIR_LENGTH = STAIR_STEPS * STAIR_TREAD;

Game.prototype.drawWalls = function (ctx) {
  if (!this.arena.stairs) return;
  const band = 44;
  ctx.fillStyle = '#1a1d22';
  ctx.fillRect(-band, -band * TILT, band, WORLD_H * TILT + band * TILT * 2);
  ctx.fillRect(WORLD_W, -band * TILT, band, WORLD_H * TILT + band * TILT * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(-band, -band * TILT, 6, WORLD_H * TILT + band * TILT * 2);
  ctx.fillRect(WORLD_W + band - 6, -band * TILT, 6, WORLD_H * TILT + band * TILT * 2);
};

Game.prototype.drawStairs = function (ctx) {
  const stairs = this.arena.stairs;
  if (!stairs) return;
  this.drawWalls(ctx);
  for (const s of stairs) {
    const left = s.side === 'left';
    const baseY = s.y * TILT;
    // Doorway in the wall, at the top of the flight.
    const doorH = STAIR_RISE * STAIR_STEPS + 46;
    const doorX = left ? 0 : WORLD_W - 26;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(doorX, baseY - doorH - STAIR_DEPTH * TILT, 26, doorH + STAIR_DEPTH * TILT * 2);
    // Steps, top at the wall, descending into the corridor.
    for (let i = 0; i < STAIR_STEPS; i++) {
      const x = left ? 26 + i * STAIR_TREAD : WORLD_W - 26 - (i + 1) * STAIR_TREAD;
      const z = STAIR_RISE * (STAIR_STEPS - i);
      const y = baseY - z;
      ctx.fillStyle = i % 2 ? '#3a4048' : '#444b55';
      ctx.fillRect(x, y - STAIR_DEPTH * TILT, STAIR_TREAD, STAIR_DEPTH * TILT * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y - STAIR_DEPTH * TILT, STAIR_TREAD, 3);
      // Riser face below each tread, so the flight reads as height.
      ctx.fillStyle = '#23272d';
      ctx.fillRect(x, y + STAIR_DEPTH * TILT, STAIR_TREAD, STAIR_RISE);
    }
  }
};

Game.prototype.drawAlly = function (ctx, a) {
  const py = a.y * TILT;

  if (a.caged) {
    const w = 96, h = 86;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(a.x - w / 2, py - h, w, h);
  }

  const frame = characterFrame('ally', a.anim | 0, a.flip, a.hurtTimer > 0.15);
  ctx.globalAlpha = a.down ? 0.55 : 1;
  ctx.drawImage(frame.canvas, a.x - frame.w / 2, py - frame.h, frame.w, frame.h);
  ctx.globalAlpha = 1;

  if (!a.down) {
    // Gatling: three barrels fanned around the aim, rotating while spun up.
    const chest = py - frame.h * 0.52;
    const len = 34;
    const roll = a.spin > 0 ? performance.now() / 40 : 0;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const off = Math.sin(roll + i * 2.09) * 3;
      ctx.strokeStyle = i === 1 ? '#2a2e26' : '#454c40';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a.x - Math.sin(a.facing) * off, chest + Math.cos(a.facing) * off * TILT);
      ctx.lineTo(a.x + Math.cos(a.facing) * len - Math.sin(a.facing) * off,
                 chest + Math.sin(a.facing) * len * TILT + Math.cos(a.facing) * off * TILT);
      ctx.stroke();
    }
    if (a.firing) {
      ctx.fillStyle = '#fff0b8';
      ctx.beginPath();
      ctx.arc(a.x + Math.cos(a.facing) * (len + 6), chest + Math.sin(a.facing) * (len + 6) * TILT,
              5 + Math.random() * 4, 0, TAU);
      ctx.fill();
    }
  }

  if (a.caged) {
    const w = 96, h = 86;
    ctx.strokeStyle = '#8b96a8';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 6; i++) {
      const x = a.x - w / 2 + (w / 6) * i;
      ctx.beginPath();
      ctx.moveTo(x, py - h);
      ctx.lineTo(x, py + 6);
      ctx.stroke();
    }
    ctx.strokeRect(a.x - w / 2, py - h, w, h + 6);
    const lock = this.lockNode;
    const left = lock ? Math.ceil(lock.nextCost - lock.invested) : 0;
    ctx.fillStyle = 'rgba(255,233,168,0.85)';
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THE JUGGERNAUT', a.x, py - h - 24);
    ctx.fillText('LOCK  ' + left + 'g', a.x, py - h - 8);
    return;
  }

  // Health bar, and a countdown while down.
  const barW = 54;
  const top = py - frame.h - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(a.x - barW / 2, top, barW, 5);
  ctx.fillStyle = a.down ? '#8b9678' : '#8a9a6b';
  ctx.fillRect(a.x - barW / 2, top, barW * clamp(a.hp / a.maxHp, 0, 1), 5);
  if (a.down) {
    ctx.fillStyle = '#ffe9a8';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOWN ' + Math.ceil(a.downTimer), a.x, top - 6);
  }
};

Game.prototype.drawPlayer = function (ctx, p) {
  const py = p.y * TILT;

  if (p.dashTimer > 0) {
    ctx.strokeStyle = 'rgba(143,216,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(p.x, py, p.radius + 9, (p.radius + 9) * TILT, 0, 0, TAU);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(42,212,200,0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(p.x, py, p.radius + 3, (p.radius + 3) * TILT, 0, 0, TAU);
  ctx.stroke();

  const blink = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 1;
  const frame = characterFrame('player', p.anim | 0, p.flip, blink);
  ctx.drawImage(frame.canvas, p.x - frame.w / 2, py - frame.h, frame.w, frame.h);

  // Rifle, aimed in projected space so it swings around the body correctly.
  const chest = py - frame.h * 0.55;
  ctx.strokeStyle = '#1b2436';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.x, chest);
  ctx.lineTo(p.x + Math.cos(p.facing) * 24, chest + Math.sin(p.facing) * 24 * TILT);
  ctx.stroke();
};

Game.prototype.drawTurret = function (ctx, node) {
  if (node.lock) return this.drawLock(ctx, node);
  const py = node.y * TILT;
  const lit = node.level > 0;
  let height = 30 + node.level * 3;

  const sprite = Assets.tower(node.level);
  const meta = Assets.towerMeta(node.level);
  if (sprite && meta) {
    // Rendered tower, with the image's ground origin on the node and the gun
    // mounted on the walkway deck. Drawn at 75% of native scale: at full
    // size a tier-5 tower overran the pad above it on the Dust Bowl's ring.
    const k = TOWER_SCALE / Assets.manifest.ss;
    const w = meta.w * k, h = meta.h * k;
    const top = py - meta.anchorY * h;
    // The render is cut out on transparency, so it lost its ground shadow;
    // a soft ellipse trailing the sun anchors it to the floor.
    const br = meta.baseR * Assets.manifest.unitPx * TOWER_SCALE;
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(node.x + br * 0.35, py + 2, br * 1.25, br * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.drawImage(sprite, node.x - w / 2, top, w, h);
    height = (meta.anchorY - meta.deckY) * h;
  } else {
    // Procedural pedestal, kept as the fallback if the art did not load.
    ctx.fillStyle = '#3f4650';
    ctx.beginPath();
    ctx.ellipse(node.x, py, node.radius, node.radius * TILT, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lit ? '#5a6472' : '#4a4a42';
    ctx.fillRect(node.x - node.radius * 0.6, py - height, node.radius * 1.2, height);
    ctx.beginPath();
    ctx.ellipse(node.x, py - height, node.radius * 0.6, node.radius * 0.6 * TILT, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lit ? '#8fd8ff' : '#77715c';
    ctx.beginPath();
    ctx.ellipse(node.x, py - height - 6, node.radius * 0.5, node.radius * 0.5, 0, 0, TAU);
    ctx.fill();
  }

  if (lit && sprite) {
    ctx.fillStyle = '#2b3138';
    ctx.beginPath();
    ctx.ellipse(node.x, py - height - 4, 9, 9 * TILT, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#8fd8ff';
    ctx.beginPath();
    ctx.arc(node.x, py - height - 8, 4.5, 0, TAU);
    ctx.fill();
  }

  if (lit) {
    const st = node.stats;
    ctx.strokeStyle = '#3d4550';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let i = 0; i < st.barrels; i++) {
      const a = node.angle + (i - (st.barrels - 1) / 2) * 0.16;
      ctx.beginPath();
      ctx.moveTo(node.x, py - height - 6);
      ctx.lineTo(node.x + Math.cos(a) * (node.radius + 10),
                 py - height - 6 + Math.sin(a) * (node.radius + 10) * TILT);
      ctx.stroke();
    }
  }

  // Level pips, floating above the head.
  for (let i = 0; i < DefenseNode.MAX_LEVEL; i++) {
    const px = node.x + (i - (DefenseNode.MAX_LEVEL - 1) / 2) * 9;
    ctx.fillStyle = i < node.level ? '#ffd34d' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(px, py - height - 22, 3, 0, TAU);
    ctx.fill();
  }

  if (this.activeNode === node) {
    ctx.fillStyle = '#ffe9a8';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const label = node.maxed ? 'MAX LEVEL'
      : this.player.gold >= 1 ? 'DEPOSITING  ' + Math.ceil(node.nextCost - node.invested) + 'g LEFT'
      : 'NEEDS ' + Math.ceil(node.nextCost - node.invested) + 'g';
    ctx.fillText(label, node.x, py - height - 34);
  }
};

/* The cage lock: a plate on the floor in front of the bars. */
Game.prototype.drawLock = function (ctx, node) {
  const py = node.y * TILT;
  ctx.fillStyle = node.maxed ? '#5a6472' : '#4a4a42';
  ctx.beginPath();
  ctx.ellipse(node.x, py, 20, 20 * TILT, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = node.maxed ? '#7bf0a6' : '#ffd34d';
  ctx.beginPath();
  ctx.ellipse(node.x, py, 9, 9 * TILT, 0, 0, TAU);
  ctx.fill();
  if (this.activeNode === node && !node.maxed) {
    ctx.fillStyle = '#ffe9a8';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const left = Math.ceil(node.nextCost - node.invested);
    ctx.fillText(this.player.gold >= 1 ? 'BREAKING LOCK  ' + left + 'g LEFT' : 'LOCK NEEDS ' + left + 'g', node.x, py - 30);
  }
};

Game.prototype.drawCoin = function (ctx, c) {
  const py = c.y * TILT - c.z;

  if (c.pickup === 'health') {
    ctx.fillStyle = '#7bf0a6';
    ctx.fillRect(c.x - 8, py - 3, 16, 6);
    ctx.fillRect(c.x - 3, py - 8, 6, 16);
    return;
  }

  if (c.z > 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y * TILT, 4.5, 2, 0, 0, TAU);
    ctx.fill();
  }

  // Spin reads as a coin edge-on rather than a flat dot.
  const squash = Math.abs(Math.sin(c.spin)) * 0.55 + 0.45;
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.ellipse(c.x, py, 5 * squash, 5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,10,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
};

Game.prototype.drawBullets = function (ctx) {
  const list = this.bullets;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const py = b.y * TILT - b.z;
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x, py);
    ctx.lineTo(b.x - b.vx * 0.018, py - b.vy * 0.018 * TILT);
    ctx.stroke();
  }
};

Game.prototype.drawParticles = function (ctx) {
  for (const p of this.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y * TILT - p.z - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
};

/* Remains left where bodies fell. Purely cosmetic, but a battlefield that
   accumulates damage sells the scale of the hoard better than anything else
   on screen. */
Game.prototype.drawDecals = function (ctx) {
  const list = this.decals;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    ctx.globalAlpha = clamp(d.life / d.maxLife, 0, 1) * 0.42;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y * TILT, d.size, d.size * TILT, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

Game.prototype.drawNova = function (ctx) {
  const n = this.nova;
  if (!n) return;
  const t = clamp(n.life / n.maxLife, 0, 1);
  const r = n.radius * (1.1 - t * 0.35);
  ctx.strokeStyle = `rgba(42,212,200,${t})`;
  ctx.lineWidth = 5 * t + 1;
  ctx.beginPath();
  ctx.ellipse(n.x, n.y * TILT, r, r * TILT, 0, 0, TAU);
  ctx.stroke();
};

Game.prototype.drawMuzzle = function (ctx) {
  const m = this.muzzle;
  if (!m) return;
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(m.x, m.y * TILT - 20, 6, 0, TAU);
  ctx.fill();
};

Game.prototype.drawNumbers = function (ctx) {
  const list = this.numbers;
  if (!list.length) return;
  ctx.font = 'bold 17px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    ctx.globalAlpha = clamp(n.life / n.maxLife, 0, 1);
    const y = n.y * TILT - n.z;
    ctx.strokeText(n.text, n.x, y);
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, n.x, y);
  }
  ctx.globalAlpha = 1;
};

/* The boss gets a banner bar rather than the little floating bar a brute
   carries - it is the stage's win condition, so it reads at the top. */
Game.prototype.drawBossBar = function (ctx, w, h) {
  const b = this.boss;
  if (!b || !b.alive || this.attract) return;
  const barW = Math.min(520, w - 60);
  const x = (w - barW) / 2;
  const y = 78;

  ctx.fillStyle = 'rgba(10,12,8,0.78)';
  ctx.fillRect(x, y, barW, 20);
  const pct = clamp(b.hp / b.maxHp, 0, 1);
  ctx.fillStyle = '#c8496a';
  ctx.fillRect(x + 2, y + 2, (barW - 4) * pct, 16);
  ctx.strokeStyle = 'rgba(255,200,200,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, 20);

  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9e9';
  ctx.fillText(b.name, w / 2, y - 6);
};

Game.prototype.drawVignette = function (ctx, w, h) {
  const flash = this.player.hurtFlash;
  if (flash > 0 && !this.attract) {
    ctx.fillStyle = `rgba(190,40,40,${flash * 0.5})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (this.attract) return;
  const hpPct = clamp(this.player.hp / this.player.maxHp, 0, 1);
  if (hpPct < 0.35) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3,
                                       w / 2, h / 2, Math.max(w, h) * 0.65);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(120,0,0,${(0.35 - hpPct) * 1.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
};

Game.prototype.drawBanner = function (ctx, w, h) {
  if (!this.banner || this.attract) return;
  const t = this.banner.life;
  ctx.globalAlpha = clamp(t > 1.8 ? (2.2 - t) / 0.4 : Math.min(1, t / 0.6), 0, 1);
  ctx.fillStyle = this.banner.color;
  ctx.font = 'bold 42px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 6;
  ctx.strokeText(this.banner.text, w / 2, h * 0.22);
  ctx.fillText(this.banner.text, w / 2, h * 0.22);
  ctx.globalAlpha = 1;
};

Game.prototype.drawMinimap = function (ctx, w, h) {
  if (this.attract) return;
  const box = 150;
  const pad = 16;
  const k = box / Math.max(WORLD_W, WORLD_H);
  const size = WORLD_W * k, mh = WORLD_H * k;
  const x = w - size - pad;
  const y = h - mh - pad;
  const sx = k, sy = k;

  ctx.fillStyle = 'rgba(10,12,8,0.65)';
  ctx.fillRect(x, y, size, mh);
  ctx.strokeStyle = 'rgba(210,225,180,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, mh - 1);

  if (this.ally) {
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(x + this.ally.x * sx - 3, y + this.ally.y * sy - 3, 6, 6);
  }

  ctx.fillStyle = '#c8496a';
  const list = this.enemies;
  for (let i = 0; i < list.length; i += 2) {
    const e = list[i];
    ctx.fillRect(x + e.x * sx, y + e.y * sy, 1.6, 1.6);
  }

  for (const node of this.nodes) {
    ctx.fillStyle = node.level > 0 ? '#8fd8ff' : '#ffd34d';
    ctx.fillRect(x + node.x * sx - 2, y + node.y * sy - 2, 4, 4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + this.player.x * sx - 2.5, y + this.player.y * sy - 2.5, 5, 5);
};

/* Edge chevrons pointing at nodes that are off screen, so a player carrying
   gold always knows which way to run to spend it. */
Game.prototype.drawNodeMarkers = function (ctx, w, h) {
  if (this.attract) return;
  const pad = 34;
  for (const node of this.nodes) {
    if (node.maxed) continue;
    const sx = (node.x - this.camera.x) * this.scale + w / 2;
    const sy = (node.y - this.camera.y) * TILT * this.scale + h / 2;
    if (sx > pad && sx < w - pad && sy > pad && sy < h - pad) continue;

    const a = Math.atan2(sy - h / 2, sx - w / 2);
    const r = Math.min((w / 2 - pad) / Math.abs(Math.cos(a)), (h / 2 - pad) / Math.abs(Math.sin(a)));
    const x = w / 2 + Math.cos(a) * r;
    const y = h / 2 + Math.sin(a) * r;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalAlpha = this.player.gold >= node.nextCost - node.invested ? 1 : 0.5;
    ctx.fillStyle = node.level > 0 ? '#8fd8ff' : '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
};

Game.prototype.drawTouchStick = function (ctx) {
  const s = this.input.stick;
  if (!s.active) return;
  const dx = s.x - s.ox, dy = s.y - s.oy;
  const len = Math.hypot(dx, dy);
  const max = 70;
  const k = len > max ? max / len : 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(s.ox, s.oy, max, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(s.ox + dx * k, s.oy + dy * k, 26, 0, TAU);
  ctx.fill();
};
