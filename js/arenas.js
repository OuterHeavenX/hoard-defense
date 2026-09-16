/* Stage definitions. Each arena owns its size, node layout, ground palette,
   spawn pressure and boss, so adding a stage is a data change rather than a
   code change. WORLD_W/WORLD_H are set from the active arena at load. */
'use strict';

/* Node positions are offsets from the arena centre. */
const ARENAS = [
  {
    id: 'dustbowl',
    name: 'THE DUST BOWL',
    blurb: 'Open ground, six nodes in a wide ring. Nowhere to hide and nothing in your way.',
    width: 1900,
    height: 1350,
    ground: { base: '#2b2f26', fleck: [[40, 70], [44, 74], [34, 56]] },
    border: 'rgba(210,225,180,0.35)',
    nodes: [
      [0, -285], [0, 285],
      [-355, -115], [355, -115],
      [-355, 115], [355, 115]
    ],
    spawnRate: (p) => 14 + p * 62,
    surgeSize: (p) => lerp(60, 220, p),
    boss: 'matriarch'
  },
  {
    id: 'foundry',
    name: 'THE FOUNDRY',
    blurb: 'Tighter, hotter, and they come faster. Four nodes to hold instead of six.',
    width: 1500,
    height: 1100,
    ground: { base: '#33261f', fleck: [[62, 48], [44, 34], [30, 24]] },
    border: 'rgba(255,190,140,0.35)',
    nodes: [
      [-300, -190], [300, -190],
      [-300, 190], [300, 190]
    ],
    spawnRate: (p) => 20 + p * 80,
    surgeSize: (p) => lerp(75, 260, p),
    boss: 'foreman'
  }
];

function arenaById(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

/* Which stages the player has cleared, so stage 2 can stay locked. */
const Progress = {
  cleared: {},

  load() {
    try {
      this.cleared = JSON.parse(localStorage.getItem('hoard.cleared') || '{}') || {};
    } catch (e) {
      this.cleared = {};
    }
  },

  markCleared(id) {
    this.cleared[id] = true;
    try { localStorage.setItem('hoard.cleared', JSON.stringify(this.cleared)); } catch (e) { /* ignore */ }
  },

  isUnlocked(index) {
    return index === 0 || !!this.cleared[ARENAS[index - 1].id];
  }
};
