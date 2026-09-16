/* Pacing for the 5 minute mockup stage: a constantly rising trickle plus
   scripted surges that dump a whole horde in from one edge of the arena. */
'use strict';

const STAGE_DURATION = 300;

class WaveDirector {
  constructor(arena) {
    this.arena = arena || ARENAS[0];
    this.elapsed = 0;
    this.lanes = [];
    this.laneTimer = 0;
    this.spawnCredit = 0;
    this.nextSurge = 22;
    this.surgeIndex = 0;
    this.finaleFired = false;
  }

  get progress() { return clamp(this.elapsed / STAGE_DURATION, 0, 1); }
  get wave() { return this.surgeIndex; }
  get hpScale() { return 1 + this.progress * 1.45; }

  /* Enemy mix widens as the stage goes on. */
  rollType() {
    const t = this.elapsed;
    const r = Math.random();
    if (t < 40) return r < 0.9 ? 'grunt' : 'runner';
    if (t < 95) return r < 0.66 ? 'grunt' : 'runner';
    if (t < 170) return r < 0.5 ? 'grunt' : r < 0.82 ? 'runner' : 'tank';
    return r < 0.42 ? 'grunt' : r < 0.72 ? 'runner' : 'tank';
  }

  /* Baseline spawns per second, defined per arena. */
  rate() {
    return this.arena.spawnRate(this.progress);
  }

  /* A handful of edge points that persist for a few seconds each. Feeding the
     trickle through them turns a random sprinkle into thick marching columns,
     which is what makes the crowd read as a hoard rather than as confetti. */
  updateLanes(dt, game) {
    this.laneTimer -= dt;
    const want = 2 + Math.round(this.progress * 2);
    if (this.laneTimer <= 0 || this.lanes.length !== want) {
      this.laneTimer = rand(7, 12);
      this.lanes = [];
      for (let i = 0; i < want; i++) this.lanes.push(game.edgePoint(randInt(0, 3)));
    }
  }

  update(dt, game) {
    this.elapsed += dt;
    this.updateLanes(dt, game);

    this.spawnCredit += this.rate() * dt;
    while (this.spawnCredit >= 1) {
      this.spawnCredit -= 1;
      const lane = pick(this.lanes);
      game.spawnEnemy(this.rollType(), lane.x + rand(-55, 55), lane.y + rand(-55, 55));
    }

    if (this.elapsed >= this.nextSurge && this.elapsed < STAGE_DURATION - 6) {
      this.surge(game);
      this.nextSurge = this.elapsed + lerp(30, 19, this.progress);
    }

    if (!this.finaleFired && this.elapsed >= STAGE_DURATION - 70) {
      this.finaleFired = true;
      game.announce('FINAL ASSAULT', '#ff7a6b');
      for (let side = 0; side < 4; side++) game.spawnCluster(this.rollType(), 90, side);
      for (let i = 0; i < 3; i++) game.spawnAtEdge('brute');
    }
  }

  surge(game) {
    this.surgeIndex++;
    const count = Math.round(lerp(60, 220, this.progress));
    const side = randInt(0, 3);
    const type = this.rollType();
    game.spawnCluster(type, count, side);
    if (this.elapsed > 110) {
      const brutes = 1 + Math.floor(this.progress * 3);
      for (let i = 0; i < brutes; i++) game.spawnCluster('brute', 1, side);
    }
    game.announce('HORDE ' + this.surgeIndex, '#ffd67a');
  }
}
