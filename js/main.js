/* Bootstrap: canvas sizing, the fixed-step loop, HUD and overlay wiring. */
'use strict';

(function () {
  const canvas = document.getElementById('game');
  const hud = {
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
    menu: document.getElementById('panel-menu'),
    paused: document.getElementById('panel-paused'),
    result: document.getElementById('panel-result')
  };
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');

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

  function showPanel(name) {
    overlay.classList.toggle('hidden', name === null);
    for (const key in panels) panels[key].classList.toggle('hidden', key !== name);
  }

  function startGame() {
    game.start();
    showPanel(null);
  }

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-resume').addEventListener('click', () => {
    game.state = 'playing';
    showPanel(null);
  });
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-retry').addEventListener('click', startGame);

  function syncOverlay() {
    if (game.state === 'playing') return showPanel(null);
    if (game.state === 'paused') return showPanel('paused');
    if (game.state === 'menu') return showPanel('menu');

    const won = game.state === 'won';
    resultTitle.textContent = won ? 'STAGE CLEARED' : 'OVERRUN';
    resultTitle.className = won ? 'win' : 'lose';
    const built = game.nodes.reduce((sum, n) => sum + n.level, 0);
    resultBody.innerHTML = won
      ? `You held the line for the full 5:00.<br><b>${game.kills}</b> kills &middot; <b>${game.goldBanked}</b> gold collected &middot; <b>${built}</b> node levels built`
      : `The hoard broke through at <b>${formatTime(STAGE_DURATION - game.timeLeft)}</b>.<br><b>${game.kills}</b> kills &middot; <b>${game.goldBanked}</b> gold collected &middot; <b>${built}</b> node levels built`;
    showPanel('result');
  }

  let lastHud = '';
  function updateHud() {
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

  const STEP = 1 / 60;
  let accumulator = 0;
  let previous = performance.now();
  let previousState = game.state;

  function frame(now) {
    requestAnimationFrame(frame);

    // Clamp so a backgrounded tab doesn't unleash a spiral of catch-up steps.
    const elapsed = Math.min((now - previous) / 1000, 0.25);
    previous = now;

    if (game.input.takePause()) {
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

  syncOverlay();
  requestAnimationFrame(frame);
})();
