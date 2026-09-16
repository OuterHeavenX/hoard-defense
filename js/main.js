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
    dash: document.getElementById('dash')
  };
  const overlay = document.getElementById('overlay');
  const panels = {
    title: document.getElementById('panel-title'),
    howto: document.getElementById('panel-howto'),
    settings: document.getElementById('panel-settings'),
    paused: document.getElementById('panel-paused'),
    result: document.getElementById('panel-result')
  };
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');

  buildCharacterSprites();

  const game = new Game(canvas, hud);
  window.__game = game;   // handy for tinkering from the console

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
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

  const soundBtn = document.getElementById('opt-sound');
  const shakeBtn = document.getElementById('opt-shake');
  const volume = document.getElementById('opt-volume');

  function paintToggle(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'ON' : 'OFF';
  }
  paintToggle(soundBtn, game.audio.enabled);
  paintToggle(shakeBtn, shakeEnabled);
  volume.value = String(Math.round(game.audio.volume * 100));

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
    const inMenus = name === 'title' || name === 'howto' || name === 'settings';
    hud.root.classList.toggle('hidden', inMenus);
    for (const key in panels) panels[key].classList.toggle('hidden', key !== name);
  }

  /* Audio can only start from a gesture, so every button unlocks it. */
  function gesture() {
    game.audio.unlock();
    game.audio.click();
  }

  function toTitle() {
    game.startAttract();
    showPanel('title');
  }

  function startGame() {
    game.start();
    game.shakeEnabled = shakeEnabled;
    showPanel(null);
  }

  document.getElementById('btn-play').addEventListener('click', () => { gesture(); startGame(); });
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

  function syncOverlay() {
    if (game.state === 'playing') return showPanel(null);
    if (game.state === 'paused') return showPanel('paused');
    if (game.state === 'menu') return showPanel(panel === null ? 'title' : panel);

    const won = game.state === 'won';
    resultTitle.textContent = won ? 'STAGE CLEARED' : 'OVERRUN';
    resultTitle.className = won ? 'win' : 'lose';
    const built = game.nodes.reduce((sum, n) => sum + n.level, 0);
    const tail = `<b>${game.kills}</b> kills &middot; <b>${game.goldBanked}</b> gold collected &middot; <b>${built}</b> node levels built`;
    resultBody.innerHTML = won
      ? `You held the line for the full 5:00.<br>${tail}`
      : `The hoard broke through at <b>${formatTime(STAGE_DURATION - game.timeLeft)}</b>.<br>${tail}`;
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

    const signature = [
      Math.ceil(Math.max(0, p.hp)), Math.floor(p.gold), Math.ceil(game.timeLeft),
      game.director.wave, game.kills, p.dashCooldown > 0
    ].join('|');
    if (signature === lastHud) return;
    lastHud = signature;

    hud.hpText.textContent = Math.ceil(Math.max(0, p.hp)) + ' / ' + p.maxHp;
    hud.gold.textContent = Math.floor(p.gold);
    hud.timer.textContent = formatTime(game.timeLeft);
    hud.wave.textContent = game.director.wave;
    hud.kills.textContent = game.kills;
    hud.dash.classList.toggle('cooling', p.dashCooldown > 0);
  }

  // ----------------------------------------------------------------- loop

  const STEP = 1 / 60;
  let accumulator = 0;
  let previous = performance.now();
  let previousState = game.state;

  function frame(now) {
    requestAnimationFrame(frame);

    // Clamp so a backgrounded tab doesn't unleash a spiral of catch-up steps.
    const elapsed = Math.min((now - previous) / 1000, 0.25);
    previous = now;

    if (game.input.takePause() && game.state !== 'menu') {
      if (game.state === 'playing') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'playing';
    }

    if (game.state === 'playing') {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= STEP && steps < 5) {
        game.update(STEP);
        accumulator -= STEP;
        steps++;
      }
      if (steps === 5) accumulator = 0;
    } else if (game.state === 'menu') {
      game.updateAttract(Math.min(elapsed, STEP * 3));
      accumulator = 0;
    } else {
      accumulator = 0;
    }

    game.draw();
    updateHud();

    if (game.state !== previousState) {
      previousState = game.state;
      syncOverlay();
    }
  }

  addEventListener('blur', () => {
    if (game.state === 'playing') game.state = 'paused';
  });

  toTitle();
  syncOverlay();
  requestAnimationFrame(frame);
})();
