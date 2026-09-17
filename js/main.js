/* Bootstrap: canvas sizing, the fixed-step loop, menus, settings and HUD. */
'use strict';

(function () {
  const canvas = document.getElementById('game');
  const hud = {
    root: document.getElementById('hud'),
    hpFill: document.getElementById('hp-fill'),
    hpText: document.getElementById('hp-text'),
    gold: document.getElementById('gold'),
    timer: document.getElementById('timer'),
    wave: document.getElementById('wave'),
    kills: document.getElementById('kills'),
    dash: document.getElementById('dash'),
    xpFill: document.getElementById('xp-fill'),
    xpText: document.getElementById('xp-text')
  };
  const overlay = document.getElementById('overlay');
  const panels = {
    title: document.getElementById('panel-title'),
    howto: document.getElementById('panel-howto'),
    settings: document.getElementById('panel-settings'),
    camp: document.getElementById('panel-camp'),
    stages: document.getElementById('panel-stages'),
    levelup: document.getElementById('panel-levelup'),
    paused: document.getElementById('panel-paused'),
    result: document.getElementById('panel-result')
  };
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');

  buildCharacterSprites();
  Progress.load();
  Camp.load();
  Records.load();

  const game = new Game(canvas, hud);
  // Art arrives after construction; rebuild the floor once it has, so the
  // title's attract battle plays on the rendered tile rather than the fallback.
  Assets.load(() => game.setArena(game.arena));
  const music = new Music(game.audio);
  window.__game = game;   // handy for tinkering from the console
  window.__music = music;

  // Canvas backing resolution is capped per quality preset. A 4K monitor
  // otherwise means every full-screen pass touches 8M pixels a frame; the
  // game is upscaled by the browser from the cap instead, which is what
  // real games do and is invisible at this art scale.
  const BACKING_CAP = { low: 1280, medium: 1920, high: 2560 };
  let quality = 'medium';
  try { const q = localStorage.getItem('hoard.quality'); if (BACKING_CAP[q]) quality = q; } catch (e) { /* private mode */ }

  function resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2, BACKING_CAP[quality] / w);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    game.resize(w, h, dpr);
  }
  addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------- settings

  let shakeEnabled = true;
  try {
    shakeEnabled = localStorage.getItem('hoard.shake') !== 'off';
  } catch (e) { /* private mode */ }
  game.shakeEnabled = shakeEnabled;

  let lightingEnabled = true;
  try { lightingEnabled = localStorage.getItem('hoard.lighting') !== 'off'; } catch (e) { /* private mode */ }
  game.lightingEnabled = lightingEnabled;
  const lightingBtn = document.getElementById('opt-lighting');

  // Quality preset: backing cap plus the cost knobs the renderer reads.
  const qualityBtns = [...document.querySelectorAll('[data-quality]')];
  function applyQuality(q) {
    quality = q;
    game.quality = q;
    try { localStorage.setItem('hoard.quality', q); } catch (e) { /* ignore */ }
    for (const b of qualityBtns) b.setAttribute('aria-pressed', String(b.dataset.quality === q));
    resize();
  }
  for (const b of qualityBtns) b.addEventListener('click', () => { game.audio.click(); applyQuality(b.dataset.quality); });
  applyQuality(quality);

  // FPS readout, off by default.
  let showFps = false;
  try { showFps = localStorage.getItem('hoard.fps') === 'on'; } catch (e) { /* ignore */ }
  const fpsBtn = document.getElementById('opt-fps');
  const fpsChip = document.getElementById('fps');
  paintToggle(fpsBtn, showFps);
  fpsChip.classList.toggle('hidden', !showFps);
  fpsBtn.addEventListener('click', () => {
    showFps = !showFps;
    paintToggle(fpsBtn, showFps);
    fpsChip.classList.toggle('hidden', !showFps);
    try { localStorage.setItem('hoard.fps', showFps ? 'on' : 'off'); } catch (e) { /* ignore */ }
    game.audio.click();
  });

  // Camera distance: persisted, adjustable from settings and from the HUD.
  // A new key: the distance this number means changed when the camera became
  // a follow camera, so an old saved value would frame the game differently
  // from anything that was tested.
  let zoom = 1.0;
  try { const z = parseFloat(localStorage.getItem("hoard.zoom3")); if (z >= 0.45 && z <= 1.3) zoom = z; } catch (e) { /* private mode */ }
  const zoomSlider = document.getElementById('opt-zoom');
  function applyZoom(z) {
    zoom = game.setZoom(z);
    zoomSlider.value = String(Math.round(zoom * 100));
    try { localStorage.setItem('hoard.zoom3', String(zoom)); } catch (e) { /* ignore */ }
  }
  applyZoom(zoom);
  zoomSlider.addEventListener('input', () => applyZoom(Number(zoomSlider.value) / 100));
  document.getElementById('btn-zoom-out').addEventListener('click', () => { game.audio.click(); applyZoom(zoom - 0.1); });
  document.getElementById('btn-zoom-in').addEventListener('click', () => { game.audio.click(); applyZoom(zoom + 0.1); });

  const soundBtn = document.getElementById('opt-sound');
  const shakeBtn = document.getElementById('opt-shake');
  const volume = document.getElementById('opt-volume');
  const musicBtn = document.getElementById('opt-music');
  const musicVol = document.getElementById('opt-music-volume');

  function paintToggle(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'ON' : 'OFF';
  }
  paintToggle(soundBtn, game.audio.enabled);
  paintToggle(shakeBtn, shakeEnabled);
  paintToggle(lightingBtn, lightingEnabled);
  lightingBtn.addEventListener('click', () => {
    lightingEnabled = !lightingEnabled;
    game.lightingEnabled = lightingEnabled;
    paintToggle(lightingBtn, lightingEnabled);
    try { localStorage.setItem('hoard.lighting', lightingEnabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
    game.audio.click();
  });

  // The on-screen pause: the only way to pause on touch.
  document.getElementById('btn-pause').addEventListener('click', () => {
    if (game.state !== 'playing') return;
    game.audio.click();
    game.state = 'paused';
  });
  volume.value = String(Math.round(game.audio.volume * 100));
  paintToggle(musicBtn, music.enabled);
  musicVol.value = String(Math.round(music.volume * 100));

  musicBtn.addEventListener('click', () => {
    music.setEnabled(!music.enabled);
    paintToggle(musicBtn, music.enabled);
    game.audio.click();
  });
  musicVol.addEventListener('input', () => music.setVolume(Number(musicVol.value) / 100));

  soundBtn.addEventListener('click', () => {
    game.audio.setEnabled(!game.audio.enabled);
    paintToggle(soundBtn, game.audio.enabled);
    game.audio.click();
  });
  shakeBtn.addEventListener('click', () => {
    shakeEnabled = !shakeEnabled;
    game.shakeEnabled = shakeEnabled;
    paintToggle(shakeBtn, shakeEnabled);
    try { localStorage.setItem('hoard.shake', shakeEnabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
    game.audio.click();
  });
  volume.addEventListener('input', () => {
    game.audio.setVolume(Number(volume.value) / 100);
  });
  volume.addEventListener('change', () => game.audio.coin());

  // --------------------------------------------------------------- panels

  let panel = 'title';

  function showPanel(name) {
    panel = name;
    overlay.classList.toggle('hidden', name === null);
    overlay.classList.toggle('title-mode', name === 'title');
    // HUD belongs to a run, not to the menus stacked on the title screen.
    const inMenus = name === 'title' || name === 'howto' || name === 'settings' || name === 'stages' || name === 'camp';
    hud.root.classList.toggle('hidden', inMenus);
    for (const key in panels) panels[key].classList.toggle('hidden', key !== name);
  }

  /* Audio can only start from a gesture, so every button unlocks it. */
  function gesture() {
    game.audio.unlock();
    game.audio.click();
    music.start();
  }

  function toTitle() {
    game.startAttract();
    showPanel('title');
  }

  let currentArena = ARENAS[0];

  function startGame(arena) {
    currentArena = arena || currentArena;
    game.start(currentArena);
    game.shakeEnabled = shakeEnabled;
    showPanel(null);
  }

  const campBank = document.getElementById('camp-bank');
  const campList = document.getElementById('camp-list');

  function buildCamp() {
    campBank.textContent = Camp.bank;
    campList.innerHTML = '';
    for (const up of CAMP_UPGRADES) {
      const rank = Camp.rank(up.id);
      const cost = Camp.nextCost(up);
      const row = document.createElement('div');
      row.className = 'camp-row' + (rank >= up.max ? ' maxed' : '');
      const pips = Array.from({ length: up.max }, (_, i) =>
        '<i class="' + (i < rank ? 'on' : '') + '"></i>').join('');
      row.innerHTML = '<div class="camp-info"><b>' + up.name + '</b><span>' + up.desc + '</span>' +
        '<div class="pips">' + pips + '</div></div>';
      const btn = document.createElement('button');
      btn.className = 'camp-buy';
      if (Camp.isLocked(up)) {
        const need = arenaById(up.requires).name;
        row.classList.add('locked');
        row.querySelector('span').textContent += ' Clear ' + need + ' to unlock.';
        btn.textContent = 'LOCKED';
        btn.disabled = true;
      } else if (rank >= up.max) {
        btn.textContent = 'MAXED';
        btn.disabled = true;
      } else {
        btn.innerHTML = cost + ' <small>gold</small>';
        btn.disabled = !Camp.canBuy(up);
        btn.addEventListener('click', () => {
          if (!Camp.buy(up)) return;
          game.audio.upgrade();
          buildCamp();
        });
      }
      row.appendChild(btn);
      campList.appendChild(row);
    }
  }

  document.getElementById('btn-camp').addEventListener('click', () => {
    gesture();
    buildCamp();
    showPanel('camp');
  });

  /* Rebuilt each time it opens so clears unlock without a reload. */
  function buildStageList() {
    const list = document.getElementById('stage-list');
    list.innerHTML = '';
    ARENAS.forEach((arena, i) => {
      const unlocked = Progress.isUnlocked(i);
      const cleared = !!Progress.cleared[arena.id];
      const btn = document.createElement('button');
      btn.className = 'stage';
      btn.disabled = !unlocked;
      const tag = cleared ? '<span class="tag cleared">CLEARED</span>'
        : unlocked ? '<span class="tag">AVAILABLE</span>'
        : '<span class="tag locked">CLEAR ' + ARENAS[i - 1].name + ' TO UNLOCK</span>';
      const best = Records.best[arena.id];
      const bestLine = best && best.kills
        ? '<em class="best">BEST &middot; ' + best.kills + ' kills &middot; lv ' + (best.level || 1) +
          ' &middot; ' + formatTime(best.survived || 0) + ' survived</em>'
        : '';
      btn.innerHTML = '<b>' + arena.name + '</b><i>' + arena.blurb + '</i>' + bestLine + tag;
      btn.addEventListener('click', () => { gesture(); startGame(arena); });
      list.appendChild(btn);
    });
  }

  document.getElementById('btn-play').addEventListener('click', () => {
    gesture();
    buildStageList();
    showPanel('stages');
  });
  document.getElementById('btn-howto').addEventListener('click', () => { gesture(); showPanel('howto'); });
  document.getElementById('btn-settings').addEventListener('click', () => { gesture(); showPanel('settings'); });
  for (const back of document.querySelectorAll('.back')) {
    back.addEventListener('click', () => { gesture(); showPanel('title'); });
  }
  document.getElementById('btn-resume').addEventListener('click', () => {
    gesture();
    game.state = 'playing';
    showPanel(null);
  });
  document.getElementById('btn-restart').addEventListener('click', () => { gesture(); startGame(); });
  document.getElementById('btn-retry').addEventListener('click', () => { gesture(); startGame(); });
  document.getElementById('btn-quit').addEventListener('click', () => { gesture(); toTitle(); });
  document.getElementById('btn-title').addEventListener('click', () => { gesture(); toTitle(); });

  const perkList = document.getElementById('perk-list');
  const levelupTitle = document.getElementById('levelup-title');

  function showDraft(choices) {
    levelupTitle.textContent = 'LEVEL ' + game.level;
    perkList.innerHTML = '';
    for (const perk of choices) {
      const held = game.perkStacks[perk.id] || 0;
      const btn = document.createElement('button');
      btn.className = 'perk';
      btn.innerHTML = '<b>' + perk.name + '</b><i>' + perk.desc + '</i>' +
        '<span class="stacks">' + (held ? 'OWNED ' + held + '/' + perk.max : 'NEW') + '</span>';
      btn.addEventListener('click', () => {
        game.audio.click();
        game.choosePerk(perk);
        showPanel(null);
      });
      perkList.appendChild(btn);
    }
    showPanel('levelup');
  }

  function syncOverlay() {
    if (game.state === 'playing') return showPanel(null);
    if (game.state === 'paused') return showPanel('paused');
    if (game.state === 'levelup') return;   // showDraft owns this panel
    if (game.state === 'menu') return showPanel(panel === null ? 'title' : panel);

    const won = game.state === 'won';
    resultTitle.textContent = won ? 'STAGE CLEARED' : 'OVERRUN';
    resultTitle.className = won ? 'win' : 'lose';
    const built = game.nodes.reduce((sum, n) => sum + n.level, 0);
    const perks = Object.entries(game.perkStacks)
      .map(([id, n]) => (PERKS.find((p) => p.id === id) || {}).name + (n > 1 ? ' x' + n : ''))
      .join(', ') || 'none';
    const tail = `<b>${Math.floor(game.goldBanked)}</b> gold &middot; <b>${built}</b> node levels &middot; level <b>${game.level}</b>` +
      `<br><span class="perk-summary">${perks}</span>`;
    const summary = game.runSummary || { kept: 0, improved: [] };
    const bestNames = { kills: 'MOST KILLS', level: 'HIGHEST LEVEL', survived: 'LONGEST HELD', cleared: 'FIRST CLEAR' };
    const bests = summary.improved.map((k) => bestNames[k]).filter(Boolean);
    const bank = `<div class="banked">+<b>${summary.kept}</b> gold banked at camp &middot; <b>${Camp.bank}</b> total</div>` +
      (bests.length ? `<div class="newbest">NEW BEST &middot; ${bests.join(' &middot; ')}</div>` : '');
    resultBody.innerHTML = (won
      ? `${game.arena.name} cleared. <b>${game.kills}</b> kills, and ${game.arena.ally ? 'the Warden fell at the top of the stairs' : 'the boss went down'}.<br>${tail}`
      : `The hoard broke through at <b>${formatTime(STAGE_DURATION - game.timeLeft)}</b> after <b>${game.kills}</b> kills.<br>${tail}`) + bank;
    if (won) game.audio.victory(); else game.audio.defeat();
    showPanel('result');
  }

  // ------------------------------------------------------------------ HUD

  let lastHud = '';
  function updateHud() {
    if (game.state === 'menu') return;
    const p = game.player;
    const pct = clamp(p.hp / p.maxHp, 0, 1);
    hud.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    hud.hpFill.classList.toggle('low', pct < 0.35);

    hud.xpFill.style.width = (clamp(game.xp / game.xpNeeded, 0, 1) * 100).toFixed(1) + '%';

    const signature = [
      Math.ceil(Math.max(0, p.hp)), Math.floor(p.gold), Math.ceil(game.timeLeft),
      game.director.wave, game.kills, p.dashCooldown > 0, game.level
    ].join('|');
    if (signature === lastHud) return;
    lastHud = signature;

    hud.hpText.textContent = Math.ceil(Math.max(0, p.hp)) + ' / ' + p.maxHp;
    hud.gold.textContent = Math.floor(p.gold);
    hud.timer.textContent = game.boss ? 'KILL IT' : formatTime(game.timeLeft);
    hud.wave.textContent = game.director.wave;
    hud.kills.textContent = game.kills;
    hud.dash.classList.toggle('cooling', p.dashCooldown > 0);
    hud.xpText.textContent = 'LV ' + game.level;
  }

  // ----------------------------------------------------------------- loop

  const STEP = 1 / 60;
  let accumulator = 0;
  let previous = performance.now();
  let previousState = game.state;
  let fpsAvg = 60, fpsTick = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    // Clamp so a backgrounded tab doesn't unleash a spiral of catch-up steps.
    const elapsed = Math.min((now - previous) / 1000, 0.25);
    previous = now;
    if (showFps) {
      fpsAvg += ((elapsed > 0 ? 1 / elapsed : 60) - fpsAvg) * 0.08;
      if (++fpsTick % 10 === 0) fpsChip.textContent = Math.round(fpsAvg) + ' FPS';
    }

    if (game.input.takePause() && game.state !== 'menu' && game.state !== 'levelup') {
      if (game.state === 'playing') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'playing';
    }

    if (game.state === 'playing') {
      accumulator += elapsed;
      let steps = 0;
      // At most three catch-up steps: on a slow frame, three sims plus a
      // draw is already more than the frame budget, and a fourth makes the
      // next frame slower still - the spiral that reads as stutter.
      while (accumulator >= STEP && steps < 3) {
        game.update(STEP);
        accumulator -= STEP;
        steps++;
      }
      if (steps === 3) accumulator = 0;

      // Drafted between frames so a level-up never lands mid-step.
      const choices = game.takeLevelUp();
      if (choices) showDraft(choices);
    } else if (game.state === 'menu') {
      game.updateAttract(Math.min(elapsed, STEP * 3));
      accumulator = 0;
    } else {
      accumulator = 0;
    }

    game.draw();
    updateHud();

    music.intensity = game.intensity();
    music.setMode(game.state === 'playing' || game.state === 'paused' || game.state === 'levelup' ? 'battle' : 'title');
    music.setDucked(game.state === 'paused' || game.state === 'levelup');

    if (game.state !== previousState) {
      previousState = game.state;
      syncOverlay();
    }
  }

  addEventListener('blur', () => {
    if (game.state === 'playing') game.state = 'paused';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') game.state = 'paused';
  });

  toTitle();
  syncOverlay();
  requestAnimationFrame(frame);
})();
