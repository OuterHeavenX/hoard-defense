/* The camp: what persists between runs.

   A share of every run's gold is banked, and the bank buys permanent
   upgrades. Each upgrade lands on the same multipliers the perk draft uses,
   so the simulation has one place per stat to read from regardless of
   whether the boost came from the camp or from a mid-run pick. */
'use strict';

const BANK_SHARE = 0.32;     // of gold collected in a run, kept afterwards

const CAMP_UPGRADES = [
  {
    id: 'plating', name: 'REINFORCED PLATING', max: 5,
    desc: '+15 max health per rank.',
    cost: (n) => 400 + n * 350,
    apply: (g, n) => { g.player.maxHp += 15 * n; g.player.hp = g.player.maxHp; }
  },
  {
    id: 'advance', name: 'ADVANCE PARTY', max: 3,
    desc: 'One node per rank is already built to tier 1 when you deploy.',
    cost: (n) => 900 + n * 700,
    apply: (g, n) => {
      const order = g.nodes.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(n, order.length); i++) order[i].level = 1;
    }
  },
  {
    id: 'coil', name: 'MAGNET COIL', max: 3,
    desc: 'Gold pulls in from 20% further per rank.',
    cost: (n) => 350 + n * 300,
    apply: (g, n) => { g.player.magnetRadius *= 1 + 0.2 * n; }
  },
  {
    id: 'fence', name: 'STANDING FENCE', max: 3,
    desc: 'Every coin is worth 10% more per rank.',
    cost: (n) => 600 + n * 500,
    apply: (g, n) => { g.goldMul *= 1 + 0.1 * n; }
  },
  {
    id: 'quickdraw', name: 'QUICK DRAW', max: 3,
    desc: 'Fire 8% faster per rank.',
    cost: (n) => 550 + n * 450,
    apply: (g, n) => { g.player.fireInterval *= Math.pow(0.92, n); }
  },
  {
    id: 'stamina', name: 'STAMINA', max: 3,
    desc: 'Dash recharges 12% sooner per rank.',
    cost: (n) => 450 + n * 350,
    apply: (g, n) => { g.player.dashCooldownMax *= Math.pow(0.88, n); }
  },
  {
    id: 'draft', name: 'WIDER DRAFT', max: 1,
    desc: 'Level-ups offer four perks instead of three.',
    cost: () => 2400,
    apply: (g) => { g.draftSize = 4; }
  },
  {
    id: 'revive', name: 'SECOND CHANCE', max: 1,
    desc: 'Once per run, death instead restores you to 40% health.',
    cost: () => 3200,
    apply: (g) => { g.revives = 1; }
  }
];

const Camp = {
  bank: 0,
  ranks: {},

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem('hoard.camp') || '{}') || {};
      this.bank = Math.max(0, Math.floor(saved.bank || 0));
      this.ranks = saved.ranks || {};
    } catch (e) {
      this.bank = 0;
      this.ranks = {};
    }
  },

  save() {
    try {
      localStorage.setItem('hoard.camp', JSON.stringify({ bank: this.bank, ranks: this.ranks }));
    } catch (e) { /* private mode - the run still plays, it just won't persist */ }
  },

  rank(id) { return this.ranks[id] || 0; },

  nextCost(up) {
    const n = this.rank(up.id);
    return n >= up.max ? 0 : up.cost(n);
  },

  canBuy(up) {
    const cost = this.nextCost(up);
    return cost > 0 && this.bank >= cost;
  },

  buy(up) {
    if (!this.canBuy(up)) return false;
    this.bank -= this.nextCost(up);
    this.ranks[up.id] = this.rank(up.id) + 1;
    this.save();
    return true;
  },

  /* Called once per run at deploy; ranks turn into concrete stat changes. */
  applyTo(game) {
    for (const up of CAMP_UPGRADES) {
      const n = this.rank(up.id);
      if (n > 0) up.apply(game, n);
    }
  },

  /* A run's takings, banked. Returns the amount kept so the result screen
     can show it. */
  deposit(goldCollected) {
    const kept = Math.floor(goldCollected * BANK_SHARE);
    this.bank += kept;
    this.save();
    return kept;
  }
};

/* Best run per stage, shown on the stage select. */
const Records = {
  best: {},

  load() {
    try { this.best = JSON.parse(localStorage.getItem('hoard.best') || '{}') || {}; }
    catch (e) { this.best = {}; }
  },

  /* Returns which fields improved, so the result screen can call them out. */
  submit(arenaId, run) {
    const prev = this.best[arenaId] || {};
    const improved = [];
    const next = Object.assign({}, prev);
    for (const key of ['kills', 'level', 'survived']) {
      if ((run[key] || 0) > (prev[key] || 0)) { next[key] = run[key]; improved.push(key); }
    }
    if (run.cleared && !prev.cleared) { next.cleared = true; improved.push('cleared'); }
    this.best[arenaId] = next;
    try { localStorage.setItem('hoard.best', JSON.stringify(this.best)); } catch (e) { /* ignore */ }
    return improved;
  }
};
